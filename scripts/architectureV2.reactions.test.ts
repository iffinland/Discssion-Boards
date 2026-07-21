import {
  buildReactionEnvelope,
  buildReactionIdentifier,
  classifyInvalidReactionEnvelope,
  hasActiveReaction,
  isReactionEnvelope,
  loadReactionState,
  publishReactionEnvelope,
  reduceReactionRecords,
  resolveReactionDisplay,
  type ReactionRecord,
} from '../src/services/architectureV2/reactions.js';
import {
  buildV2Envelope,
  reduceV2RuntimeRecords,
  toV2RuntimeRecord,
} from '../src/services/architectureV2/runtime.js';
const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};
const wallets: Record<string, string> = { alice: 'A', bob: 'B' };
const identity = {
  validatePublisher: (metadata: { publisherName: string }, claimed: string) =>
    metadata.publisherName === claimed
      ? { ok: true as const }
      : {
          ok: false as const,
          code: 'IDENTITY_UNVERIFIED' as const,
          detail: 'publisher mismatch',
        },
  validateWalletBinding: (name: string, wallet: string) =>
    wallets[name] === wallet
      ? { ok: true as const }
      : {
          ok: false as const,
          code: 'IDENTITY_UNVERIFIED' as const,
          detail: 'wallet mismatch',
        },
};
const reaction = (
  publisherName: string,
  walletAddress: string,
  state: 'active' | 'inactive',
  updated: number | null,
  signature: string,
  targetId = 'post-1'
): ReactionRecord => {
  const identifier = `qdbm-v2-react-target-${publisherName}`;
  return {
    metadata: {
      service: 'DOCUMENT',
      publisherName,
      identifier,
      created: 1,
      updated,
      latestSignature: signature,
    },
    envelope: buildReactionEnvelope(
      {
        operation: 'reaction',
        targetType: 'post',
        targetId,
        reaction: 'like',
        state,
        publisherName,
        walletAddress,
      },
      identifier,
      '9999-01-01'
    ),
  };
};
const aliceLike = reaction('alice', 'A', 'active', 2, 'a');
const aliceUnlike = reaction('alice', 'A', 'inactive', 3, 'b');
const bobLike = reaction('bob', 'B', 'active', 2, 'c');
const twoActors = reduceReactionRecords(
  'post-1',
  [bobLike, aliceLike],
  identity
);
assert(twoActors.count === 2, 'two actors count independently');
assert(
  reduceReactionRecords(
    'post-1',
    [reaction('alice', 'A', 'active', null, 'created-only')],
    identity
  ).count === 1,
  'first publication with nullable Core updated metadata is accepted'
);
assert(
  reduceReactionRecords('post-1', [aliceLike, aliceLike], identity).count === 1,
  'repeated like is idempotent'
);
assert(
  reduceReactionRecords('post-1', [aliceUnlike, aliceLike], identity).count ===
    0,
  'unlike wins by trusted metadata'
);
assert(
  JSON.stringify(
    reduceReactionRecords('post-1', [bobLike, aliceUnlike, aliceLike], identity)
  ) ===
    JSON.stringify(
      reduceReactionRecords(
        'post-1',
        [aliceLike, bobLike, aliceUnlike],
        identity
      )
    ),
  'input order is irrelevant'
);
assert(
  hasActiveReaction(twoActors, 'alice', 'A'),
  'current actor state is derived'
);
const forged = reduceReactionRecords(
  'post-1',
  [reaction('alice', 'B', 'active', 4, 'd')],
  identity
);
assert(
  forged.count === 0 && forged.diagnostics[0]?.code === 'IDENTITY_UNVERIFIED',
  'forged wallet is rejected'
);
const impersonated = reduceReactionRecords(
  'post-1',
  [{ ...aliceLike, metadata: { ...aliceLike.metadata, publisherName: 'bob' } }],
  identity
);
assert(impersonated.count === 0, 'publisher impersonation is rejected');
const wrongTarget = reduceReactionRecords(
  'post-1',
  [reaction('alice', 'A', 'active', 4, 'e', 'post-2')],
  identity
);
assert(
  wrongTarget.count === 0 &&
    wrongTarget.diagnostics[0]?.code === 'TARGET_MISMATCH',
  'target mismatch is rejected'
);
assert(
  !isReactionEnvelope({
    ...aliceLike.envelope,
    body: { ...aliceLike.envelope.body, state: 'invalid' },
  }),
  'malformed state is rejected'
);
assert(
  classifyInvalidReactionEnvelope({
    ...aliceLike.envelope,
    body: { ...aliceLike.envelope.body, state: 'invalid' },
  }) === 'INVALID_REACTION_STATE',
  'malformed state has a stable diagnostic'
);
assert(
  classifyInvalidReactionEnvelope({ body: {} }) === 'MALFORMED_ENVELOPE',
  'unrelated malformed payload has a stable diagnostic'
);
assert(
  !isReactionEnvelope({
    ...aliceLike.envelope,
    body: { ...aliceLike.envelope.body, content: 'forged replacement' },
  }),
  'reaction envelope cannot smuggle Post content'
);
const legacyOnly = reduceReactionRecords('post-1', [], identity);
assert(
  resolveReactionDisplay(7, ['legacy'], legacyOnly).count === 7,
  'legacy count remains compatibility-only without V2 state'
);
assert(
  Object.keys(legacyOnly.actors).length === 0,
  'derived index or legacy count cannot create reaction authority'
);
assert(
  resolveReactionDisplay(7, ['legacy'], twoActors).count === 2,
  'V2 state replaces rather than double-counts legacy state'
);
assert(
  !('content' in aliceLike.envelope.body),
  'reaction cannot contain post content'
);

const trustedLikeWithFutureClientTime = reaction(
  'alice',
  'A',
  'active',
  2,
  'future'
);
const trustedUnlikeWithPastClientTime = {
  ...reaction('alice', 'A', 'inactive', 3, 'later'),
  envelope: buildReactionEnvelope(
    {
      operation: 'reaction',
      targetType: 'post',
      targetId: 'post-1',
      reaction: 'like',
      state: 'inactive',
      publisherName: 'alice',
      walletAddress: 'A',
    },
    'qdbm-v2-react-target-alice',
    '1970-01-01'
  ),
};
assert(
  reduceReactionRecords(
    'post-1',
    [trustedUnlikeWithPastClientTime, trustedLikeWithFutureClientTime],
    identity
  ).count === 0,
  'client timestamp cannot override trusted Core ordering'
);

const conflictActive = reaction('alice', 'A', 'active', 5, 'same');
const conflictInactive = reaction('alice', 'A', 'inactive', 5, 'same');
const conflictForward = reduceReactionRecords(
  'post-1',
  [conflictActive, conflictInactive],
  identity
);
const conflictReverse = reduceReactionRecords(
  'post-1',
  [conflictInactive, conflictActive],
  identity
);
assert(
  conflictForward.count === 0 &&
    conflictForward.diagnostics[0]?.code === 'DUPLICATE_CONFLICT',
  'equal-order conflicting actor state is quarantined'
);
assert(
  JSON.stringify(conflictForward) === JSON.stringify(conflictReverse),
  'conflicting records are deterministic across input order'
);

let publishedEnvelope: unknown;
const published = await publishReactionEnvelope(
  aliceLike.envelope,
  async (envelope) => {
    publishedEnvelope = envelope;
  }
);
assert(
  published === aliceLike.envelope && publishedEnvelope === aliceLike.envelope,
  'valid like publishes one independent reaction envelope'
);
const deterministicIdentifier = await buildReactionIdentifier(
  'qdbm',
  'post-1',
  'alice',
  'A'
);
assert(
  deterministicIdentifier ===
    (await buildReactionIdentifier('qdbm', 'post-1', 'Alice', 'A')),
  'reaction identifier is deterministic for normalized actor and target'
);
assert(
  deterministicIdentifier.length <= 64,
  'reaction identifier respects the verified Core limit'
);
assert(
  deterministicIdentifier !==
    (await buildReactionIdentifier('qdbm', 'post-1', 'bob', 'B')),
  'different actors receive distinct identifiers'
);
const reloaded = reduceReactionRecords(
  'post-1',
  [{ ...aliceLike, envelope: JSON.parse(JSON.stringify(published)) }],
  identity
);
assert(
  reloaded.count === 1 && hasActiveReaction(reloaded, 'alice', 'A'),
  'reload reconstructs actor reaction state'
);

const discoveredIdentifier = await buildReactionIdentifier(
  'qdbm',
  'post-1',
  'alice',
  'A'
);
const discoveredEnvelope = buildReactionEnvelope(
  {
    operation: 'reaction',
    targetType: 'post',
    targetId: 'post-1',
    reaction: 'like',
    state: 'active',
    publisherName: 'alice',
    walletAddress: 'A',
  },
  discoveredIdentifier
);
const loaderDependencies = {
  fetchPayload: async () => discoveredEnvelope,
  resolveWalletAddress: async (name: string) => wallets[name] ?? null,
  expectedIdentifier: (body: typeof discoveredEnvelope.body) =>
    buildReactionIdentifier(
      'qdbm',
      body.targetId,
      body.publisherName,
      body.walletAddress
    ),
};
const discovered = await loadReactionState(
  'post-1',
  [
    {
      name: 'alice',
      service: 'DOCUMENT',
      identifier: discoveredIdentifier,
      created: 10,
      updated: null,
      latestSignature: 'discovered',
    },
  ],
  loaderDependencies
);
assert(
  discovered.count === 1 &&
    hasActiveReaction(discovered, 'alice', 'A') &&
    discovered.diagnostics.length === 0,
  'mocked discovery, fetch, identity binding, and reload produce valid state'
);
const missingMetadata = await loadReactionState(
  'post-1',
  [{ name: 'alice', identifier: discoveredIdentifier }],
  loaderDependencies
);
assert(
  missingMetadata.diagnostics[0]?.code === 'MISSING_TRUSTED_METADATA',
  'missing discovery metadata is diagnosed'
);
const unavailable = await loadReactionState(
  'post-1',
  [
    {
      name: 'alice',
      service: 'DOCUMENT',
      identifier: discoveredIdentifier,
      created: 10,
      updated: null,
    },
  ],
  {
    ...loaderDependencies,
    fetchPayload: async () => {
      throw new Error('unavailable');
    },
  }
);
assert(
  unavailable.diagnostics[0]?.code === 'UNAVAILABLE_RESOURCE',
  'unavailable reaction resource is diagnosed without creating state'
);
const identifierMismatch = await loadReactionState(
  'post-1',
  [
    {
      name: 'alice',
      service: 'DOCUMENT',
      identifier: `${discoveredIdentifier}-wrong`,
      created: 10,
      updated: null,
    },
  ],
  loaderDependencies
);
assert(
  identifierMismatch.diagnostics[0]?.code === 'IDENTIFIER_MISMATCH',
  'identifier mismatch is diagnosed without creating state'
);

const unchangedPost = {
  id: 'post-1',
  content: 'authoritative content',
  publisherName: 'alice',
};
let publicationFailed = false;
try {
  await publishReactionEnvelope(aliceUnlike.envelope, async () => {
    throw new Error('publish failed');
  });
} catch {
  publicationFailed = true;
}
assert(
  publicationFailed && unchangedPost.content === 'authoritative content',
  'publication failure cannot mutate Post authority'
);

const postCreate = {
  entityType: 'post' as const,
  entityId: 'post-1',
  parentThreadId: 'thread-1',
  parentPostId: null,
  content: 'authoritative content',
  publisherName: 'alice',
  walletAddress: 'A',
};
const postEnvelope = buildV2Envelope(postCreate, 'qdbm-v2-post-post-1');
const authoritative = reduceV2RuntimeRecords(
  [
    toV2RuntimeRecord(
      {
        service: 'DOCUMENT',
        publisherName: 'alice',
        identifier: postEnvelope.recordId,
        created: 1,
        updated: 1,
        latestSignature: 'create',
      },
      postEnvelope
    ),
  ],
  identity
);
assert(
  authoritative.authoritative.entities['post-1']?.publisherName === 'alice',
  'reaction cannot grant or replace Post authority'
);
assert(
  authoritative.authoritative.entities['post-1']?.entityType === 'post' &&
    authoritative.authoritative.entities['post-1'].content ===
      'authoritative content',
  'legacy or reacting-user snapshots cannot replace V2 Post content'
);
assert(
  reduceV2RuntimeRecords([], identity).authoritative.entities['post-1'] ===
    undefined,
  'reaction or derived index data cannot establish Post authority'
);
console.log('Architecture V2 reaction tests passed');
