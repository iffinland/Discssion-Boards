import {
  buildNativePollRecovery,
  classifyInvalidNativePollReference,
  confirmNativePoll,
  createNativePoll,
  decodeNativePollDefinition,
  encodeNativePollDefinition,
  isNativePollReference,
  isNativePostPoll,
  reduceNativePollState,
  referenceFromRecovery,
  publishNativePollReference,
  sameNativePollReference,
  submitNativePollVote,
  toPersistedNativePollReference,
  unavailableNativePollState,
  validateNativeOptionSelection,
  type NativePollCoreData,
  type NativePollCoreVotes,
  type NativePollDefinition,
  type NativePollGateway,
} from '../src/services/architectureV2/polls.js';
import {
  buildV2PostEnvelope,
  isV2EntityEnvelope,
  reduceV2RuntimeRecords,
  toV2RuntimeRecord,
} from '../src/services/architectureV2/runtime.js';
import {
  buildCreatePollRequest,
  buildUpdatePollRequest,
  buildVoteOnPollRequest,
  closeNativePoll,
  loadNativePostPoll,
  qortiumNativePollGateway,
} from '../src/services/qortium/nativePollService.js';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const definition: NativePollDefinition = {
  question: 'Choose a path',
  description: 'Core is authoritative.',
  selectionMode: 'single',
  options: [
    { index: 1, label: 'Alpha' },
    { index: 2, label: 'Beta' },
  ],
  startsAt: null,
  closesAt: '2030-01-01T00:00:00.000Z',
};

const corePoll: NativePollCoreData = {
  pollId: 42,
  owner: 'QOWNER',
  pollName: 'qdb-post-1',
  description: encodeNativePollDefinition(definition),
  pollOptions: [{ optionName: 'Alpha' }, { optionName: 'Beta' }],
  published: 10,
  startTime: null,
  endTime: new Date(definition.closesAt!).getTime(),
};

const emptyVotes: NativePollCoreVotes = {
  totalVotes: 0,
  totalVoters: 0,
  voteCounts: { Alpha: 0, Beta: 0 },
  voteWeights: {},
  voteDetails: [],
};

const recovery = buildNativePollRecovery({
  postId: 'post-1',
  pollName: corePoll.pollName,
  creatorName: 'alice',
  creatorAddress: 'QOWNER',
  creationSignature: 'create-signature',
  definition,
});
const reference = referenceFromRecovery(recovery, corePoll);

let copiedPollRejected = false;
try {
  referenceFromRecovery(recovery, {
    ...corePoll,
    pollOptions: [{ optionName: 'Different' }, { optionName: 'Beta' }],
  });
} catch (error) {
  copiedPollRejected =
    error instanceof Error && error.message.includes('POLL_IDENTITY_MISMATCH');
}
assert(
  copiedPollRejected,
  'confirmation rejects a same-name/owner poll with a different definition'
);

assert(
  isNativePollReference(reference),
  'confirmed native reference validates'
);
assert(
  isNativePostPoll(reference),
  'persisted reference is a native Post poll'
);
assert(
  decodeNativePollDefinition(corePoll.description)?.question ===
    definition.question,
  'native definition round trips through Core description'
);
assert(
  classifyInvalidNativePollReference({
    ...reference,
    pollId: null,
  }) === 'MISSING_POLL_ID',
  'missing poll id has a stable diagnostic'
);
assert(
  classifyInvalidNativePollReference({ schema: 'wrong' }) ===
    'MALFORMED_POLL_REFERENCE',
  'malformed reference has a stable diagnostic'
);
assert(
  !isNativePollReference({ ...reference, votes: [] }),
  'native Post reference cannot embed mutable votes'
);
assert(
  !isV2EntityEnvelope({
    ...buildV2PostEnvelope({
      entityType: 'post',
      entityId: 'malformed-post',
      parentThreadId: 'thread-1',
      parentPostId: null,
      publisherName: 'alice',
      walletAddress: 'QOWNER',
      content: 'Malformed poll ref',
    }),
    body: {
      entityType: 'post',
      entityId: 'malformed-post',
      parentThreadId: 'thread-1',
      parentPostId: null,
      publisherName: 'alice',
      walletAddress: 'QOWNER',
      content: 'Malformed poll ref',
      pollReference: { ...reference, pollId: 0 },
    },
  }),
  'malformed poll reference quarantines the containing V2 envelope'
);

const calls: string[] = [];
const gateway: NativePollGateway = {
  async createPoll(input) {
    calls.push(`create:${input.pollName}`);
    return { pollId: null, transactionSignature: 'create-signature' };
  },
  async getPollByName(name) {
    calls.push(`read-name:${name}`);
    return corePoll;
  },
  async getPollById(id) {
    calls.push(`read-id:${id}`);
    return corePoll;
  },
  async getPollVotes(id) {
    calls.push(`votes:${id}`);
    return emptyVotes;
  },
  async vote(id, indexes) {
    calls.push(`vote:${id}:${indexes.join(',')}`);
    return 'vote-signature';
  },
  async updatePoll(input) {
    calls.push(`update:${input.poll.pollId}:${input.endTime}`);
    return 'update-signature';
  },
};

const createRequest = buildCreatePollRequest({
  pollName: corePoll.pollName,
  owner: corePoll.owner,
  definition,
});
assert(
  createRequest.action === 'CREATE_POLL' &&
    createRequest.fee === 0 &&
    createRequest.endTime === corePoll.endTime &&
    createRequest.pollOptions[0]?.optionName === 'Alpha',
  'Home create request uses verified zero-fee schedule and option fields'
);
const voteRequest = buildVoteOnPollRequest(42, [1, 2]);
assert(
  voteRequest.action === 'VOTE_ON_POLL' &&
    voteRequest.optionIndexes.join(',') === '1,2' &&
    voteRequest.fee === 0,
  'Home vote request uses verified optionIndexes and public-compatible zero fee'
);
const updateRequest = buildUpdatePollRequest(corePoll, 1000);
assert(
  updateRequest.action === 'UPDATE_POLL' &&
    updateRequest.newEndTime === 1000 &&
    updateRequest.newPollOptions.length === 2,
  'Home update request preserves the native definition and changes schedule only'
);
const bridgeRequests: Array<Record<string, unknown>> = [];
const testGlobal = globalThis as typeof globalThis & {
  qdnRequest?: (payload: Record<string, unknown>) => Promise<unknown>;
};
testGlobal.qdnRequest = async (payload) => {
  bridgeRequests.push(payload);
  return { transactionSignature: `sig-${String(payload.action)}` };
};
assert(
  (
    await qortiumNativePollGateway.createPoll({
      pollName: corePoll.pollName,
      owner: corePoll.owner,
      definition,
    })
  ).transactionSignature === 'sig-CREATE_POLL',
  'runtime service publishes native creation through the Home bridge'
);
assert(
  (await qortiumNativePollGateway.vote(42, [1])) === 'sig-VOTE_ON_POLL',
  'runtime service publishes native voting through the Home bridge'
);
assert(
  (await qortiumNativePollGateway.updatePoll({
    poll: corePoll,
    endTime: 1000,
  })) === 'sig-UPDATE_POLL',
  'runtime service publishes schedule updates through the Home bridge'
);
assert(
  bridgeRequests.map((request) => request.action).join(',') ===
    'CREATE_POLL,VOTE_ON_POLL,UPDATE_POLL',
  'runtime bridge sees only the three verified native poll actions'
);
delete testGlobal.qdnRequest;

const created = await createNativePoll(
  {
    postId: 'post-1',
    creatorName: 'alice',
    creatorAddress: 'QOWNER',
    definition,
  },
  gateway
);
assert(
  calls[0] === 'create:qdb-post-1' && calls[1] === 'read-name:qdb-post-1',
  'native poll is created before its id is confirmed'
);
assert(
  created.reference?.pollId === 42 &&
    created.reference.creationSignature === 'create-signature' &&
    created.recovery.pollId === 42,
  'confirmed poll id and transaction signature enter the reference'
);
const createdDuringReadFailure = await createNativePoll(
  {
    postId: 'post-read-failure',
    creatorName: 'alice',
    creatorAddress: 'QOWNER',
    definition,
  },
  {
    ...gateway,
    createPoll: async () => ({
      pollId: null,
      transactionSignature: 'pending-signature',
    }),
    getPollByName: async () => {
      throw new Error('Core temporarily unavailable');
    },
  }
);
assert(
  createdDuringReadFailure.reference === null &&
    createdDuringReadFailure.recovery.creationSignature === 'pending-signature',
  'Core confirmation failure preserves retry recovery after successful creation'
);
const failedReferencePublication = await publishNativePollReference(
  reference,
  recovery,
  async () => {
    throw new Error('mocked V2 Post publication failure');
  }
);
assert(
  failedReferencePublication.ok === false &&
    failedReferencePublication.code === 'POLL_REFERENCE_PUBLICATION_FAILED' &&
    failedReferencePublication.recovery.creationSignature ===
      'create-signature',
  'poll created plus Post-reference failure preserves auditable retry recovery'
);

let confirmed = false;
const delayedGateway = {
  getPollByName: async () => (confirmed ? corePoll : null),
  getPollById: async () => (confirmed ? corePoll : null),
};
assert(
  (await confirmNativePoll(created.recovery, delayedGateway)) === null,
  'unconfirmed poll remains a recoverable pending transaction'
);
confirmed = true;
assert(
  (await confirmNativePoll(created.recovery, delayedGateway))?.pollId === 42,
  'saved recovery confirms without creating a duplicate poll'
);

let createFailed = false;
try {
  await createNativePoll(
    {
      postId: 'post-fail',
      creatorName: 'alice',
      creatorAddress: 'QOWNER',
      definition,
    },
    {
      ...gateway,
      createPoll: async () => {
        throw new Error('[POLL_CREATION_FAILED] rejected');
      },
    }
  );
} catch (error) {
  createFailed =
    error instanceof Error && error.message.includes('POLL_CREATION_FAILED');
}
assert(createFailed, 'failed native creation cannot produce a Post reference');

assert(
  validateNativeOptionSelection(reference, [1]).ok,
  'single choice accepts one 1-based Core option index'
);
assert(
  !validateNativeOptionSelection(reference, [0]).ok &&
    !validateNativeOptionSelection(reference, [1, 2]).ok,
  'single choice rejects removal, invalid and multiple selections'
);
const multipleReference = {
  ...reference,
  displayCache: {
    ...reference.displayCache,
    selectionMode: 'multiple' as const,
  },
};
assert(
  validateNativeOptionSelection(multipleReference, [2, 1, 2]).ok,
  'multiple choice normalizes valid indexes'
);
const vote = await submitNativePollVote(multipleReference, [2, 1, 2], gateway);
assert(
  vote.transactionSignature === 'vote-signature' &&
    vote.optionIndexes.join(',') === '1,2' &&
    calls.includes('vote:42:1,2'),
  'native vote uses VOTE_ON_POLL semantics and captures its signature'
);
let voteFailureCoded = false;
try {
  await submitNativePollVote(reference, [1], {
    vote: async () => {
      throw new Error('public capability rejected');
    },
  });
} catch (error) {
  voteFailureCoded =
    error instanceof Error && error.message.startsWith('[POLL_VOTE_FAILED]');
}
assert(voteFailureCoded, 'Home vote rejection receives a stable Phase 3 code');

const votes: NativePollCoreVotes = {
  totalVotes: 3,
  totalVoters: 2,
  totalWeight: 15,
  rawTotalWeight: 20,
  voteCounts: { Alpha: 2, Beta: 1 },
  voteWeights: {
    Alpha: { effective: 10, raw: 14 },
    Beta: { effective: 5, raw: 6 },
  },
  voteDetails: [
    { voterAddress: 'QVOTER', optionIndexes: [2] },
    { voterAddress: 'QOTHER', optionIndexes: [1, 2] },
  ],
};
const runtime = reduceNativePollState(
  multipleReference,
  corePoll,
  votes,
  'QVOTER',
  20
);
assert(
  runtime.totalSelections === 3 && runtime.totalVoters === 2,
  'raw selections and unique voters remain distinct'
);
assert(
  runtime.options[0]?.rawVoteCount === 2 &&
    runtime.totalEffectiveWeight === 15 &&
    runtime.totalRawWeight === 20,
  'Core raw counts and weighted fields are preserved without conflation'
);
assert(
  runtime.currentUserOptionIndexes.join(',') === '2',
  'current-user selection comes from Core vote details'
);
assert(
  JSON.stringify(runtime) ===
    JSON.stringify(
      reduceNativePollState(
        multipleReference,
        corePoll,
        {
          ...votes,
          voteDetails: [...(votes.voteDetails ?? [])].reverse(),
          voteCounts: { Beta: 1, Alpha: 2 },
        },
        'QVOTER',
        20
      )
    ),
  'Core result normalization is deterministic across response-map/detail order'
);
const persistedAfterRuntime = toPersistedNativePollReference({
  ...reference,
  runtime,
});
assert(
  !('runtime' in persistedAfterRuntime) &&
    !('voteCounts' in persistedAfterRuntime),
  'runtime results are stripped before compatibility/index publication'
);
const unavailable = unavailableNativePollState(
  reference,
  'mocked Core failure'
);
const loadedUnavailable = await loadNativePostPoll(reference, 'QVOTER', {
  getPollById: async () => {
    throw new Error('mocked capability/read failure');
  },
  getPollVotes: async () => emptyVotes,
});
assert(
  loadedUnavailable.runtime?.diagnostics[0]?.code === 'NATIVE_POLL_UNAVAILABLE',
  'service read failure remains readable with stable unavailable diagnostics'
);
assert(
  unavailable.availability === 'unavailable' &&
    unavailable.diagnostics[0]?.code === 'NATIVE_POLL_UNAVAILABLE',
  'Core read failure is explicit and does not invent results'
);
const mismatch = reduceNativePollState(
  reference,
  { ...corePoll, owner: 'MALLORY' },
  emptyVotes
);
assert(
  mismatch.availability === 'inconsistent' &&
    mismatch.diagnostics[0]?.code === 'POLL_IDENTITY_MISMATCH',
  'Core/reference identity conflict is stable and fail closed'
);

let updateCalls = 0;
const closeSignature = await closeNativePoll(reference, 'QOWNER', {
  getPollById: async () => corePoll,
  getPollVotes: async () => emptyVotes,
  updatePoll: async () => {
    updateCalls += 1;
    return 'close-signature';
  },
});
assert(
  closeSignature === 'close-signature' && updateCalls === 1,
  'owner can schedule native closure before votes exist'
);
let closureBlocked = false;
try {
  await closeNativePoll(reference, 'QOWNER', {
    getPollById: async () => corePoll,
    getPollVotes: async () => ({ ...emptyVotes, totalVoters: 1 }),
    updatePoll: async () => 'must-not-run',
  });
} catch (error) {
  closureBlocked =
    error instanceof Error && error.message.includes('UNSUPPORTED_CAPABILITY');
}
assert(
  closureBlocked,
  'unsupported post-vote early closure is capability-gated instead of invented'
);

const identity = {
  validatePublisher: (metadata: { publisherName: string }, claimed: string) =>
    metadata.publisherName === claimed
      ? { ok: true as const }
      : {
          ok: false as const,
          code: 'IDENTITY_UNVERIFIED' as const,
          detail: 'publisher mismatch',
        },
  validateWalletBinding: (_name: string, wallet: string) =>
    wallet === 'QOWNER'
      ? { ok: true as const }
      : {
          ok: false as const,
          code: 'IDENTITY_UNVERIFIED' as const,
          detail: 'wallet mismatch',
        },
};
const envelope = buildV2PostEnvelope({
  entityType: 'post',
  entityId: 'post-1',
  parentThreadId: 'thread-1',
  parentPostId: null,
  publisherName: 'alice',
  walletAddress: 'QOWNER',
  content: 'Post authority is independent.',
  pollReference: reference,
});
const metadata = {
  service: 'DOCUMENT',
  publisherName: 'alice',
  identifier: envelope.recordId,
  created: 100,
  updated: 100,
  latestSignature: 'post-create-signature',
};
const first = reduceV2RuntimeRecords(
  [toV2RuntimeRecord(metadata, envelope)],
  identity
);
const serializedEnvelope: unknown = JSON.parse(JSON.stringify(envelope));
assert(
  isNativePollReference(envelope.body.pollReference) &&
    Object.keys(first.authoritative.entities).length === 1,
  'V2 Post accepts a strict native poll reference'
);
assert(
  isV2EntityEnvelope(serializedEnvelope) &&
    JSON.stringify(first) ===
      JSON.stringify(
        reduceV2RuntimeRecords(
          [toV2RuntimeRecord(metadata, serializedEnvelope)],
          identity
        )
      ),
  'native reference reduction is deterministic across reload'
);
assert(
  sameNativePollReference(envelope.body.pollReference, {
    displayCache: {
      closesAt: reference.displayCache.closesAt,
      startsAt: reference.displayCache.startsAt,
      options: reference.displayCache.options.map(({ label, index }) => ({
        label,
        index,
      })),
      selectionMode: reference.displayCache.selectionMode,
      description: reference.displayCache.description,
      question: reference.displayCache.question,
    },
    status: reference.status,
    provenance: reference.provenance,
    creationSignature: reference.creationSignature,
    creatorAddress: reference.creatorAddress,
    creatorName: reference.creatorName,
    pollName: reference.pollName,
    pollId: reference.pollId,
    schemaVersion: reference.schemaVersion,
    schema: reference.schema,
    kind: reference.kind,
  }),
  'reference equality is structural rather than object-key-order based'
);
const beforeVote = JSON.stringify(envelope.body);
await submitNativePollVote(reference, [1], gateway);
assert(
  JSON.stringify(envelope.body) === beforeVote,
  'voting never mutates or republishes authoritative Post content'
);
assert(
  first.authoritative.entities['post-1']?.publisherName === 'alice',
  'an unrelated native voter cannot acquire or replace Post authority'
);

const legacyPoll = {
  id: 'legacy',
  question: 'Historical',
  description: '',
  mode: 'single' as const,
  options: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ],
  votes: [{ voterId: 'legacy-user', optionIds: ['a'], votedAt: '2020-01-01' }],
  closesAt: null,
  closedAt: null,
  closedByUserId: null,
};
assert(
  !isNativePostPoll(legacyPoll) && legacyPoll.votes.length === 1,
  'legacy embedded polls remain readable but distinct from native authority'
);
assert(
  runtime.totalSelections === 3 &&
    runtime.options.reduce((sum, option) => sum + option.rawVoteCount, 0) === 3,
  'legacy embedded votes are not added to or allowed to override native results'
);
const indexOnlyPost = {
  postId: 'index-only',
  poll: reference,
};
assert(
  indexOnlyPost.poll.pollId === 42 &&
    Object.keys(reduceV2RuntimeRecords([], identity).authoritative.entities)
      .length === 0,
  'a derived index poll reference cannot establish V2 Post or poll authority'
);
assert(
  first.authoritative.entities['post-1']?.entityType === 'post' &&
    first.authoritative.entities['post-1'].pollReference?.pollId === 42 &&
    legacyPoll.id === 'legacy',
  'a V1 legacy snapshot cannot override the accepted V2 native reference'
);

console.log('Architecture V2 native poll tests passed');
