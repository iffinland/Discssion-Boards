import { renderToStaticMarkup } from 'react-dom/server';

import AccessDisclosureNotice from '../src/components/forum/AccessDisclosureNotice.js';
import {
  buildV2IndexFragmentEnvelope,
  searchValidatedV2Index,
  type ValidatedV2IndexEntry,
} from '../src/services/architectureV2/indexes.js';
import { normalizeLegacyEntity } from '../src/services/architectureV2/legacy.js';
import {
  canAccessSubTopic,
  hasStaffReviewAccess,
  resolveCompatibilityAccessClassification,
  resolveAccessLabel,
  RESTRICTED_UI_ACCESS_WARNING,
} from '../src/services/forum/forumAccess.js';
import {
  buildForumStructureSearchIndex,
  searchForumStructure,
} from '../src/services/forum/forumSearch.js';
import { forumQdnService } from '../src/services/qdn/forumQdnService.js';
import type {
  QdbV2ResourceMetadata,
  V2EntityCreate,
} from '../src/services/architectureV2/types.js';
import type { SubTopic, User, UserRole } from '../src/types/index.js';

let passed = 0;
const assert = (condition: unknown, label: string) => {
  if (!condition) throw new Error(`FAIL: ${label}`);
  passed += 1;
  console.log(`PASS: ${label}`);
};

const user = (role: UserRole, address: string | null = null): User => ({
  id: `${role}-${address ?? 'none'}`,
  username: role,
  displayName: role,
  address,
  role,
  avatarColor: 'bg-slate-400',
  joinedAt: new Date(0).toISOString(),
});

const thread = (access: SubTopic['access']): SubTopic => ({
  id: 'subtopic_restricted',
  topicId: 'topic_public',
  title: 'Restricted example',
  description: 'Public QDN data with an app access rule',
  authorUserId: 'owner',
  createdAt: new Date(0).toISOString(),
  lastPostAt: new Date(0).toISOString(),
  lastPostAuthorUserId: 'owner',
  isPinned: false,
  pinnedAt: null,
  isSolved: false,
  solvedAt: null,
  solvedByUserId: null,
  isPoll: false,
  access,
  allowedAddresses: ['Q-allowed-wallet'],
  status: 'open',
  visibility: 'visible',
});

assert(
  canAccessSubTopic(thread('everyone'), user('Member'), null),
  'public discussion is available in the official UI'
);
assert(
  canAccessSubTopic(
    thread('custom'),
    user('Member', 'Q-allowed-wallet'),
    'Q-allowed-wallet'
  ),
  'listed wallet is allowed by the official UI'
);
assert(
  !canAccessSubTopic(
    thread('custom'),
    user('Member', 'Q-unlisted-wallet'),
    'Q-unlisted-wallet'
  ),
  'unlisted wallet is blocked by the official UI'
);
assert(
  !canAccessSubTopic(thread('moderators'), user('Member'), null),
  'member is blocked from role-restricted discussion'
);
assert(
  canAccessSubTopic(thread('moderators'), user('Moderator'), null),
  'moderator is allowed into role-restricted discussion'
);
assert(
  hasStaffReviewAccess('Moderator') &&
    canAccessSubTopic(thread('admins'), user('Moderator'), null),
  'trusted staff review override remains explicit and preserved'
);

const missingClassification = resolveCompatibilityAccessClassification();
assert(
  !missingClassification.classificationAvailable &&
    missingClassification.access === 'custom' &&
    missingClassification.allowedAddresses.length === 0,
  'missing legacy access classification fails closed instead of becoming public'
);
const legacyClassification = resolveCompatibilityAccessClassification({
  access: 'custom',
  allowedAddresses: ['Q-legacy-wallet'],
});
assert(
  legacyClassification.classificationAvailable &&
    legacyClassification.allowedAddresses[0] === 'Q-legacy-wallet',
  'available legacy access classification remains readable'
);

assert(
  resolveAccessLabel('custom') ===
    'Restricted in this app: listed wallets (staff review applies)',
  'wallet restriction label describes an app-level boundary'
);
assert(
  resolveAccessLabel('everyone') === 'Public',
  'public access terminology is explicit'
);
assert(
  (['everyone', 'moderators', 'admins', 'custom'] as const).every(
    (access) => !/encrypted|private/i.test(resolveAccessLabel(access))
  ),
  'current access options expose no encrypted/private category'
);

const restrictedWarning = renderToStaticMarkup(
  <AccessDisclosureNotice kind="restricted" access="custom" />
);
assert(
  restrictedWarning.includes(RESTRICTED_UI_ACCESS_WARNING),
  'restricted creation and management warning renders exact security meaning'
);
assert(
  restrictedWarning.includes('publicly and unencrypted on QDN') &&
    restrictedWarning.includes('not be treated as confidential'),
  'warning denies a confidentiality interpretation'
);
assert(
  renderToStaticMarkup(
    <AccessDisclosureNotice kind="restricted" access="everyone" />
  ) === '',
  'restricted warning is not shown for public access'
);
assert(
  renderToStaticMarkup(
    <AccessDisclosureNotice kind="topic-creation-policy" access="moderators" />
  ).includes('controls who may create sub-topics'),
  'topic creation policy is not mislabeled as content privacy'
);
assert(
  renderToStaticMarkup(<AccessDisclosureNotice kind="hidden" />).includes(
    'hidden from standard views in this app'
  ),
  'moderation-hidden warning distinguishes UI visibility from storage'
);
assert(
  renderToStaticMarkup(
    <AccessDisclosureNotice kind="public-storage" />
  ).includes('published publicly and unencrypted on QDN'),
  'discussion creation displays the public-storage notice'
);

const topicEntity: V2EntityCreate = {
  entityType: 'topic',
  entityId: 'topic_public',
  publisherName: 'owner',
  walletAddress: 'Q-owner',
  title: 'Public topic',
  description: 'Description',
};
const publicThreadEntity: V2EntityCreate = {
  entityType: 'thread',
  entityId: 'subtopic_public',
  parentTopicId: topicEntity.entityId,
  publisherName: 'owner',
  walletAddress: 'Q-owner',
  title: 'Public thread',
  description: 'Description',
};
const restrictedThreadEntity: V2EntityCreate = {
  ...publicThreadEntity,
  entityId: 'subtopic_restricted',
  title: 'Restricted title must not be copied',
};
const publicPostEntity: V2EntityCreate = {
  entityType: 'post',
  entityId: 'post_public',
  parentThreadId: publicThreadEntity.entityId,
  parentPostId: null,
  publisherName: 'owner',
  walletAddress: 'Q-owner',
  content: 'secret public match',
};
const restrictedPostEntity: V2EntityCreate = {
  ...publicPostEntity,
  entityId: 'post_restricted',
  parentThreadId: restrictedThreadEntity.entityId,
  content: 'secret restricted match',
};

const publicFragment = buildV2IndexFragmentEnvelope('qdbm', publicPostEntity);
const restrictedThreadFragment = buildV2IndexFragmentEnvelope(
  'qdbm',
  restrictedThreadEntity,
  'locator-only'
);
const restrictedPostFragment = buildV2IndexFragmentEnvelope(
  'qdbm',
  restrictedPostEntity,
  'locator-only'
);
assert(
  publicFragment.body.hint.excerpt === publicPostEntity.content,
  'public fragment retains a bounded search hint'
);
assert(
  Object.keys(restrictedThreadFragment.body.hint).length === 0 &&
    Object.keys(restrictedPostFragment.body.hint).length === 0,
  'restricted thread and post fragments are locator-only'
);
assert(
  !JSON.stringify(restrictedThreadFragment).includes(
    restrictedThreadEntity.title
  ) &&
    !JSON.stringify(restrictedPostFragment).includes(
      restrictedPostEntity.content
    ),
  'restricted locator fragments do not copy title or excerpt content'
);

const metadata = (
  envelope: ReturnType<typeof buildV2IndexFragmentEnvelope>,
  created: number
): QdbV2ResourceMetadata => ({
  service: 'DOCUMENT',
  publisherName: 'owner',
  identifier: envelope.recordId,
  created,
  updated: null,
  latestSignature: `signature-${created}`,
});
const entry = (
  entity: V2EntityCreate,
  created: number,
  disclosure: 'content-hint' | 'locator-only' = 'content-hint'
): ValidatedV2IndexEntry => {
  const fragment = buildV2IndexFragmentEnvelope('qdbm', entity, disclosure);
  return {
    entity,
    fragment,
    metadata: metadata(fragment, created),
    freshness: 'current',
  };
};
const entries = [
  entry(topicEntity, 1),
  entry(publicThreadEntity, 2),
  entry(restrictedThreadEntity, 3, 'locator-only'),
  entry(publicPostEntity, 4),
  entry(restrictedPostEntity, 5, 'locator-only'),
];
const accessScope = {
  accessibleThreadIds: new Set([publicThreadEntity.entityId]),
};
const scopedSearch = searchValidatedV2Index(entries, 'secret', accessScope);
assert(
  scopedSearch.length === 1 &&
    scopedSearch[0]?.entity.entityId === publicPostEntity.entityId,
  'V2 search excludes inaccessible thread content before matching'
);
assert(
  searchValidatedV2Index(entries, '', accessScope).every(({ entity }) =>
    entity.entityType === 'topic'
      ? true
      : entity.entityType === 'thread'
        ? entity.entityId === publicThreadEntity.entityId
        : entity.parentThreadId === publicThreadEntity.entityId
  ),
  'empty-query index results also remain inside the access scope'
);
const cachedScopedSearch = searchValidatedV2Index(
  entries.map((item) => ({ ...item, freshness: 'stale' as const })),
  'secret',
  accessScope
);
assert(
  cachedScopedSearch.length === 1 &&
    cachedScopedSearch[0]?.entity.entityId === publicPostEntity.entityId,
  'cached or stale index evidence cannot bypass the access scope'
);

const structureIndex = buildForumStructureSearchIndex(
  [
    {
      id: topicEntity.entityId,
      title: 'Topic',
      description: 'Description',
      createdByUserId: 'owner',
      createdAt: new Date(0).toISOString(),
      sortOrder: 0,
      status: 'open',
      visibility: 'visible',
      subTopicAccess: 'custom',
      allowedAddresses: ['Q-sensitive-topic-wallet'],
    },
  ],
  [
    {
      ...thread('custom'),
      allowedAddresses: ['Q-sensitive-thread-wallet'],
    },
  ],
  [user('Member')]
);
assert(
  !JSON.stringify(structureIndex).includes('Q-sensitive-topic-wallet') &&
    !JSON.stringify(structureIndex).includes('Q-sensitive-thread-wallet'),
  'wallet allowlists are not copied into local search haystacks'
);

const unauthorizedUser = user('Member', 'Q-unlisted-wallet');
const inaccessibleThreads = [thread('custom')].filter((item) =>
  canAccessSubTopic(item, unauthorizedUser, unauthorizedUser.address)
);
const accessScopedStructureIndex = buildForumStructureSearchIndex(
  [],
  inaccessibleThreads,
  [unauthorizedUser]
);
assert(
  searchForumStructure(accessScopedStructureIndex, [], thread('custom').title)
    .matchedSubTopicCount === 0,
  'local structure search cannot match an inaccessible restricted discussion'
);

const restrictedCompatibilityResource =
  forumQdnService.buildSubTopicPublishResource(
    thread('custom'),
    'restricted-owner'
  ).resource;
assert(
  restrictedCompatibilityResource.title ===
    `Forum discussion ${thread('custom').id}` &&
    restrictedCompatibilityResource.description ===
      'Qortium discussion board thread' &&
    restrictedCompatibilityResource.title !== thread('custom').title &&
    restrictedCompatibilityResource.description !==
      thread('custom').description,
  'restricted legacy compatibility publication omits title and description from resource metadata'
);

const legacy = normalizeLegacyEntity({
  entityType: 'thread',
  entityId: 'subtopic_legacy',
  legacyStatus: 'available',
  payload: {
    private: true,
    access: 'custom',
    allowedAddresses: ['Q-legacy-wallet'],
    title: 'Legacy restricted discussion',
  },
});
assert(
  legacy.authorityState === 'UNRESOLVED' &&
    legacy.payload.access === 'custom' &&
    Array.isArray(legacy.payload.allowedAddresses) &&
    legacy.payload.private === true,
  'legacy restricted/private-named fields remain readable without gaining authority'
);
assert(
  !restrictedWarning.includes('Private discussion'),
  'legacy private field naming does not leak into active warning terminology'
);

console.log(`Architecture V2 access tests passed (${passed} assertions)`);
