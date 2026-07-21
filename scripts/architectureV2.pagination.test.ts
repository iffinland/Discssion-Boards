import {
  combineQdnDiscoveryResults,
  DEFAULT_QDN_PAGINATION_BUDGET,
  paginateQdnResources,
} from '../src/services/qdn/qdnPagination.js';
import {
  buildV2IndexFragmentEnvelope,
  buildV2IndexFragmentIdentifier,
  buildV2IndexFragmentPrefix,
  isV2IndexFragmentEnvelope,
  reduceV2IndexFragments,
  resolveLastKnownGood,
  searchValidatedV2Index,
  type V2IndexFragmentRecord,
} from '../src/services/architectureV2/indexes.js';
import type { V2State } from '../src/services/architectureV2/reducer.js';
import type {
  QdbV2ResourceMetadata,
  V2EntityCreate,
} from '../src/services/architectureV2/types.js';

let passed = 0;
const assert = (condition: unknown, label: string) => {
  if (!condition) throw new Error(`FAIL: ${label}`);
  passed += 1;
  console.log(`PASS: ${label}`);
};

type FixtureResource = {
  key: string;
  publisher: string;
  created: number;
};

const compareFixture = (left: FixtureResource, right: FixtureResource) =>
  left.created - right.created || left.key.localeCompare(right.key);

const fixturePage =
  (
    items: FixtureResource[],
    options?: { failAtOffset?: number; reversePage?: boolean }
  ) =>
  async ({ limit, offset }: { limit: number; offset: number }) => {
    if (offset === options?.failAtOffset) throw new Error('fixture failure');
    const page = items.slice(offset, offset + limit);
    return options?.reversePage ? page.reverse() : page;
  };

const runDiscovery = (
  items: FixtureResource[],
  budget?: Parameters<
    typeof paginateQdnResources<FixtureResource>
  >[0]['budget'],
  options?: { failAtOffset?: number; reversePage?: boolean }
) =>
  paginateQdnResources({
    requestPage: fixturePage(items, options),
    keyOf: (item) => item.key,
    compareItems: compareFixture,
    budget,
    wait: async () => undefined,
  });

const empty = await runDiscovery([]);
assert(empty.completeness === 'complete', 'zero results are complete');
assert(empty.items.length === 0, 'complete empty differs from failure');

const smallItems = Array.from({ length: 37 }, (_, index) => ({
  key: `small-${index.toString().padStart(3, '0')}`,
  publisher: 'owner',
  created: index,
}));
const small = await runDiscovery(smallItems);
assert(small.pagesFetched === 1, 'less than one page uses one request');
assert(small.resourcesSeen === 37, 'resource count preserves raw discovery');

const boundaryItems = Array.from({ length: 100 }, (_, index) => ({
  key: `boundary-${index.toString().padStart(3, '0')}`,
  publisher: 'owner',
  created: index,
}));
const boundary = await runDiscovery(boundaryItems);
assert(boundary.pagesFetched === 2, 'exact boundary fetches terminating page');
assert(boundary.completeness === 'complete', 'exact boundary is complete');

const largeItems = Array.from({ length: 1_205 }, (_, index) => ({
  key: `large-${index.toString().padStart(4, '0')}`,
  publisher: index < 1_100 ? 'flooder' : 'legitimate',
  created: index,
}));
const large = await runDiscovery(largeItems);
assert(large.items.length === 1_205, 'more than 1000 resources are retained');
assert(large.pagesFetched === 13, 'large discovery traverses multiple pages');
assert(
  large.items.some((item) => item.publisher === 'legitimate'),
  'early publisher flood does not hide later resources within budget'
);
assert(
  large.items[0]?.key === 'large-0000' &&
    large.items.at(-1)?.key === 'large-1204',
  'final discovery order is deterministic'
);

const duplicatePages = [
  { key: 'a', publisher: 'one', created: 1 },
  { key: 'b', publisher: 'one', created: 2 },
  { key: 'b', publisher: 'one', created: 2 },
  { key: 'c', publisher: 'one', created: 3 },
];
const duplicates = await runDiscovery(duplicatePages, { pageSize: 2 });
assert(duplicates.items.length === 3, 'duplicates across pages are removed');
assert(
  duplicates.diagnostics.some((item) => item.code === 'DUPLICATE_RESOURCE'),
  'duplicate resource emits stable diagnostic'
);

const reversed = await runDiscovery(largeItems, undefined, {
  reversePage: true,
});
assert(
  reversed.items.map((item) => item.key).join(',') ===
    large.items.map((item) => item.key).join(','),
  'page item order permutations produce identical results'
);

const firstFailure = await runDiscovery(smallItems, undefined, {
  failAtOffset: 0,
});
assert(
  firstFailure.completeness === 'unavailable',
  'first page failure is unavailable'
);
assert(
  firstFailure.diagnostics.some(
    (item) => item.code === 'PAGINATION_REQUEST_FAILED'
  ),
  'request failure emits stable diagnostic'
);

let transientAttempts = 0;
const retried = await paginateQdnResources<FixtureResource>({
  requestPage: async ({ limit, offset }) => {
    transientAttempts += 1;
    if (transientAttempts <= 2) throw new Error('transient failure');
    return smallItems.slice(offset, offset + limit);
  },
  keyOf: (item) => item.key,
  compareItems: compareFixture,
  wait: async () => undefined,
});
assert(
  retried.completeness === 'complete' && retried.items.length === 37,
  'bounded retries recover a transient page failure'
);
assert(transientAttempts === 3, 'retry count is bounded and observable');

const combinedUnavailablePartition = combineQdnDiscoveryResults(
  [small, firstFailure],
  {
    keyOf: (item) => item.key,
    compareItems: compareFixture,
  }
);
assert(
  combinedUnavailablePartition.completeness === 'partial',
  'an unavailable partition makes otherwise valid combined discovery partial'
);
assert(
  combinedUnavailablePartition.items.length === small.items.length,
  'combined discovery preserves valid partitions when another is unavailable'
);
assert(
  combinedUnavailablePartition.diagnostics.some(
    (item) => item.code === 'PARTIAL_DISCOVERY'
  ),
  'combined incomplete partitions emit an explicit partial diagnostic'
);

const laterFailure = await runDiscovery(largeItems, undefined, {
  failAtOffset: 100,
});
assert(
  laterFailure.completeness === 'partial',
  'later page failure is partial'
);
assert(
  laterFailure.items.length === 100,
  'valid early page survives later failure'
);

const pageBudget = await runDiscovery(largeItems, { maxPages: 3 });
assert(
  pageBudget.stoppedReason === 'page-budget',
  'page safety budget stops discovery'
);
assert(
  pageBudget.diagnostics.some(
    (item) => item.code === 'PAGINATION_BUDGET_REACHED'
  ),
  'page budget emits budget diagnostic'
);

const resourceBudget = await runDiscovery(largeItems, { maxResources: 250 });
assert(
  resourceBudget.stoppedReason === 'resource-budget',
  'resource safety budget stops discovery'
);
assert(
  resourceBudget.items.length === 250,
  'resource budget preserves bounded valid prefix'
);
assert(
  resourceBudget.diagnostics.some(
    (item) => item.code === 'NAMESPACE_BUDGET_PRESSURE'
  ),
  'namespace pressure is explicit'
);

const loop = await paginateQdnResources<FixtureResource>({
  requestPage: async () => boundaryItems,
  keyOf: (item) => item.key,
  compareItems: compareFixture,
  wait: async () => undefined,
});
assert(
  loop.stoppedReason === 'repeated-page',
  'repeated page loop is detected'
);
assert(
  loop.diagnostics.some((item) => item.code === 'PAGINATION_LOOP_DETECTED'),
  'loop emits stable diagnostic'
);
assert(
  DEFAULT_QDN_PAGINATION_BUDGET.maxResources > 1_000,
  'default resource budget does not recreate old 1000 cap'
);
assert(
  DEFAULT_QDN_PAGINATION_BUDGET.maxPages === 100 &&
    DEFAULT_QDN_PAGINATION_BUDGET.retryCount === 2,
  'explicit page and retry budgets are exported'
);

const topic: V2EntityCreate = {
  entityType: 'topic',
  entityId: 'topic_phase6',
  publisherName: 'Alice',
  walletAddress: 'QALICE',
  title: 'Scalable architecture',
  description: 'Authoritative topic content',
};
const thread: V2EntityCreate = {
  entityType: 'thread',
  entityId: 'subtopic_phase6',
  parentTopicId: topic.entityId,
  publisherName: 'Bob',
  walletAddress: 'QBOB',
  title: 'Pagination details',
  description: 'Authoritative thread content',
};
const post: V2EntityCreate = {
  entityType: 'post',
  entityId: 'post_phase6',
  parentThreadId: thread.entityId,
  parentPostId: null,
  publisherName: 'Carol',
  walletAddress: 'QCAROL',
  content: 'A searchable authoritative post',
};
const authority: V2State = {
  entities: {
    [topic.entityId]: topic,
    [thread.entityId]: thread,
    [post.entityId]: post,
  },
  quarantined: [],
};

const metadataFor = (
  identifier: string,
  publisherName: string,
  created: number,
  signature: string
): QdbV2ResourceMetadata => ({
  service: 'DOCUMENT',
  publisherName,
  identifier,
  created,
  updated: null,
  latestSignature: signature,
});

const recordFor = (
  entity: V2EntityCreate,
  created: number,
  signature: string
): V2IndexFragmentRecord => {
  const envelope = buildV2IndexFragmentEnvelope('qdbm', entity);
  return {
    envelope,
    metadata: metadataFor(
      envelope.recordId,
      entity.publisherName,
      created,
      signature
    ),
  };
};

const topicRecord = recordFor(topic, 1, 'sig-a');
const threadRecord = recordFor(thread, 2, 'sig-b');
const postRecord = recordFor(post, 3, 'sig-c');
const reduced = reduceV2IndexFragments(
  'qdbm',
  [postRecord, topicRecord, threadRecord],
  authority
);
assert(
  reduced.entries.length === 3,
  'valid fragments locate authoritative entities'
);
assert(
  reduced.entries.every((entry) => entry.freshness === 'current'),
  'matching hints are current'
);
assert(
  !('content' in topicRecord.envelope.body),
  'index fragment omits complete authoritative entity snapshots'
);
assert(
  Object.keys(postRecord.envelope.body).every((key) =>
    ['entityType', 'entityId', 'parentId', 'authority', 'hint'].includes(key)
  ),
  'fragment schema contains derived locator fields only'
);

const staleEnvelope = buildV2IndexFragmentEnvelope('qdbm', topic);
staleEnvelope.body.hint.title = 'Old title';
const stale = reduceV2IndexFragments(
  'qdbm',
  [
    {
      envelope: staleEnvelope,
      metadata: metadataFor(
        staleEnvelope.recordId,
        topic.publisherName,
        4,
        'sig-d'
      ),
    },
  ],
  authority
);
assert(
  stale.entries[0]?.entity.entityType === 'topic' &&
    stale.entries[0].entity.title === topic.title,
  'stale hint cannot replace authority'
);
assert(
  stale.diagnostics.some((item) => item.code === 'STALE_INDEX_ENTRY'),
  'stale hint is diagnosed'
);

const malformed = structuredClone(topicRecord.envelope) as unknown as Record<
  string,
  unknown
>;
malformed.untrusted = true;
assert(!isV2IndexFragmentEnvelope(malformed), 'malformed fragment is rejected');

const authorityMismatch = structuredClone(topicRecord);
authorityMismatch.envelope.body.authority.publisherName = 'Mallory';
const mismatch = reduceV2IndexFragments('qdbm', [authorityMismatch], authority);
assert(
  mismatch.entries.length === 0,
  'unauthorized publisher hint is excluded'
);
assert(
  mismatch.diagnostics.some((item) => item.code === 'INDEX_AUTHORITY_MISMATCH'),
  'authority mismatch is diagnosed'
);

const wrongResourcePublisher = structuredClone(topicRecord);
wrongResourcePublisher.metadata.publisherName = 'Mallory';
wrongResourcePublisher.metadata.created = 99;
wrongResourcePublisher.metadata.updated = 99;
wrongResourcePublisher.metadata.latestSignature = 'sig-z';
const publisherMismatch = reduceV2IndexFragments(
  'qdbm',
  [topicRecord, wrongResourcePublisher],
  authority
);
assert(
  publisherMismatch.entries.length === 1 &&
    publisherMismatch.entries[0]?.metadata.publisherName ===
      topic.publisherName,
  'invalid newer fragment publisher cannot suppress the valid owner fragment'
);
assert(
  publisherMismatch.diagnostics.some(
    (item) => item.code === 'INDEX_AUTHORITY_MISMATCH'
  ),
  'resource publisher mismatch is diagnosed'
);

const invalidIdentifier = structuredClone(topicRecord);
invalidIdentifier.metadata.identifier = `${topicRecord.metadata.identifier}-bad`;
const invalidId = reduceV2IndexFragments(
  'qdbm',
  [invalidIdentifier],
  authority
);
assert(
  invalidId.entries.length === 0,
  'invalid fragment identifier is excluded'
);

const tombstoned = reduceV2IndexFragments('qdbm', [postRecord], authority, {
  [post.entityId]: 'tombstoned',
});
assert(tombstoned.entries.length === 0, 'tombstoned index target is excluded');

const wrongParent = structuredClone(threadRecord);
wrongParent.envelope.body.parentId = 'topic_wrong';
wrongParent.envelope.recordId = buildV2IndexFragmentIdentifier(
  'qdbm',
  'thread',
  thread.entityId,
  'topic_wrong'
);
wrongParent.metadata.identifier = wrongParent.envelope.recordId;
const parentMismatch = reduceV2IndexFragments('qdbm', [wrongParent], authority);
assert(
  parentMismatch.entries.length === 0,
  'wrong parent relation is excluded'
);
assert(
  parentMismatch.diagnostics.some(
    (item) => item.code === 'INVALID_PARENT_RELATION'
  ),
  'wrong parent relation is diagnosed'
);

const unavailable = reduceV2IndexFragments('qdbm', [postRecord], authority, {
  [post.entityId]: 'unavailable',
});
assert(
  unavailable.entries.length === 0,
  'unavailable target remains locator-only'
);
assert(
  unavailable.diagnostics.some(
    (item) => item.code === 'INDEX_TARGET_UNAVAILABLE'
  ),
  'unavailable target is explicit'
);

const unknownEntity = { ...topic, entityId: 'topic_unknown' };
const unknownRecord = recordFor(unknownEntity, 5, 'sig-e');
const unknown = reduceV2IndexFragments('qdbm', [unknownRecord], authority);
assert(
  unknown.entries.length === 0,
  'index-only target cannot establish authority'
);

const olderTopic = structuredClone(topicRecord);
olderTopic.envelope.body.hint.title = 'Older';
olderTopic.metadata.created = 0;
olderTopic.metadata.latestSignature = 'sig-0';
const duplicatesReduced = reduceV2IndexFragments(
  'qdbm',
  [topicRecord, olderTopic],
  authority
);
assert(
  duplicatesReduced.entries.length === 1,
  'duplicate fragments produce one entity'
);
assert(
  duplicatesReduced.entries[0]?.freshness === 'current',
  'newer trusted fragment supersedes older conflict'
);

const permutationA = reduceV2IndexFragments(
  'qdbm',
  [topicRecord, olderTopic, postRecord],
  authority
);
const permutationB = reduceV2IndexFragments(
  'qdbm',
  [postRecord, olderTopic, topicRecord],
  authority
);
assert(
  JSON.stringify(permutationA) === JSON.stringify(permutationB),
  'fragment reduction is deterministic across input order'
);
assert(
  buildV2IndexFragmentPrefix('qdbm', 'topic') !==
    buildV2IndexFragmentPrefix('qdbm', 'post'),
  'entity partitions prevent unrelated domains competing'
);
assert(
  buildV2IndexFragmentIdentifier(
    'qdbm',
    'thread',
    `subtopic_${'a'.repeat(39)}`,
    `topic_${'b'.repeat(42)}`
  ).length <= 64,
  'maximum accepted entity IDs still produce QDN-safe fragment identifiers'
);
assert(
  topicRecord.envelope.recordId !== 'qdbm-index-topics',
  'V2 fragments coexist with legacy topic index identifiers'
);
assert(
  postRecord.envelope.recordId !== `qdbm-index-thread-${thread.entityId}`,
  'V2 fragments coexist with legacy thread index identifiers'
);

const search = searchValidatedV2Index(reduced.entries, 'searchable');
assert(
  search.length === 1 && search[0]?.entity.entityId === post.entityId,
  'search uses authoritative entity content'
);
const staleSearch = searchValidatedV2Index(stale.entries, 'old title');
assert(
  staleSearch.length === 0,
  'stale index hint cannot create a search result'
);
assert(
  searchValidatedV2Index(reduced.entries, '')
    .map((entry) => entry.entity.entityId)
    .join(',') ===
    [...reduced.entries]
      .sort((left, right) =>
        left.entity.entityId.localeCompare(right.entity.entityId)
      )
      .map((entry) => entry.entity.entityId)
      .join(','),
  'search result ordering is deterministic'
);

const current = resolveLastKnownGood({
  current: topic,
  cached: { ...topic, title: 'cached' },
});
assert(
  current.availability === 'verified-current' &&
    current.value.entityType === 'topic' &&
    current.value.title === topic.title,
  'current authority supersedes cache'
);
const cached = resolveLastKnownGood({
  cached: topic,
  authorityUnavailable: true,
});
assert(
  cached.availability === 'cached-last-known-good',
  'last-known-good is explicitly cached'
);
assert(
  cached.diagnostics.some((item) => item.code === 'CACHED_LAST_KNOWN_GOOD'),
  'cached use emits stable diagnostic'
);
const indexOnly = resolveLastKnownGood({
  hasIndexHint: true,
  authorityUnavailable: true,
});
assert(
  indexOnly.availability === 'index-only' && indexOnly.value === null,
  'index-only metadata is not authority'
);
const noData = resolveLastKnownGood({ authorityUnavailable: true });
assert(
  noData.availability === 'unavailable',
  'unavailable authority differs from empty complete'
);

const rebuilt = reduceV2IndexFragments(
  'qdbm',
  [
    recordFor(topic, 1, 'sig-a'),
    recordFor(thread, 2, 'sig-b'),
    recordFor(post, 3, 'sig-c'),
  ],
  authority
);
assert(
  JSON.stringify(rebuilt) === JSON.stringify(reduced),
  'reload rebuilds identical index state'
);
assert(
  postRecord.envelope.body.hint.excerpt === post.content,
  'new post needs one independent fragment rather than whole-thread rewrite'
);
assert(
  !JSON.stringify(postRecord.envelope).includes('likedByAddresses') &&
    !JSON.stringify(postRecord.envelope).includes('tipCount') &&
    !JSON.stringify(postRecord.envelope).includes('votes'),
  'reaction poll-result and tip domains remain outside index authority'
);

console.log(
  `Architecture V2 Phase 6 pagination/index tests passed (${passed}).`
);
