import type { QdbV2ResourceMetadata } from './types.js';
import type { V2State } from './reducer.js';
import { normalizeName, validateMetadata } from './validation.js';

export const QORT_ATOMIC_FACTOR = 100_000_000n;

export type TipReferenceBody = {
  operation: 'tip-reference';
  targetType: 'post';
  targetId: string;
  transactionSignature: string;
  senderName: string;
  senderAddress: string;
  recipientName: string;
  recipientAddress: string;
  amountQort: string;
};

export type TipReferenceEnvelope = {
  schema: 'qdb-v2';
  schemaVersion: 2;
  kind: 'operation';
  recordType: 'tip-reference';
  recordId: string;
  targetId: string;
  body: TipReferenceBody;
  clientCreatedAt?: string;
};

export type QortTransferEvidence = {
  type: 'TRANSFER_ASSET';
  signature: string;
  creatorAddress: string;
  recipient: string;
  amountQort: string;
  assetId: 0;
  timestamp: number;
  blockHeight: number;
  blockSequence: number | null;
  approvalStatus: 'NOT_REQUIRED' | 'APPROVED';
};

export type TipReferenceTransactionEvidence = {
  type: 'ARBITRARY';
  method: 'PUT';
  signature: string;
  creatorAddress: string;
  timestamp: number;
  name: string;
  identifier: string;
  blockHeight: number;
  blockSequence: number | null;
  approvalStatus: 'NOT_REQUIRED' | 'APPROVED';
};

export type TipReferenceRecord = {
  metadata: QdbV2ResourceMetadata;
  envelope: TipReferenceEnvelope;
  referenceTransaction: TipReferenceTransactionEvidence;
  paymentTransaction: QortTransferEvidence;
};

export type TipDiagnosticCode =
  | 'TIP_MALFORMED_REFERENCE'
  | 'TIP_MISSING_SIGNATURE'
  | 'TIP_TRANSACTION_NOT_FOUND'
  | 'TIP_WRONG_TRANSACTION_TYPE'
  | 'TIP_TRANSACTION_INVALID'
  | 'TIP_SENDER_MISMATCH'
  | 'TIP_RECIPIENT_MISMATCH'
  | 'TIP_AMOUNT_MISMATCH'
  | 'TIP_TARGET_MISMATCH'
  | 'TIP_TARGET_UNAVAILABLE'
  | 'TIP_DUPLICATE_REFERENCE'
  | 'TIP_REFERENCE_CONFLICT'
  | 'TIP_UNAUTHORIZED_PUBLISHER'
  | 'TIP_WALLET_NAME_UNAVAILABLE'
  | 'TIP_VERIFICATION_UNAVAILABLE'
  | 'TIP_REFERENCE_PUBLICATION_FAILED'
  | 'TIP_DERIVED_CACHE_FAILED'
  | 'TIP_LEGACY_UNVERIFIED'
  | 'TIP_IDENTIFIER_MISMATCH'
  | 'TIP_REFERENCE_TRANSACTION_MISMATCH'
  | 'TIP_REFERENCE_REPUBLISHED'
  | 'TIP_REFERENCE_UNAVAILABLE'
  | 'TIP_MISSING_TRUSTED_METADATA'
  | 'TIP_DISCOVERY_INCOMPLETE';

export type TipDiagnostic = {
  code: TipDiagnosticCode;
  identifier: string;
  detail: string;
};

export type VerifiedTip = {
  targetId: string;
  transactionSignature: string;
  senderName: string;
  senderAddress: string;
  recipientName: string;
  recipientAddress: string;
  amountQort: string;
  trustedPaymentTimestamp: number;
  trustedPaymentBlockHeight: number;
  trustedPaymentBlockSequence: number | null;
  referenceIdentifier: string;
  referencePublisher: string;
  referenceCreated: number;
  referenceSignature: string;
};

export type VerifiedTipSummary = {
  targetId: string;
  verifiedCount: number;
  verifiedTotalQort: string;
  tips: VerifiedTip[];
};

export type ReducedTipState = {
  status: 'VERIFIED' | 'UNAVAILABLE';
  byTarget: Record<string, VerifiedTipSummary>;
  bySignature: Record<string, VerifiedTip>;
  diagnostics: TipDiagnostic[];
};

export type DiscoveredTipResource = {
  name?: string;
  identifier?: string;
  service?: string;
  created?: number;
  updated?: number | null;
  latestSignature?: string;
};

export type TipEvidenceLookup<T> =
  | { status: 'found'; evidence: T }
  | { status: 'not-found'; detail: string }
  | { status: 'unavailable'; detail: string }
  | { status: 'invalid'; code: TipDiagnosticCode; detail: string };

export type TipLoaderDependencies = {
  fetchPayload: (resource: DiscoveredTipResource) => Promise<unknown>;
  expectedIdentifier: (signature: string) => Promise<string>;
  fetchReferenceTransaction: (
    signature: string
  ) => Promise<TipEvidenceLookup<TipReferenceTransactionEvidence>>;
  fetchPaymentTransaction: (
    signature: string
  ) => Promise<TipEvidenceLookup<QortTransferEvidence>>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

const normalizeSignature = (value: string) => value.trim();

export const qortToAtomic = (value: unknown): bigint | null => {
  let raw: string;
  if (typeof value === 'string') raw = value.trim();
  else if (typeof value === 'number' && Number.isFinite(value)) {
    if (!Number.isSafeInteger(Math.round(value * Number(QORT_ATOMIC_FACTOR))))
      return null;
    raw = value.toFixed(8);
  } else return null;
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.split('.');
  const atomic =
    BigInt(whole ?? '0') * QORT_ATOMIC_FACTOR + BigInt(fraction.padEnd(8, '0'));
  return atomic > 0n ? atomic : null;
};

export const atomicToQort = (atomic: bigint) => {
  const whole = atomic / QORT_ATOMIC_FACTOR;
  const fraction = (atomic % QORT_ATOMIC_FACTOR).toString().padStart(8, '0');
  return `${whole}.${fraction}`;
};

export const normalizeQortAmount = (value: unknown): string | null => {
  const atomic = qortToAtomic(value);
  return atomic === null ? null : atomicToQort(atomic);
};

export const isTipReferenceEnvelope = (
  value: unknown
): value is TipReferenceEnvelope => {
  if (!isRecord(value) || !isRecord(value.body)) return false;
  const body = value.body;
  return (
    hasOnlyKeys(value, [
      'schema',
      'schemaVersion',
      'kind',
      'recordType',
      'recordId',
      'targetId',
      'body',
      'clientCreatedAt',
    ]) &&
    hasOnlyKeys(body, [
      'operation',
      'targetType',
      'targetId',
      'transactionSignature',
      'senderName',
      'senderAddress',
      'recipientName',
      'recipientAddress',
      'amountQort',
    ]) &&
    value.schema === 'qdb-v2' &&
    value.schemaVersion === 2 &&
    value.kind === 'operation' &&
    value.recordType === 'tip-reference' &&
    typeof value.recordId === 'string' &&
    value.recordId.trim().length > 0 &&
    typeof value.targetId === 'string' &&
    value.targetId.trim().length > 0 &&
    (value.clientCreatedAt === undefined ||
      typeof value.clientCreatedAt === 'string') &&
    body.operation === 'tip-reference' &&
    body.targetType === 'post' &&
    typeof body.targetId === 'string' &&
    body.targetId === value.targetId &&
    typeof body.transactionSignature === 'string' &&
    body.transactionSignature.trim().length > 0 &&
    typeof body.senderName === 'string' &&
    body.senderName.trim().length > 0 &&
    typeof body.senderAddress === 'string' &&
    body.senderAddress.trim().length > 0 &&
    typeof body.recipientName === 'string' &&
    body.recipientName.trim().length > 0 &&
    typeof body.recipientAddress === 'string' &&
    body.recipientAddress.trim().length > 0 &&
    typeof body.amountQort === 'string' &&
    normalizeQortAmount(body.amountQort) === body.amountQort
  );
};

export const classifyInvalidTipReference = (
  value: unknown
): TipDiagnosticCode => {
  if (!isRecord(value) || !isRecord(value.body))
    return 'TIP_MALFORMED_REFERENCE';
  if (
    typeof value.body.transactionSignature !== 'string' ||
    !value.body.transactionSignature.trim()
  )
    return 'TIP_MISSING_SIGNATURE';
  if (
    typeof value.targetId === 'string' &&
    typeof value.body.targetId === 'string' &&
    value.targetId !== value.body.targetId
  )
    return 'TIP_TARGET_MISMATCH';
  return 'TIP_MALFORMED_REFERENCE';
};

export const buildTipReferenceEnvelope = (
  body: TipReferenceBody,
  recordId: string,
  clientCreatedAt = new Date().toISOString()
): TipReferenceEnvelope => ({
  schema: 'qdb-v2',
  schemaVersion: 2,
  kind: 'operation',
  recordType: 'tip-reference',
  recordId,
  targetId: body.targetId,
  body,
  clientCreatedAt,
});

const sha256Hex = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

export const buildTipReferencePrefix = (namespace: string) =>
  `${namespace}-v2-tip-`;

export const buildTipReferenceIdentifier = async (
  namespace: string,
  transactionSignature: string
) =>
  `${buildTipReferencePrefix(namespace)}${(
    await sha256Hex(normalizeSignature(transactionSignature))
  ).slice(0, 40)}`;

const sameAddress = (left: string, right: string) =>
  left.trim() === right.trim();
const sameName = (left: string, right: string) =>
  normalizeName(left) === normalizeName(right);

const orderTipRecords = (left: TipReferenceRecord, right: TipReferenceRecord) =>
  left.paymentTransaction.blockHeight - right.paymentTransaction.blockHeight ||
  (left.paymentTransaction.blockSequence ?? -1) -
    (right.paymentTransaction.blockSequence ?? -1) ||
  left.paymentTransaction.timestamp - right.paymentTransaction.timestamp ||
  left.paymentTransaction.signature.localeCompare(
    right.paymentTransaction.signature
  ) ||
  left.metadata.identifier.localeCompare(right.metadata.identifier);

const sameAcceptedTip = (left: VerifiedTip, right: VerifiedTip) =>
  left.targetId === right.targetId &&
  left.transactionSignature === right.transactionSignature &&
  sameName(left.senderName, right.senderName) &&
  left.senderAddress === right.senderAddress &&
  sameName(left.recipientName, right.recipientName) &&
  left.recipientAddress === right.recipientAddress &&
  left.amountQort === right.amountQort;

const diagnostic = (
  code: TipDiagnosticCode,
  identifier: string,
  detail: string
): TipDiagnostic => ({ code, identifier, detail });

const validateRecord = (
  record: TipReferenceRecord,
  authority: V2State
): TipDiagnostic | VerifiedTip => {
  const { metadata, envelope, referenceTransaction, paymentTransaction } =
    record;
  const body = envelope.body;
  const metadataValidation = validateMetadata(metadata);
  if (metadataValidation.ok === false)
    return diagnostic(
      'TIP_MISSING_TRUSTED_METADATA',
      metadata.identifier,
      metadataValidation.detail
    );
  if (metadata.updated !== null)
    return diagnostic(
      'TIP_REFERENCE_REPUBLISHED',
      metadata.identifier,
      'tip references are immutable and may not be updated'
    );
  if (
    !metadata.latestSignature ||
    referenceTransaction.signature !== metadata.latestSignature ||
    referenceTransaction.type !== 'ARBITRARY' ||
    referenceTransaction.method !== 'PUT' ||
    referenceTransaction.timestamp !== metadata.created ||
    !sameName(referenceTransaction.name, metadata.publisherName) ||
    referenceTransaction.identifier !== metadata.identifier ||
    referenceTransaction.blockHeight <= 0 ||
    (referenceTransaction.approvalStatus !== 'NOT_REQUIRED' &&
      referenceTransaction.approvalStatus !== 'APPROVED')
  )
    return diagnostic(
      'TIP_REFERENCE_TRANSACTION_MISMATCH',
      metadata.identifier,
      'QDN reference metadata does not match its confirmed publication transaction'
    );
  if (!sameName(metadata.publisherName, body.senderName))
    return diagnostic(
      'TIP_UNAUTHORIZED_PUBLISHER',
      metadata.identifier,
      'only the payment sender may publish its tip reference'
    );
  if (!sameAddress(referenceTransaction.creatorAddress, body.senderAddress))
    return diagnostic(
      'TIP_SENDER_MISMATCH',
      metadata.identifier,
      'tip-reference publisher wallet does not match the claimed sender wallet'
    );
  if (
    envelope.targetId !== body.targetId ||
    envelope.recordId !== metadata.identifier
  )
    return diagnostic(
      'TIP_TARGET_MISMATCH',
      metadata.identifier,
      'tip-reference envelope target or record identifier is inconsistent'
    );
  const target = authority.entities[body.targetId];
  if (!target || target.entityType !== 'post')
    return diagnostic(
      'TIP_TARGET_UNAVAILABLE',
      metadata.identifier,
      'tip target is not an authoritative V2 Post'
    );
  if (
    !sameName(body.recipientName, target.publisherName) ||
    !sameAddress(body.recipientAddress, target.walletAddress)
  )
    return diagnostic(
      'TIP_RECIPIENT_MISMATCH',
      metadata.identifier,
      'tip reference recipient does not match the authoritative Post owner'
    );
  if (
    paymentTransaction.signature !== body.transactionSignature ||
    paymentTransaction.type !== 'TRANSFER_ASSET' ||
    paymentTransaction.assetId !== 0 ||
    paymentTransaction.blockHeight <= 0 ||
    (paymentTransaction.approvalStatus !== 'NOT_REQUIRED' &&
      paymentTransaction.approvalStatus !== 'APPROVED')
  )
    return diagnostic(
      'TIP_TRANSACTION_INVALID',
      metadata.identifier,
      'referenced QORT transfer is not confirmed and valid'
    );
  if (!sameAddress(paymentTransaction.creatorAddress, body.senderAddress))
    return diagnostic(
      'TIP_SENDER_MISMATCH',
      metadata.identifier,
      'payment transaction sender does not match the tip reference'
    );
  if (!sameAddress(paymentTransaction.recipient, body.recipientAddress))
    return diagnostic(
      'TIP_RECIPIENT_MISMATCH',
      metadata.identifier,
      'payment transaction recipient does not match the authoritative Post owner'
    );
  if (paymentTransaction.amountQort !== body.amountQort)
    return diagnostic(
      'TIP_AMOUNT_MISMATCH',
      metadata.identifier,
      'payment transaction amount does not match the tip reference'
    );
  return {
    targetId: body.targetId,
    transactionSignature: body.transactionSignature,
    senderName: body.senderName,
    senderAddress: body.senderAddress,
    recipientName: body.recipientName,
    recipientAddress: body.recipientAddress,
    amountQort: body.amountQort,
    trustedPaymentTimestamp: paymentTransaction.timestamp,
    trustedPaymentBlockHeight: paymentTransaction.blockHeight,
    trustedPaymentBlockSequence: paymentTransaction.blockSequence,
    referenceIdentifier: metadata.identifier,
    referencePublisher: metadata.publisherName,
    referenceCreated: metadata.created,
    referenceSignature: referenceTransaction.signature,
  };
};

const isDiagnostic = (
  value: TipDiagnostic | VerifiedTip
): value is TipDiagnostic => 'code' in value;

const sortDiagnostics = (values: TipDiagnostic[]) =>
  values.sort(
    (left, right) =>
      left.identifier.localeCompare(right.identifier) ||
      left.code.localeCompare(right.code) ||
      left.detail.localeCompare(right.detail)
  );

export const reduceTipReferences = (
  records: TipReferenceRecord[],
  authority: V2State,
  initialDiagnostics: TipDiagnostic[] = [],
  status: ReducedTipState['status'] = 'VERIFIED'
): ReducedTipState => {
  const diagnostics = [...initialDiagnostics];
  const acceptedBySignature = new Map<string, VerifiedTip>();
  const conflictedSignatures = new Set<string>();
  for (const record of [...records].sort(orderTipRecords)) {
    const checked = validateRecord(record, authority);
    if (isDiagnostic(checked)) {
      diagnostics.push(checked);
      continue;
    }
    const signature = normalizeSignature(checked.transactionSignature);
    if (conflictedSignatures.has(signature)) continue;
    const existing = acceptedBySignature.get(signature);
    if (existing) {
      diagnostics.push(
        diagnostic(
          sameAcceptedTip(existing, checked)
            ? 'TIP_DUPLICATE_REFERENCE'
            : 'TIP_REFERENCE_CONFLICT',
          checked.referenceIdentifier,
          sameAcceptedTip(existing, checked)
            ? 'duplicate reference to the same payment was counted once'
            : 'conflicting valid metadata claims the same payment signature'
        )
      );
      if (!sameAcceptedTip(existing, checked)) {
        acceptedBySignature.delete(signature);
        conflictedSignatures.add(signature);
      }
      continue;
    }
    acceptedBySignature.set(signature, checked);
  }

  const ordered = [...acceptedBySignature.values()].sort((left, right) =>
    left.trustedPaymentBlockHeight !== right.trustedPaymentBlockHeight
      ? left.trustedPaymentBlockHeight - right.trustedPaymentBlockHeight
      : (left.trustedPaymentBlockSequence ?? -1) !==
          (right.trustedPaymentBlockSequence ?? -1)
        ? (left.trustedPaymentBlockSequence ?? -1) -
          (right.trustedPaymentBlockSequence ?? -1)
        : left.trustedPaymentTimestamp !== right.trustedPaymentTimestamp
          ? left.trustedPaymentTimestamp - right.trustedPaymentTimestamp
          : left.transactionSignature.localeCompare(right.transactionSignature)
  );
  const byTarget: Record<string, VerifiedTipSummary> = {};
  const bySignature: Record<string, VerifiedTip> = {};
  for (const tip of ordered) {
    bySignature[tip.transactionSignature] = tip;
    const current = byTarget[tip.targetId] ?? {
      targetId: tip.targetId,
      verifiedCount: 0,
      verifiedTotalQort: atomicToQort(0n),
      tips: [],
    };
    const nextTips = [...current.tips, tip];
    byTarget[tip.targetId] = {
      targetId: tip.targetId,
      verifiedCount: nextTips.length,
      verifiedTotalQort: atomicToQort(
        nextTips.reduce(
          (total, entry) => total + (qortToAtomic(entry.amountQort) ?? 0n),
          0n
        )
      ),
      tips: nextTips,
    };
  }
  return {
    status,
    byTarget,
    bySignature,
    diagnostics: sortDiagnostics(diagnostics),
  };
};

export const loadTipReferences = async (
  resources: DiscoveredTipResource[],
  authority: V2State,
  dependencies: TipLoaderDependencies,
  discoveryComplete = true
): Promise<ReducedTipState> => {
  const records: TipReferenceRecord[] = [];
  const diagnostics: TipDiagnostic[] = [];
  let unavailable = !discoveryComplete;
  if (!discoveryComplete)
    diagnostics.push(
      diagnostic(
        'TIP_DISCOVERY_INCOMPLETE',
        '<tip-discovery>',
        'tip-reference discovery exceeded its safety budget'
      )
    );
  for (const resource of resources) {
    const identifier =
      typeof resource.identifier === 'string'
        ? resource.identifier
        : '<unknown>';
    if (
      typeof resource.name !== 'string' ||
      !resource.name.trim() ||
      typeof resource.identifier !== 'string' ||
      !resource.identifier.trim() ||
      typeof resource.service !== 'string' ||
      !resource.service.trim() ||
      typeof resource.created !== 'number' ||
      !Number.isSafeInteger(resource.created) ||
      typeof resource.latestSignature !== 'string' ||
      !resource.latestSignature.trim() ||
      (resource.updated !== undefined &&
        resource.updated !== null &&
        (typeof resource.updated !== 'number' ||
          !Number.isSafeInteger(resource.updated)))
    ) {
      diagnostics.push(
        diagnostic(
          'TIP_MISSING_TRUSTED_METADATA',
          identifier,
          'tip-reference resource lacks trusted Core metadata'
        )
      );
      continue;
    }
    let payload: unknown;
    try {
      payload = await dependencies.fetchPayload(resource);
    } catch {
      diagnostics.push(
        diagnostic(
          'TIP_REFERENCE_UNAVAILABLE',
          identifier,
          'tip-reference payload is unavailable'
        )
      );
      unavailable = true;
      continue;
    }
    if (!isTipReferenceEnvelope(payload)) {
      diagnostics.push(
        diagnostic(
          classifyInvalidTipReference(payload),
          identifier,
          'invalid tip-reference envelope'
        )
      );
      continue;
    }
    const expectedIdentifier = await dependencies.expectedIdentifier(
      payload.body.transactionSignature
    );
    if (expectedIdentifier !== identifier || payload.recordId !== identifier) {
      diagnostics.push(
        diagnostic(
          'TIP_IDENTIFIER_MISMATCH',
          identifier,
          'tip-reference identifier is not the canonical payment-signature identifier'
        )
      );
      continue;
    }
    const [referenceLookup, paymentLookup] = await Promise.all([
      dependencies.fetchReferenceTransaction(resource.latestSignature),
      dependencies.fetchPaymentTransaction(payload.body.transactionSignature),
    ]);
    if (referenceLookup.status !== 'found') {
      diagnostics.push(
        diagnostic(
          referenceLookup.status === 'invalid'
            ? referenceLookup.code
            : referenceLookup.status === 'not-found'
              ? 'TIP_REFERENCE_TRANSACTION_MISMATCH'
              : 'TIP_VERIFICATION_UNAVAILABLE',
          identifier,
          referenceLookup.detail
        )
      );
      if (referenceLookup.status === 'unavailable') unavailable = true;
      continue;
    }
    if (paymentLookup.status !== 'found') {
      diagnostics.push(
        diagnostic(
          paymentLookup.status === 'invalid'
            ? paymentLookup.code
            : paymentLookup.status === 'not-found'
              ? 'TIP_TRANSACTION_NOT_FOUND'
              : 'TIP_VERIFICATION_UNAVAILABLE',
          identifier,
          paymentLookup.detail
        )
      );
      if (
        paymentLookup.status === 'unavailable' ||
        paymentLookup.status === 'not-found'
      )
        unavailable = true;
      continue;
    }
    records.push({
      metadata: {
        service: resource.service,
        publisherName: resource.name,
        identifier,
        created: resource.created,
        updated: resource.updated ?? null,
        latestSignature: resource.latestSignature,
      },
      envelope: payload,
      referenceTransaction: referenceLookup.evidence,
      paymentTransaction: paymentLookup.evidence,
    });
  }
  return reduceTipReferences(
    records,
    authority,
    diagnostics,
    unavailable ? 'UNAVAILABLE' : 'VERIFIED'
  );
};

export const resolveTipDisplay = (
  targetId: string,
  legacyCount: number,
  state: ReducedTipState
) => {
  const verified = state.byTarget[targetId];
  return {
    status:
      state.status === 'VERIFIED'
        ? ('verified' as const)
        : ('unavailable' as const),
    verifiedCount: verified?.verifiedCount ?? 0,
    verifiedTotalQort: verified?.verifiedTotalQort ?? atomicToQort(0n),
    legacyCount:
      Number.isSafeInteger(legacyCount) && legacyCount > 0 ? legacyCount : 0,
    legacyIsUnverified: true as const,
    diagnostics: [
      ...state.diagnostics
        .filter(
          (entry) =>
            entry.identifier === targetId ||
            verified?.tips.some(
              (tip) => tip.referenceIdentifier === entry.identifier
            )
        )
        .map((entry) => ({ code: entry.code, detail: entry.detail })),
      ...(Number.isSafeInteger(legacyCount) && legacyCount > 0
        ? [
            {
              code: 'TIP_LEGACY_UNVERIFIED' as const,
              detail:
                'legacy mutable tip counter is historical display data only',
            },
          ]
        : []),
    ],
  };
};
