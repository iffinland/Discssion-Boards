import {
  atomicToQort,
  buildTipReferenceEnvelope,
  buildTipReferenceIdentifier,
  classifyInvalidTipReference,
  isTipReferenceEnvelope,
  loadTipReferences,
  normalizeQortAmount,
  reduceTipReferences,
  resolveTipDisplay,
  type QortTransferEvidence,
  type TipEvidenceLookup,
  type TipReferenceBody,
  type TipReferenceRecord,
  type TipReferenceTransactionEvidence,
} from '../src/services/architectureV2/tips.js';
import type { V2RuntimeState } from '../src/services/architectureV2/runtime.js';
import {
  createForumTipsService,
  finalizeTipDerivedState,
  isTipRecovery,
  parseCoreQortTransfer,
  type ForumTipsDependencies,
} from '../src/services/qdn/forumTipsService.js';
import type { Post } from '../src/types/index.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const authority: V2RuntimeState = {
  authoritative: {
    entities: {
      'post-1': {
        entityType: 'post',
        entityId: 'post-1',
        parentThreadId: 'thread-1',
        parentPostId: null,
        content: 'authoritative content',
        publisherName: 'alice',
        walletAddress: 'ALICE-ADDRESS',
      },
      'post-2': {
        entityType: 'post',
        entityId: 'post-2',
        parentThreadId: 'thread-1',
        parentPostId: null,
        content: 'second authoritative content',
        publisherName: 'alice',
        walletAddress: 'ALICE-ADDRESS',
      },
    },
    quarantined: [],
  },
  diagnostics: [],
  discovery: {
    completeness: 'complete',
    pagesFetched: 1,
    resourcesSeen: 1,
    stoppedReason: 'fixture',
    source: 'provided-record-set',
  },
};

const paymentEvidence = (
  signature: string,
  input?: Partial<QortTransferEvidence>
): QortTransferEvidence => ({
  type: 'TRANSFER_ASSET',
  signature,
  creatorAddress: 'SENDER-ADDRESS',
  recipient: 'ALICE-ADDRESS',
  amountQort: '1.25000000',
  assetId: 0,
  timestamp: 100,
  blockHeight: 20,
  blockSequence: 1,
  approvalStatus: 'NOT_REQUIRED',
  ...input,
});

const referenceEvidence = (
  signature: string,
  identifier: string,
  input?: Partial<TipReferenceTransactionEvidence>
): TipReferenceTransactionEvidence => ({
  type: 'ARBITRARY',
  method: 'PUT',
  signature,
  creatorAddress: 'SENDER-ADDRESS',
  timestamp: 200,
  name: 'sender',
  identifier,
  blockHeight: 30,
  blockSequence: 2,
  approvalStatus: 'NOT_REQUIRED',
  ...input,
});

const bodyFor = (
  signature: string,
  input?: Partial<TipReferenceBody>
): TipReferenceBody => ({
  operation: 'tip-reference',
  targetType: 'post',
  targetId: 'post-1',
  transactionSignature: signature,
  senderName: 'sender',
  senderAddress: 'SENDER-ADDRESS',
  recipientName: 'alice',
  recipientAddress: 'ALICE-ADDRESS',
  amountQort: '1.25000000',
  ...input,
});

const recordFor = async (
  signature: string,
  input?: {
    body?: Partial<TipReferenceBody>;
    payment?: Partial<QortTransferEvidence>;
    publisher?: string;
    referenceCreator?: string;
    created?: number;
  }
): Promise<TipReferenceRecord> => {
  const identifier = await buildTipReferenceIdentifier('qdbm', signature);
  const body = bodyFor(signature, input?.body);
  const created = input?.created ?? 200;
  const referenceSignature = `ref-${signature}`;
  return {
    metadata: {
      service: 'DOCUMENT',
      publisherName: input?.publisher ?? 'sender',
      identifier,
      created,
      updated: null,
      latestSignature: referenceSignature,
    },
    envelope: buildTipReferenceEnvelope(body, identifier),
    referenceTransaction: referenceEvidence(referenceSignature, identifier, {
      creatorAddress: input?.referenceCreator ?? 'SENDER-ADDRESS',
      timestamp: created,
      name: input?.publisher ?? 'sender',
    }),
    paymentTransaction: paymentEvidence(signature, input?.payment),
  };
};

const canonical = await recordFor('tx-success');
assert(isTipReferenceEnvelope(canonical.envelope), 'strict reference accepted');
assert(
  normalizeQortAmount('1.25') === '1.25000000' &&
    atomicToQort(125_000_000n) === '1.25000000',
  'exact eight-decimal amount normalization'
);
const basic = reduceTipReferences([canonical], authority.authoritative);
assert(
  basic.bySignature['tx-success'] !== undefined,
  'correct sender accepted'
);
assert(
  basic.bySignature['tx-success']?.recipientAddress === 'ALICE-ADDRESS',
  'correct authoritative recipient accepted'
);
assert(
  basic.bySignature['tx-success']?.amountQort === '1.25000000',
  'exact claimed amount accepted only after transaction match'
);
assert(basic.byTarget['post-1']?.verifiedCount === 1, 'verified count derived');
assert(
  basic.byTarget['post-1']?.verifiedTotalQort === '1.25000000',
  'verified total derived'
);

const forgedSender = await recordFor('tx-forged-sender', {
  body: { senderAddress: 'FORGED' },
});
assert(
  reduceTipReferences([forgedSender], authority.authoritative).diagnostics[0]
    ?.code === 'TIP_REFERENCE_TRANSACTION_MISMATCH' ||
    reduceTipReferences([forgedSender], authority.authoritative).diagnostics[0]
      ?.code === 'TIP_SENDER_MISMATCH',
  'forged sender rejected'
);
const wrongRecipient = await recordFor('tx-wrong-recipient', {
  body: { recipientAddress: 'MALLORY' },
});
assert(
  reduceTipReferences([wrongRecipient], authority.authoritative).diagnostics[0]
    ?.code === 'TIP_RECIPIENT_MISMATCH',
  'wrong recipient rejected'
);
const wrongAmount = await recordFor('tx-wrong-amount', {
  body: { amountQort: '2.00000000' },
});
assert(
  reduceTipReferences([wrongAmount], authority.authoritative).diagnostics[0]
    ?.code === 'TIP_AMOUNT_MISMATCH',
  'amount mismatch rejected'
);
const unauthorizedPublisher = await recordFor('tx-unauthorized', {
  publisher: 'mallory',
});
assert(
  reduceTipReferences([unauthorizedPublisher], authority.authoritative)
    .diagnostics[0]?.code === 'TIP_UNAUTHORIZED_PUBLISHER',
  'arbitrary publisher cannot fabricate tip authority'
);
assert(
  reduceTipReferences(
    [
      canonical,
      {
        ...unauthorizedPublisher,
        paymentTransaction: canonical.paymentTransaction,
      },
    ],
    authority.authoritative
  ).bySignature['tx-success'] !== undefined,
  'unauthorized duplicate cannot suppress a valid sender reference'
);
const missingTarget = await recordFor('tx-missing-target', {
  body: { targetId: 'post-missing' },
});
assert(
  reduceTipReferences([missingTarget], authority.authoritative).diagnostics[0]
    ?.code === 'TIP_TARGET_UNAVAILABLE',
  'operation targeting a non-authoritative Post is rejected'
);
const republished = {
  ...canonical,
  metadata: { ...canonical.metadata, updated: canonical.metadata.created + 1 },
};
assert(
  reduceTipReferences([republished], authority.authoritative).diagnostics[0]
    ?.code === 'TIP_REFERENCE_REPUBLISHED',
  'mutable rewrite of an immutable tip reference is rejected'
);
const transactionMismatch = {
  ...canonical,
  referenceTransaction: {
    ...canonical.referenceTransaction,
    timestamp: canonical.metadata.created + 1,
  },
};
assert(
  reduceTipReferences([transactionMismatch], authority.authoritative)
    .diagnostics[0]?.code === 'TIP_REFERENCE_TRANSACTION_MISMATCH',
  'QDN metadata and publication transaction must agree'
);

const duplicate = reduceTipReferences(
  [canonical, { ...canonical }],
  authority.authoritative
);
assert(
  duplicate.byTarget['post-1']?.verifiedCount === 1 &&
    duplicate.diagnostics.some(
      (entry) => entry.code === 'TIP_DUPLICATE_REFERENCE'
    ),
  'duplicate QDN reference counted once'
);
const alternateIdentifier = 'qdbm-v2-tip-alternate';
const alternateEnvelope = buildTipReferenceEnvelope(
  canonical.envelope.body,
  alternateIdentifier
);
const alternateReference = referenceEvidence(
  'ref-alternate',
  alternateIdentifier,
  { timestamp: 201 }
);
const multipleIdentifierLoad = await loadTipReferences(
  [
    {
      name: 'sender',
      identifier: canonical.metadata.identifier,
      service: 'DOCUMENT',
      created: canonical.metadata.created,
      updated: null,
      latestSignature: canonical.referenceTransaction.signature,
    },
    {
      name: 'sender',
      identifier: alternateIdentifier,
      service: 'DOCUMENT',
      created: 201,
      updated: null,
      latestSignature: alternateReference.signature,
    },
  ],
  authority.authoritative,
  {
    fetchPayload: async (resource) =>
      resource.identifier === alternateIdentifier
        ? alternateEnvelope
        : canonical.envelope,
    expectedIdentifier: (signature) =>
      buildTipReferenceIdentifier('qdbm', signature),
    fetchReferenceTransaction: async (signature) => ({
      status: 'found',
      evidence:
        signature === alternateReference.signature
          ? alternateReference
          : canonical.referenceTransaction,
    }),
    fetchPaymentTransaction: async () => ({
      status: 'found',
      evidence: canonical.paymentTransaction,
    }),
  }
);
assert(
  multipleIdentifierLoad.byTarget['post-1']?.verifiedCount === 1 &&
    multipleIdentifierLoad.diagnostics.some(
      (entry) => entry.code === 'TIP_IDENTIFIER_MISMATCH'
    ),
  'same signature under multiple identifiers counts only the canonical resource'
);
const conflict = await recordFor('tx-conflict', {
  body: { targetId: 'post-2' },
});
const conflictOriginal = await recordFor('tx-conflict');
const conflicted = reduceTipReferences(
  [conflict, conflictOriginal],
  authority.authoritative
);
assert(
  !conflicted.bySignature['tx-conflict'] &&
    conflicted.diagnostics.some(
      (entry) => entry.code === 'TIP_REFERENCE_CONFLICT'
    ),
  'same payment cannot be attached to conflicting targets'
);

const concurrent = await Promise.all([
  recordFor('tx-a', {
    payment: { amountQort: '0.50000000', timestamp: 101 },
    body: { amountQort: '0.50000000' },
    created: 201,
  }),
  recordFor('tx-b', {
    payment: { amountQort: '1.00000000', timestamp: 102 },
    body: { amountQort: '1.00000000' },
    created: 202,
  }),
  recordFor('tx-c', {
    payment: { amountQort: '2.25000000', timestamp: 103 },
    body: { amountQort: '2.25000000' },
    created: 203,
  }),
]);
const concurrentState = reduceTipReferences(
  concurrent,
  authority.authoritative
);
assert(
  concurrentState.byTarget['post-1']?.verifiedCount === 3 &&
    concurrentState.byTarget['post-1']?.verifiedTotalQort === '3.75000000',
  'independent concurrent tips all count with exact total'
);
assert(
  JSON.stringify(concurrentState) ===
    JSON.stringify(
      reduceTipReferences([...concurrent].reverse(), authority.authoritative)
    ),
  'input order permutations are deterministic'
);

const wrongType = parseCoreQortTransfer(
  { type: 'PAYMENT', signature: 'wrong-type' },
  'wrong-type'
);
assert(
  wrongType.status === 'invalid' &&
    wrongType.code === 'TIP_WRONG_TRANSACTION_TYPE',
  'older PAYMENT shape is rejected under current TRANSFER_ASSET capability'
);
const rejected = parseCoreQortTransfer(
  {
    type: 'TRANSFER_ASSET',
    signature: 'rejected',
    creatorAddress: 'SENDER-ADDRESS',
    recipient: 'ALICE-ADDRESS',
    amount: '1.25000000',
    assetId: 0,
    timestamp: 100,
    blockHeight: 20,
    approvalStatus: 'REJECTED',
  },
  'rejected'
);
assert(
  rejected.status === 'invalid' && rejected.code === 'TIP_TRANSACTION_INVALID',
  'rejected transaction is not accepted'
);
const unconfirmed = parseCoreQortTransfer(
  {
    type: 'TRANSFER_ASSET',
    signature: 'unconfirmed',
    creatorAddress: 'SENDER-ADDRESS',
    recipient: 'ALICE-ADDRESS',
    amount: '1.25000000',
    assetId: 0,
    timestamp: 100,
    blockHeight: null,
    approvalStatus: 'NOT_REQUIRED',
  },
  'unconfirmed'
);
assert(
  unconfirmed.status === 'unavailable',
  'unconfirmed existing transfer remains pending rather than falsely invalid'
);
assert(
  classifyInvalidTipReference({ body: { transactionSignature: '' } }) ===
    'TIP_MISSING_SIGNATURE',
  'missing signature has stable diagnostic'
);

type MockState = {
  resources: Array<{
    name: string;
    identifier: string;
    service: string;
    created: number;
    updated: null;
    latestSignature: string;
    payload: unknown;
  }>;
  payments: Map<string, TipEvidenceLookup<QortTransferEvidence>>;
  references: Map<string, TipEvidenceLookup<TipReferenceTransactionEvidence>>;
  sendCount: number;
  publishCount: number;
  nextSignature: string;
  sendError: Error | null;
  verificationUnavailable: boolean;
  failPublish: boolean;
};

const makeMock = (): {
  state: MockState;
  dependencies: ForumTipsDependencies;
} => {
  const state: MockState = {
    resources: [],
    payments: new Map(),
    references: new Map(),
    sendCount: 0,
    publishCount: 0,
    nextSignature: 'tx-runtime',
    sendError: null,
    verificationUnavailable: false,
    failPublish: false,
  };
  const dependencies: ForumTipsDependencies = {
    discoverResources: async () => ({
      resources: state.resources,
      complete: true,
    }),
    referenceExists: async (publisherName, identifier) =>
      state.resources.some(
        (resource) =>
          resource.name === publisherName && resource.identifier === identifier
      ),
    fetchPayload: async (resource) => {
      const found = state.resources.find(
        (entry) =>
          entry.name === resource.name &&
          entry.identifier === resource.identifier
      );
      if (!found) throw new Error('unavailable');
      return found.payload;
    },
    fetchReferenceTransaction: async (signature) =>
      state.references.get(signature) ?? {
        status: 'not-found',
        detail: 'reference transaction not found',
      },
    fetchPaymentTransaction: async (signature) =>
      state.verificationUnavailable
        ? { status: 'unavailable', detail: 'Core temporarily unavailable' }
        : (state.payments.get(signature) ?? {
            status: 'not-found',
            detail: 'transaction unknown',
          }),
    publishReference: async (publisherName, envelope) => {
      state.publishCount += 1;
      if (state.failPublish) throw new Error('QDN publication failed');
      const created = 500 + state.publishCount;
      const referenceSignature = `qdn-${state.publishCount}`;
      state.resources.push({
        name: publisherName,
        identifier: envelope.recordId,
        service: 'DOCUMENT',
        created,
        updated: null,
        latestSignature: referenceSignature,
        payload: envelope,
      });
      state.references.set(referenceSignature, {
        status: 'found',
        evidence: referenceEvidence(referenceSignature, envelope.recordId, {
          timestamp: created,
          name: publisherName,
        }),
      });
    },
    sendQort: async (recipient, amountQort) => {
      state.sendCount += 1;
      if (state.sendError) throw state.sendError;
      const signature = state.nextSignature;
      state.payments.set(signature, {
        status: 'found',
        evidence: paymentEvidence(signature, {
          recipient,
          amountQort,
        }),
      });
      return {
        accepted: true,
        action: 'SEND_COIN',
        recipient,
        amount: amountQort,
        assetId: 0,
        transactionSignature: signature,
      };
    },
    getSelectedAccount: async () => ({
      address: 'SENDER-ADDRESS',
      name: 'another-name-on-the-same-wallet',
    }),
    resolveNameWalletAddress: async (name) =>
      name === 'sender' ? 'SENDER-ADDRESS' : null,
  };
  return { state, dependencies };
};

const runtime = makeMock();
const runtimeService = createForumTipsService(runtime.dependencies);
const submitted = await runtimeService.submit({
  postId: 'post-1',
  amountQort: '1.25',
  senderName: 'sender',
  senderAddress: 'SENDER-ADDRESS',
  authority,
});
assert(
  submitted.ok &&
    submitted.status === 'VERIFIED' &&
    submitted.transactionSignature === 'tx-runtime',
  'SEND_COIN signature is preserved through verified reference publication'
);
assert(
  runtime.state.sendCount === 1 && runtime.state.publishCount === 1,
  'transaction-first path sends and independently publishes exactly once'
);
const futureTimestampEnvelope = {
  ...canonical.envelope,
  clientCreatedAt: '9999-12-31T23:59:59.999Z',
};
assert(
  reduceTipReferences(
    [canonical, { ...canonical, envelope: futureTimestampEnvelope }],
    authority.authoritative
  ).byTarget['post-1']?.verifiedCount === 1,
  'future client timestamp cannot create or order additional tip authority'
);
const reloaded = await runtimeService.load(authority);
assert(
  JSON.stringify(reloaded) ===
    JSON.stringify(
      await loadTipReferences(
        [...runtime.state.resources].reverse(),
        authority.authoritative,
        {
          fetchPayload: runtime.dependencies.fetchPayload,
          expectedIdentifier: (signature) =>
            buildTipReferenceIdentifier('qdbm', signature),
          fetchReferenceTransaction:
            runtime.dependencies.fetchReferenceTransaction,
          fetchPaymentTransaction: runtime.dependencies.fetchPaymentTransaction,
        }
      )
    ),
  'reload reconstructs identical verified state independent of discovery order'
);

const originalPost: Post = {
  id: 'post-1',
  subTopicId: 'thread-1',
  authorUserId: 'forged-snapshot-author',
  parentPostId: null,
  content: 'legacy display content',
  attachments: [],
  poll: {
    kind: 'legacy',
    id: 'poll',
    question: 'Question?',
    description: '',
    mode: 'single',
    options: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
    votes: [],
    closesAt: null,
    closedAt: null,
    closedByUserId: null,
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  likes: 9,
  tips: 7,
  likedByAddresses: ['legacy-like'],
  isPinned: true,
  moderationHidden: true,
};
const applied = await runtimeService.apply([originalPost], authority);
assert(
  applied[0]?.content === originalPost.content,
  'tip derivation cannot modify Post content'
);
assert(
  applied[0]?.authorUserId === originalPost.authorUserId,
  'tip derivation cannot modify Post author or ownership'
);
assert(
  applied[0]?.likes === originalPost.likes &&
    applied[0]?.likedByAddresses === originalPost.likedByAddresses,
  'tip derivation cannot modify reaction state'
);
assert(
  applied[0]?.poll === originalPost.poll,
  'tip derivation cannot modify poll state'
);
assert(
  applied[0]?.isPinned === originalPost.isPinned &&
    applied[0]?.moderationHidden === originalPost.moderationHidden,
  'tip derivation cannot modify moderation or role state'
);
assert(
  applied[0]?.tips === 7 &&
    applied[0]?.tipSummary?.legacyCount === 7 &&
    applied[0]?.tipSummary?.verifiedCount === 1,
  'legacy counter remains readable and unverified without double counting'
);
assert(
  runtimeService.resolveRecipient(authority, 'post-1')?.name === 'alice' &&
    runtimeService.resolveRecipient(authority, 'post-1')?.address ===
      'ALICE-ADDRESS',
  'forged V1 snapshot author cannot redirect authoritative recipient'
);

const cancelled = makeMock();
cancelled.state.sendError = new Error('User cancelled');
const cancelledResult = await createForumTipsService(
  cancelled.dependencies
).submit({
  postId: 'post-1',
  amountQort: '1',
  senderName: 'sender',
  senderAddress: 'SENDER-ADDRESS',
  authority,
});
assert(
  !cancelledResult.ok &&
    !cancelledResult.paymentCommitted &&
    cancelled.state.resources.length === 0,
  'cancellation or SEND_COIN failure leaves no tip authority'
);

const unboundSender = makeMock();
unboundSender.dependencies.resolveNameWalletAddress = async () => null;
const unboundResult = await createForumTipsService(
  unboundSender.dependencies
).submit({
  postId: 'post-1',
  amountQort: '1',
  senderName: 'sender',
  senderAddress: 'SENDER-ADDRESS',
  authority,
});
assert(
  !unboundResult.ok &&
    !unboundResult.paymentCommitted &&
    unboundSender.state.sendCount === 0,
  'unverified sender name/wallet binding fails before SEND_COIN'
);

const pending = makeMock();
pending.state.verificationUnavailable = true;
const pendingService = createForumTipsService(pending.dependencies);
const pendingResult = await pendingService.submit({
  postId: 'post-1',
  amountQort: '1',
  senderName: 'sender',
  senderAddress: 'SENDER-ADDRESS',
  authority,
});
assert(
  pendingResult.ok &&
    pendingResult.status === 'PARTIAL' &&
    pendingResult.pending === 'transaction-verification' &&
    pendingResult.transactionSignature === 'tx-runtime' &&
    pending.state.publishCount === 0,
  'verification unavailable preserves signature and recovery without reference claim'
);

const publicationFailure = makeMock();
publicationFailure.state.failPublish = true;
const recoveryService = createForumTipsService(publicationFailure.dependencies);
const failedReference = await recoveryService.submit({
  postId: 'post-1',
  amountQort: '1',
  senderName: 'sender',
  senderAddress: 'SENDER-ADDRESS',
  authority,
});
assert(
  failedReference.ok &&
    failedReference.status === 'PARTIAL' &&
    failedReference.pending === 'reference-publication' &&
    publicationFailure.state.sendCount === 1,
  'reference publication failure retains payment recovery state'
);
assert(
  failedReference.ok &&
    failedReference.status === 'PARTIAL' &&
    isTipRecovery(failedReference.recovery),
  'structured recovery retains validated signature and reference evidence'
);
publicationFailure.state.failPublish = false;
assert(
  failedReference.ok && failedReference.status === 'PARTIAL',
  'recovery exists'
);
const recovered = await recoveryService.retry(
  failedReference.recovery,
  authority
);
assert(
  recovered.ok &&
    recovered.status === 'VERIFIED' &&
    publicationFailure.state.sendCount === 1,
  'retry publishes only the reference and never repeats SEND_COIN'
);

const cacheFailure = await finalizeTipDerivedState(submitted, async () => {
  throw new Error('cache unavailable');
});
assert(
  cacheFailure.ok &&
    cacheFailure.status === 'PARTIAL' &&
    cacheFailure.pending === 'derived-cache' &&
    cacheFailure.transactionSignature === 'tx-runtime',
  'cache failure preserves verified payment/reference authority'
);

const emptyRuntime = makeMock();
const indexOnly = await createForumTipsService(emptyRuntime.dependencies).apply(
  [{ ...originalPost, tips: 999 }],
  authority
);
assert(
  indexOnly[0]?.tipSummary?.verifiedCount === 0 &&
    indexOnly[0]?.tipSummary?.legacyCount === 999,
  'legacy/index integer cannot establish verified tip authority'
);

const unavailableLoad = await loadTipReferences(
  [
    {
      name: 'sender',
      identifier: 'qdbm-v2-tip-missing',
      service: 'DOCUMENT',
      created: 1,
      updated: null,
      latestSignature: 'ref-missing',
    },
  ],
  authority.authoritative,
  {
    fetchPayload: async () => {
      throw new Error('unavailable');
    },
    expectedIdentifier: (signature) =>
      buildTipReferenceIdentifier('qdbm', signature),
    fetchReferenceTransaction: async () => ({
      status: 'unavailable',
      detail: 'unavailable',
    }),
    fetchPaymentTransaction: async () => ({
      status: 'not-found',
      detail: 'transaction unknown',
    }),
  }
);
assert(
  unavailableLoad.status === 'UNAVAILABLE' &&
    unavailableLoad.diagnostics[0]?.code === 'TIP_REFERENCE_UNAVAILABLE',
  'unavailable reference remains unverified with stable diagnostic'
);

const notFoundResource = {
  name: canonical.metadata.publisherName,
  identifier: canonical.metadata.identifier,
  service: canonical.metadata.service,
  created: canonical.metadata.created,
  updated: canonical.metadata.updated,
  latestSignature: canonical.metadata.latestSignature,
};
const notFoundLoad = await loadTipReferences(
  [notFoundResource],
  authority.authoritative,
  {
    fetchPayload: async () => canonical.envelope,
    expectedIdentifier: (signature) =>
      buildTipReferenceIdentifier('qdbm', signature),
    fetchReferenceTransaction: async () => ({
      status: 'found',
      evidence: canonical.referenceTransaction,
    }),
    fetchPaymentTransaction: async () => ({
      status: 'not-found',
      detail: 'transaction unknown',
    }),
  }
);
assert(
  notFoundLoad.status === 'UNAVAILABLE' &&
    notFoundLoad.diagnostics[0]?.code === 'TIP_TRANSACTION_NOT_FOUND' &&
    Object.keys(notFoundLoad.bySignature).length === 0,
  'nonexistent transaction is pending/unverified and never counted'
);

const existingPending = makeMock();
const existingSignature = 'tx-existing-pending';
const existingBody = bodyFor(existingSignature);
const existingIdentifier = await buildTipReferenceIdentifier(
  'qdbm',
  existingSignature
);
existingPending.state.payments.set(existingSignature, {
  status: 'found',
  evidence: paymentEvidence(existingSignature),
});
existingPending.state.resources.push({
  name: 'sender',
  identifier: existingIdentifier,
  service: 'DOCUMENT',
  created: 700,
  updated: null,
  latestSignature: 'qdn-pending',
  payload: buildTipReferenceEnvelope(existingBody, existingIdentifier),
});
existingPending.state.references.set('qdn-pending', {
  status: 'unavailable',
  detail: 'reference transaction awaiting confirmation',
});
const existingPendingResult = await createForumTipsService(
  existingPending.dependencies
).retry(
  {
    schema: 'qdb-tip-recovery',
    schemaVersion: 1,
    phase: 'reference-refresh',
    recordId: existingIdentifier,
    body: existingBody,
  },
  authority
);
assert(
  existingPendingResult.ok &&
    existingPendingResult.status === 'PARTIAL' &&
    existingPending.state.publishCount === 0,
  'retry never republishes an existing immutable reference awaiting verification'
);

const legacyDisplay = resolveTipDisplay(
  'legacy-post',
  4,
  reduceTipReferences([], authority.authoritative)
);
assert(
  legacyDisplay.verifiedCount === 0 &&
    legacyDisplay.legacyCount === 4 &&
    legacyDisplay.diagnostics.some(
      (entry) => entry.code === 'TIP_LEGACY_UNVERIFIED'
    ),
  'legacy tip state is explicitly historical and unverified'
);

console.log('Architecture V2 verified tip tests passed');
