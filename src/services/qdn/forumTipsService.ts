import type { Post } from '../../types/index.js';
import type { V2RuntimeState } from '../architectureV2/runtime.js';
import {
  buildTipReferenceEnvelope,
  buildTipReferenceIdentifier,
  buildTipReferencePrefix,
  isTipReferenceEnvelope,
  loadTipReferences,
  normalizeQortAmount,
  resolveTipDisplay,
  type DiscoveredTipResource,
  type QortTransferEvidence,
  type ReducedTipState,
  type TipDiagnosticCode,
  type TipEvidenceLookup,
  type TipReferenceBody,
  type TipReferenceEnvelope,
  type TipReferenceTransactionEvidence,
} from '../architectureV2/tips.js';
import { fetchWithQdnReadyFallback } from './qdnReadiness.js';
import { requestQortium } from '../qortium/qortiumClient.js';
import { discoverQdnResources } from './qdnPagination.js';
import {
  getUserAccount,
  resolveNameWalletAddressUncached,
  type UserAccount,
} from '../qortium/walletService.js';

const FORUM_SERVICE = import.meta.env?.VITE_QORTIUM_QDN_SERVICE ?? 'DOCUMENT';
const FORUM_NAMESPACE =
  import.meta.env?.VITE_QORTIUM_QDN_IDENTIFIER?.trim() || 'qdbm';
const TIP_DISCOVERY_BUDGET = 10_000;
const MAX_SAFE_QDN_IDENTIFIER_LENGTH = 64;

type TipDiscoveryResult = {
  resources: DiscoveredTipResource[];
  complete: boolean;
};

export type TipRecovery = {
  schema: 'qdb-tip-recovery';
  schemaVersion: 1;
  phase:
    | 'transaction-verification'
    | 'reference-publication'
    | 'reference-refresh'
    | 'derived-cache';
  recordId: string;
  body: TipReferenceBody;
};

export const isTipRecovery = (value: unknown): value is TipRecovery => {
  if (!isObject(value) || !isObject(value.body)) return false;
  if (
    !Object.keys(value).every((key) =>
      ['schema', 'schemaVersion', 'phase', 'recordId', 'body'].includes(key)
    ) ||
    value.schema !== 'qdb-tip-recovery' ||
    value.schemaVersion !== 1 ||
    (value.phase !== 'transaction-verification' &&
      value.phase !== 'reference-publication' &&
      value.phase !== 'reference-refresh' &&
      value.phase !== 'derived-cache') ||
    typeof value.recordId !== 'string' ||
    !value.recordId.trim()
  )
    return false;
  return isTipReferenceEnvelope({
    schema: 'qdb-v2',
    schemaVersion: 2,
    kind: 'operation',
    recordType: 'tip-reference',
    recordId: value.recordId,
    targetId: value.body.targetId,
    body: value.body,
  });
};

export type TipRecipient = {
  postId: string;
  name: string;
  address: string;
};

export type TipSubmissionResult =
  | {
      ok: true;
      paymentCommitted: true;
      status: 'VERIFIED';
      transactionSignature: string;
      envelope: TipReferenceEnvelope;
      state: ReducedTipState;
    }
  | {
      ok: true;
      paymentCommitted: true;
      status: 'PARTIAL';
      code: TipDiagnosticCode;
      transactionSignature: string;
      pending: TipRecovery['phase'];
      retryable: true;
      recovery: TipRecovery;
      detail: string;
    }
  | {
      ok: false;
      paymentCommitted: false;
      status: 'PAYMENT_FAILED';
      code: TipDiagnosticCode;
      detail: string;
    }
  | {
      ok: false;
      paymentCommitted: true;
      status: 'REFERENCE_REJECTED';
      transactionSignature: string;
      code: TipDiagnosticCode;
      detail: string;
    };

export const finalizeTipDerivedState = async (
  result: TipSubmissionResult,
  refreshDerived?: (state: ReducedTipState) => Promise<void>
): Promise<TipSubmissionResult> => {
  if (!result.ok || result.status !== 'VERIFIED' || !refreshDerived)
    return result;
  try {
    await refreshDerived(result.state);
    return result;
  } catch (error) {
    return {
      ok: true,
      paymentCommitted: true,
      status: 'PARTIAL',
      code: 'TIP_DERIVED_CACHE_FAILED',
      transactionSignature: result.transactionSignature,
      pending: 'derived-cache',
      retryable: true,
      recovery: {
        schema: 'qdb-tip-recovery',
        schemaVersion: 1,
        phase: 'derived-cache',
        recordId: result.envelope.recordId,
        body: result.envelope.body,
      },
      detail:
        error instanceof Error
          ? error.message
          : 'verified tip display cache refresh failed',
    };
  }
};

export type ForumTipsDependencies = {
  discoverResources: () => Promise<TipDiscoveryResult>;
  referenceExists: (
    publisherName: string,
    identifier: string
  ) => Promise<boolean>;
  fetchPayload: (resource: DiscoveredTipResource) => Promise<unknown>;
  fetchReferenceTransaction: (
    signature: string
  ) => Promise<TipEvidenceLookup<TipReferenceTransactionEvidence>>;
  fetchPaymentTransaction: (
    signature: string
  ) => Promise<TipEvidenceLookup<QortTransferEvidence>>;
  publishReference: (
    publisherName: string,
    envelope: TipReferenceEnvelope
  ) => Promise<void>;
  sendQort: (recipient: string, amountQort: string) => Promise<unknown>;
  getSelectedAccount: () => Promise<UserAccount>;
  resolveNameWalletAddress: (name: string) => Promise<string | null>;
};

type SendCoinResponse = {
  accepted?: unknown;
  action?: unknown;
  recipient?: unknown;
  amount?: unknown;
  assetId?: unknown;
  transactionSignature?: unknown;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseJsonLike = (raw: unknown): unknown => {
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const bytes = Uint8Array.from(atob(trimmed), (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  }
};

const lookupFailure = <T>(error: unknown): TipEvidenceLookup<T> => {
  const detail =
    error instanceof Error && error.message
      ? error.message
      : 'Core transaction lookup failed';
  return /TRANSACTION_UNKNOWN|transaction unknown|(?:^|\D)311(?:\D|$)/i.test(
    detail
  )
    ? { status: 'not-found', detail }
    : { status: 'unavailable', detail };
};

export const parseCoreQortTransfer = (
  raw: unknown,
  expectedSignature: string
): TipEvidenceLookup<QortTransferEvidence> => {
  if (!isObject(raw))
    return {
      status: 'invalid',
      code: 'TIP_TRANSACTION_INVALID',
      detail: 'Core returned a malformed transaction response',
    };
  if (raw.type !== 'TRANSFER_ASSET' || raw.assetId !== 0)
    return {
      status: 'invalid',
      code: 'TIP_WRONG_TRANSACTION_TYPE',
      detail: 'referenced transaction is not a native QORT TRANSFER_ASSET',
    };
  const amountQort = normalizeQortAmount(raw.amount);
  if (
    typeof raw.signature !== 'string' ||
    raw.signature.trim() !== expectedSignature.trim() ||
    typeof raw.creatorAddress !== 'string' ||
    !raw.creatorAddress.trim() ||
    typeof raw.recipient !== 'string' ||
    !raw.recipient.trim() ||
    !amountQort ||
    typeof raw.timestamp !== 'number' ||
    !Number.isSafeInteger(raw.timestamp) ||
    (raw.blockSequence !== undefined &&
      raw.blockSequence !== null &&
      (typeof raw.blockSequence !== 'number' ||
        !Number.isSafeInteger(raw.blockSequence))) ||
    typeof raw.approvalStatus !== 'string'
  )
    return {
      status: 'invalid',
      code: 'TIP_TRANSACTION_INVALID',
      detail: 'referenced QORT transfer is unconfirmed, rejected, or malformed',
    };
  if (
    raw.approvalStatus === 'REJECTED' ||
    raw.approvalStatus === 'EXPIRED' ||
    raw.approvalStatus === 'INVALID'
  )
    return {
      status: 'invalid',
      code: 'TIP_TRANSACTION_INVALID',
      detail: `referenced QORT transfer has ${raw.approvalStatus} approval status`,
    };
  if (
    typeof raw.blockHeight !== 'number' ||
    !Number.isSafeInteger(raw.blockHeight) ||
    raw.blockHeight <= 0 ||
    raw.approvalStatus === 'PENDING'
  )
    return {
      status: 'unavailable',
      detail: 'referenced QORT transfer exists but is awaiting confirmation',
    };
  if (
    raw.approvalStatus !== 'NOT_REQUIRED' &&
    raw.approvalStatus !== 'APPROVED'
  )
    return {
      status: 'invalid',
      code: 'TIP_TRANSACTION_INVALID',
      detail: 'referenced QORT transfer has an unsupported approval status',
    };
  return {
    status: 'found',
    evidence: {
      type: 'TRANSFER_ASSET',
      signature: raw.signature.trim(),
      creatorAddress: raw.creatorAddress.trim(),
      recipient: raw.recipient.trim(),
      amountQort,
      assetId: 0,
      timestamp: raw.timestamp,
      blockHeight: raw.blockHeight,
      blockSequence:
        typeof raw.blockSequence === 'number' ? raw.blockSequence : null,
      approvalStatus: raw.approvalStatus,
    },
  };
};

export const parseCoreReferenceTransaction = (
  raw: unknown,
  expectedSignature: string
): TipEvidenceLookup<TipReferenceTransactionEvidence> => {
  if (!isObject(raw))
    return {
      status: 'invalid',
      code: 'TIP_REFERENCE_TRANSACTION_MISMATCH',
      detail: 'Core returned malformed QDN transaction evidence',
    };
  if (
    raw.type !== 'ARBITRARY' ||
    raw.method !== 'PUT' ||
    typeof raw.signature !== 'string' ||
    raw.signature.trim() !== expectedSignature.trim() ||
    typeof raw.creatorAddress !== 'string' ||
    !raw.creatorAddress.trim() ||
    typeof raw.timestamp !== 'number' ||
    !Number.isSafeInteger(raw.timestamp) ||
    typeof raw.name !== 'string' ||
    !raw.name.trim() ||
    typeof raw.identifier !== 'string' ||
    !raw.identifier.trim() ||
    typeof raw.approvalStatus !== 'string' ||
    (raw.blockSequence !== undefined &&
      raw.blockSequence !== null &&
      (typeof raw.blockSequence !== 'number' ||
        !Number.isSafeInteger(raw.blockSequence)))
  )
    return {
      status: 'invalid',
      code: 'TIP_REFERENCE_TRANSACTION_MISMATCH',
      detail:
        'QDN reference publication transaction is unconfirmed or mismatched',
    };
  if (
    raw.approvalStatus === 'REJECTED' ||
    raw.approvalStatus === 'EXPIRED' ||
    raw.approvalStatus === 'INVALID'
  )
    return {
      status: 'invalid',
      code: 'TIP_REFERENCE_TRANSACTION_MISMATCH',
      detail: `QDN tip-reference publication has ${raw.approvalStatus} approval status`,
    };
  if (
    typeof raw.blockHeight !== 'number' ||
    !Number.isSafeInteger(raw.blockHeight) ||
    raw.blockHeight <= 0 ||
    raw.approvalStatus === 'PENDING'
  )
    return {
      status: 'unavailable',
      detail: 'QDN tip-reference publication is awaiting confirmation',
    };
  if (
    raw.approvalStatus !== 'NOT_REQUIRED' &&
    raw.approvalStatus !== 'APPROVED'
  )
    return {
      status: 'invalid',
      code: 'TIP_REFERENCE_TRANSACTION_MISMATCH',
      detail:
        'QDN tip-reference publication has an unsupported approval status',
    };
  return {
    status: 'found',
    evidence: {
      type: 'ARBITRARY',
      method: 'PUT',
      signature: raw.signature.trim(),
      creatorAddress: raw.creatorAddress.trim(),
      timestamp: raw.timestamp,
      name: raw.name.trim(),
      identifier: raw.identifier.trim(),
      blockHeight: raw.blockHeight,
      blockSequence:
        typeof raw.blockSequence === 'number' ? raw.blockSequence : null,
      approvalStatus: raw.approvalStatus,
    },
  };
};

const parseSendResponse = (raw: unknown) => {
  if (!isObject(raw))
    return {
      signature: null,
      valid: false,
      detail: 'wallet returned no transaction result',
    };
  const response = raw as SendCoinResponse;
  const signature =
    typeof response.transactionSignature === 'string' &&
    response.transactionSignature.trim()
      ? response.transactionSignature.trim()
      : null;
  return {
    signature,
    valid:
      response.accepted === true &&
      (response.action === 'SEND_COIN' || response.action === 'PAYMENT') &&
      response.assetId === 0,
    detail: signature
      ? 'wallet response metadata did not match the verified QORT send contract'
      : 'wallet response did not include a transaction signature',
  };
};

const assertIdentifierLength = (identifier: string) => {
  if (identifier.length > MAX_SAFE_QDN_IDENTIFIER_LENGTH)
    throw new Error(
      `Tip reference identifier exceeds ${MAX_SAFE_QDN_IDENTIFIER_LENGTH} characters.`
    );
};

const targetRecipient = (
  authority: V2RuntimeState,
  postId: string
): TipRecipient | null => {
  const target = authority.authoritative.entities[postId];
  if (!target || target.entityType !== 'post') return null;
  return {
    postId,
    name: target.publisherName,
    address: target.walletAddress,
  };
};

const recoveryFor = (
  phase: TipRecovery['phase'],
  recordId: string,
  body: TipReferenceBody
): TipRecovery => ({
  schema: 'qdb-tip-recovery',
  schemaVersion: 1,
  phase,
  recordId,
  body,
});

export const createForumTipsService = (dependencies: ForumTipsDependencies) => {
  const load = async (authority: V2RuntimeState) => {
    const discovery = await dependencies.discoverResources();
    return loadTipReferences(
      discovery.resources,
      authority.authoritative,
      {
        fetchPayload: dependencies.fetchPayload,
        expectedIdentifier: (signature) =>
          buildTipReferenceIdentifier(FORUM_NAMESPACE, signature),
        fetchReferenceTransaction: dependencies.fetchReferenceTransaction,
        fetchPaymentTransaction: dependencies.fetchPaymentTransaction,
      },
      discovery.complete
    );
  };

  const verifyCurrentSender = async (body: TipReferenceBody) => {
    const [account, resolved] = await Promise.all([
      dependencies.getSelectedAccount(),
      dependencies.resolveNameWalletAddress(body.senderName),
    ]);
    return (
      account.address?.trim() === body.senderAddress.trim() &&
      resolved?.trim() === body.senderAddress.trim()
    );
  };

  const continueAfterPayment = async (
    body: TipReferenceBody,
    recordId: string,
    authority: V2RuntimeState
  ): Promise<TipSubmissionResult> => {
    const payment = await dependencies.fetchPaymentTransaction(
      body.transactionSignature
    );
    if (payment.status === 'not-found' || payment.status === 'unavailable')
      return {
        ok: true,
        paymentCommitted: true,
        status: 'PARTIAL',
        code: 'TIP_VERIFICATION_UNAVAILABLE',
        transactionSignature: body.transactionSignature,
        pending: 'transaction-verification',
        retryable: true,
        recovery: recoveryFor('transaction-verification', recordId, body),
        detail: payment.detail,
      };
    if (payment.status === 'invalid')
      return {
        ok: false,
        paymentCommitted: true,
        status: 'REFERENCE_REJECTED',
        transactionSignature: body.transactionSignature,
        code: payment.code,
        detail: payment.detail,
      };
    if (payment.evidence.creatorAddress !== body.senderAddress)
      return {
        ok: false,
        paymentCommitted: true,
        status: 'REFERENCE_REJECTED',
        transactionSignature: body.transactionSignature,
        code: 'TIP_SENDER_MISMATCH',
        detail: 'confirmed payment sender differs from the initiating wallet',
      };
    if (payment.evidence.recipient !== body.recipientAddress)
      return {
        ok: false,
        paymentCommitted: true,
        status: 'REFERENCE_REJECTED',
        transactionSignature: body.transactionSignature,
        code: 'TIP_RECIPIENT_MISMATCH',
        detail:
          'confirmed payment recipient differs from the authoritative Post owner',
      };
    if (payment.evidence.amountQort !== body.amountQort)
      return {
        ok: false,
        paymentCommitted: true,
        status: 'REFERENCE_REJECTED',
        transactionSignature: body.transactionSignature,
        code: 'TIP_AMOUNT_MISMATCH',
        detail:
          'confirmed payment amount differs from the requested tip amount',
      };

    let existing: ReducedTipState;
    try {
      existing = await load(authority);
    } catch {
      existing = {
        status: 'UNAVAILABLE',
        byTarget: {},
        bySignature: {},
        diagnostics: [],
      };
    }
    const envelope = buildTipReferenceEnvelope(body, recordId);
    if (existing.bySignature[body.transactionSignature])
      return {
        ok: true,
        paymentCommitted: true,
        status: 'VERIFIED',
        transactionSignature: body.transactionSignature,
        envelope,
        state: existing,
      };
    let alreadyPublished: boolean;
    try {
      alreadyPublished = await dependencies.referenceExists(
        body.senderName,
        recordId
      );
    } catch (error) {
      return {
        ok: true,
        paymentCommitted: true,
        status: 'PARTIAL',
        code: 'TIP_VERIFICATION_UNAVAILABLE',
        transactionSignature: body.transactionSignature,
        pending: 'reference-refresh',
        retryable: true,
        recovery: recoveryFor('reference-refresh', recordId, body),
        detail:
          error instanceof Error
            ? error.message
            : 'existing tip-reference lookup is unavailable',
      };
    }
    if (alreadyPublished) {
      const rejection = existing.diagnostics.find(
        (entry) => entry.identifier === recordId
      );
      if (rejection && existing.status === 'VERIFIED')
        return {
          ok: false,
          paymentCommitted: true,
          status: 'REFERENCE_REJECTED',
          transactionSignature: body.transactionSignature,
          code: rejection.code,
          detail: rejection.detail,
        };
      return {
        ok: true,
        paymentCommitted: true,
        status: 'PARTIAL',
        code: 'TIP_VERIFICATION_UNAVAILABLE',
        transactionSignature: body.transactionSignature,
        pending: 'reference-refresh',
        retryable: true,
        recovery: recoveryFor('reference-refresh', recordId, body),
        detail:
          'tip reference already exists and is awaiting complete verification; it was not republished',
      };
    }
    if (!(await verifyCurrentSender(body)))
      return {
        ok: false,
        paymentCommitted: true,
        status: 'REFERENCE_REJECTED',
        transactionSignature: body.transactionSignature,
        code: 'TIP_WALLET_NAME_UNAVAILABLE',
        detail:
          'current sender name, selected wallet, and payment sender cannot be bound',
      };
    try {
      await dependencies.publishReference(body.senderName, envelope);
    } catch (error) {
      return {
        ok: true,
        paymentCommitted: true,
        status: 'PARTIAL',
        code: 'TIP_REFERENCE_PUBLICATION_FAILED',
        transactionSignature: body.transactionSignature,
        pending: 'reference-publication',
        retryable: true,
        recovery: recoveryFor('reference-publication', recordId, body),
        detail:
          error instanceof Error
            ? error.message
            : 'tip reference publication failed',
      };
    }
    let reloaded: ReducedTipState;
    try {
      reloaded = await load(authority);
    } catch (error) {
      return {
        ok: true,
        paymentCommitted: true,
        status: 'PARTIAL',
        code: 'TIP_VERIFICATION_UNAVAILABLE',
        transactionSignature: body.transactionSignature,
        pending: 'reference-refresh',
        retryable: true,
        recovery: recoveryFor('reference-refresh', recordId, body),
        detail:
          error instanceof Error
            ? error.message
            : 'tip reference refresh failed',
      };
    }
    if (reloaded.bySignature[body.transactionSignature])
      return {
        ok: true,
        paymentCommitted: true,
        status: 'VERIFIED',
        transactionSignature: body.transactionSignature,
        envelope,
        state: reloaded,
      };
    const rejection = reloaded.diagnostics.find(
      (entry) => entry.identifier === recordId
    );
    if (rejection && reloaded.status === 'VERIFIED')
      return {
        ok: false,
        paymentCommitted: true,
        status: 'REFERENCE_REJECTED',
        transactionSignature: body.transactionSignature,
        code: rejection.code,
        detail: rejection.detail,
      };
    return {
      ok: true,
      paymentCommitted: true,
      status: 'PARTIAL',
      code: 'TIP_REFERENCE_UNAVAILABLE',
      transactionSignature: body.transactionSignature,
      pending: 'reference-refresh',
      retryable: true,
      recovery: recoveryFor('reference-refresh', recordId, body),
      detail:
        'tip payment is confirmed but its reference has not appeared in complete discovery',
    };
  };

  return {
    resolveRecipient(authority: V2RuntimeState, postId: string) {
      return targetRecipient(authority, postId);
    },

    load,

    async apply(posts: Post[], authority: V2RuntimeState) {
      const state = await load(authority);
      return posts.map((post) => ({
        ...post,
        tipSummary: resolveTipDisplay(post.id, post.tips, state),
      }));
    },

    async submit(input: {
      postId: string;
      amountQort: string;
      senderName: string;
      senderAddress: string;
      authority: V2RuntimeState;
    }): Promise<TipSubmissionResult> {
      const amountQort = normalizeQortAmount(input.amountQort);
      if (!amountQort)
        return {
          ok: false,
          paymentCommitted: false,
          status: 'PAYMENT_FAILED',
          code: 'TIP_AMOUNT_MISMATCH',
          detail:
            'tip amount must be positive with no more than eight decimals',
        };
      const recipient = targetRecipient(input.authority, input.postId);
      if (!recipient)
        return {
          ok: false,
          paymentCommitted: false,
          status: 'PAYMENT_FAILED',
          code: 'TIP_TARGET_UNAVAILABLE',
          detail:
            'legacy or unavailable Post authority cannot select a tip recipient',
        };
      const provisionalBody: TipReferenceBody = {
        operation: 'tip-reference',
        targetType: 'post',
        targetId: input.postId,
        transactionSignature: 'pending',
        senderName: input.senderName.trim(),
        senderAddress: input.senderAddress.trim(),
        recipientName: recipient.name,
        recipientAddress: recipient.address,
        amountQort,
      };
      if (!(await verifyCurrentSender(provisionalBody)))
        return {
          ok: false,
          paymentCommitted: false,
          status: 'PAYMENT_FAILED',
          code: 'TIP_WALLET_NAME_UNAVAILABLE',
          detail:
            'selected account and current sender QDN name/wallet binding could not be verified',
        };
      let rawResponse: unknown;
      try {
        rawResponse = await dependencies.sendQort(
          recipient.address,
          amountQort
        );
      } catch (error) {
        return {
          ok: false,
          paymentCommitted: false,
          status: 'PAYMENT_FAILED',
          code: 'TIP_TRANSACTION_INVALID',
          detail:
            error instanceof Error ? error.message : 'QORT transfer failed',
        };
      }
      const response = parseSendResponse(rawResponse);
      if (!response.signature)
        return {
          ok: false,
          paymentCommitted: false,
          status: 'PAYMENT_FAILED',
          code: 'TIP_MISSING_SIGNATURE',
          detail: response.detail,
        };
      if (!response.valid)
        return {
          ok: false,
          paymentCommitted: true,
          status: 'REFERENCE_REJECTED',
          transactionSignature: response.signature,
          code: 'TIP_TRANSACTION_INVALID',
          detail: response.detail,
        };
      const body = {
        ...provisionalBody,
        transactionSignature: response.signature,
      };
      const recordId = await buildTipReferenceIdentifier(
        FORUM_NAMESPACE,
        response.signature
      );
      assertIdentifierLength(recordId);
      return continueAfterPayment(body, recordId, input.authority);
    },

    async retry(
      recovery: TipRecovery,
      authority: V2RuntimeState
    ): Promise<TipSubmissionResult> {
      const recipient = targetRecipient(authority, recovery.body.targetId);
      if (
        !recipient ||
        recipient.name.trim().toLowerCase() !==
          recovery.body.recipientName.trim().toLowerCase() ||
        recipient.address.trim() !== recovery.body.recipientAddress.trim()
      )
        return {
          ok: false,
          paymentCommitted: true,
          status: 'REFERENCE_REJECTED',
          transactionSignature: recovery.body.transactionSignature,
          code: 'TIP_RECIPIENT_MISMATCH',
          detail:
            'authoritative Post owner changed or is unavailable; retry failed closed',
        };
      const expectedRecordId = await buildTipReferenceIdentifier(
        FORUM_NAMESPACE,
        recovery.body.transactionSignature
      );
      if (expectedRecordId !== recovery.recordId)
        return {
          ok: false,
          paymentCommitted: true,
          status: 'REFERENCE_REJECTED',
          transactionSignature: recovery.body.transactionSignature,
          code: 'TIP_IDENTIFIER_MISMATCH',
          detail: 'tip recovery record identifier is not canonical',
        };
      return continueAfterPayment(recovery.body, recovery.recordId, authority);
    },
  };
};

const discoverTipResources = async (): Promise<TipDiscoveryResult> => {
  const discovery = await discoverQdnResources(
    {
      service: FORUM_SERVICE,
      identifier: buildTipReferencePrefix(FORUM_NAMESPACE),
      prefix: true,
      mode: 'ALL',
      reverse: false,
    },
    { maxResources: TIP_DISCOVERY_BUDGET }
  );
  return {
    resources: discovery.items,
    complete: discovery.completeness === 'complete',
  };
};

const fetchPayload = async (resource: DiscoveredTipResource) => {
  if (!resource.name || !resource.identifier)
    throw new Error('tip reference resource is incomplete');
  const fetcher = () =>
    requestQortium<unknown>({
      action: 'FETCH_QDN_RESOURCE',
      service: FORUM_SERVICE,
      name: resource.name,
      identifier: resource.identifier,
    });
  return parseJsonLike(
    await fetchWithQdnReadyFallback(
      FORUM_SERVICE,
      resource.name,
      resource.identifier,
      fetcher
    )
  );
};

const fetchCoreTransaction = async (signature: string) =>
  requestQortium<unknown>({
    action: 'FETCH_NODE_API',
    path: `/transactions/signature/${encodeURIComponent(signature)}`,
  });

export const forumTipsService = createForumTipsService({
  discoverResources: discoverTipResources,
  referenceExists: async (publisherName, identifier) => {
    const result = await discoverQdnResources(
      {
        service: FORUM_SERVICE,
        name: publisherName,
        identifier,
        prefix: true,
        mode: 'ALL',
      },
      { pageSize: 25, maxPages: 4, maxResources: 100 }
    );
    if (result.completeness !== 'complete')
      throw new Error(
        '[PARTIAL_DISCOVERY] exact tip-reference lookup is incomplete'
      );
    return result.items.some(
      (resource) =>
        resource.name?.trim().toLowerCase() ===
          publisherName.trim().toLowerCase() &&
        resource.identifier === identifier
    );
  },
  fetchPayload,
  fetchReferenceTransaction: async (signature) => {
    try {
      return parseCoreReferenceTransaction(
        await fetchCoreTransaction(signature),
        signature
      );
    } catch (error) {
      return lookupFailure(error);
    }
  },
  fetchPaymentTransaction: async (signature) => {
    try {
      return parseCoreQortTransfer(
        await fetchCoreTransaction(signature),
        signature
      );
    } catch (error) {
      return lookupFailure(error);
    }
  },
  publishReference: async (publisherName, envelope) => {
    if (!isTipReferenceEnvelope(envelope))
      throw new Error('[TIP_MALFORMED_REFERENCE] invalid tip reference');
    await requestQortium<unknown>({
      action: 'PUBLISH_QDN_RESOURCE',
      service: FORUM_SERVICE,
      name: publisherName,
      identifier: envelope.recordId,
      title: 'Verified QORT post tip',
      description: 'Discussion Boards verified QORT transaction reference',
      tags: ['forum', 'qdb-v2', 'tip-reference', 'qort'],
      data64: (() => {
        const bytes = new TextEncoder().encode(JSON.stringify(envelope));
        let binary = '';
        bytes.forEach((byte) => {
          binary += String.fromCharCode(byte);
        });
        return btoa(binary);
      })(),
    });
  },
  sendQort: (recipient, amountQort) =>
    requestQortium<unknown>({
      action: 'SEND_COIN',
      coin: 'QORT',
      recipient,
      amount: amountQort,
    }),
  getSelectedAccount: getUserAccount,
  resolveNameWalletAddress: resolveNameWalletAddressUncached,
});
