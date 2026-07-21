import {
  applyModerationToForumStructure,
  applyModerationToPosts,
  buildModerationEnvelope,
  classifyInvalidModerationEnvelope,
  isModerationEnvelope,
  loadModerationState,
  publishModerationEnvelope,
  reduceModerationRecords,
  type ModerationAction,
  type ModerationRecord,
  type TrustedRoleAuthorizationState,
} from '../src/services/architectureV2/moderation.js';
import type { V2State } from '../src/services/architectureV2/reducer.js';
import type { IdentityValidator } from '../src/services/architectureV2/validation.js';
import { buildV2PostEnvelope } from '../src/services/architectureV2/runtime.js';
import { forumQdnService } from '../src/services/qdn/forumQdnService.js';
import { PRIMARY_SYSOP_ADDRESS } from '../src/services/qdn/forumRolesService.js';
import type { Post, SubTopic, Topic, UserRole } from '../src/types/index.js';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};
const wallets: Record<string, string> = {
  alice: 'A',
  moderator: 'M',
  admin: 'D',
  super: 'S',
  sysop: 'ROOT',
  member: 'U',
};
const identity: IdentityValidator = {
  validatePublisher: (metadata, claimed) =>
    metadata.publisherName === claimed
      ? { ok: true }
      : {
          ok: false,
          code: 'IDENTITY_UNVERIFIED',
          detail: 'publisher mismatch',
        },
  validateWalletBinding: (name, wallet) =>
    wallets[name] === wallet
      ? { ok: true }
      : { ok: false, code: 'IDENTITY_UNVERIFIED', detail: 'wallet mismatch' },
};
const authority: V2State = {
  entities: {
    'topic-1': {
      entityType: 'topic',
      entityId: 'topic-1',
      publisherName: 'alice',
      walletAddress: 'A',
      title: 'Topic',
      description: 'Description',
    },
    'thread-1': {
      entityType: 'thread',
      entityId: 'thread-1',
      parentTopicId: 'topic-1',
      publisherName: 'alice',
      walletAddress: 'A',
      title: 'Thread',
      description: 'Description',
    },
    'post-1': {
      entityType: 'post',
      entityId: 'post-1',
      parentThreadId: 'thread-1',
      parentPostId: null,
      publisherName: 'alice',
      walletAddress: 'A',
      content: 'Authoritative',
    },
    'staff-post': {
      entityType: 'post',
      entityId: 'staff-post',
      parentThreadId: 'thread-1',
      parentPostId: null,
      publisherName: 'admin',
      walletAddress: 'D',
      content: 'Staff',
    },
  },
  quarantined: [],
};
const roleState: TrustedRoleAuthorizationState = {
  status: 'VERIFIED',
  model: 'v2-role-operation-history',
  registry: {
    primarySysOpAddress: 'ROOT',
    sysOps: ['S'],
    admins: ['D'],
    moderators: ['M'],
    updatedAt: 1,
  },
  metadata: {
    service: 'DOCUMENT',
    publisherName: 'root-name',
    identifier: 'qdbm-roles-default',
    created: 0,
    updated: 0,
    latestSignature: 'role-current',
  },
  checkpoint: {
    bootstrapIdentifier: 'qdbm-roles-default',
    bootstrapSignature: 'role-current',
    previousOperationId: null,
    previousOperationSignature: null,
  },
  timeline: [],
  audit: [],
  diagnostics: [],
  detail: 'verified test registry',
};
roleState.timeline.push({
  metadata: roleState.metadata,
  registry: roleState.registry,
  checkpoint: roleState.checkpoint,
  operationId: null,
});
const roleFor = (actor: string): UserRole =>
  actor === 'sysop'
    ? 'SysOp'
    : actor === 'super'
      ? 'SuperAdmin'
      : actor === 'admin'
        ? 'Admin'
        : actor === 'moderator'
          ? 'Moderator'
          : 'Member';
let sequence = 0;
const record = (input: {
  action: ModerationAction;
  targetType: 'topic' | 'thread' | 'post';
  targetId: string;
  actor?: string;
  actorRole?: UserRole;
  created?: number;
  recordId?: string;
  publisher?: string;
  registrySignature?: string | null;
  orderValue?: number;
  clientCreatedAt?: string;
}): ModerationRecord => {
  sequence += 1;
  const actor = input.actor ?? 'moderator';
  const created = input.created ?? sequence;
  const recordId = input.recordId ?? `qdbm-v2-mod-${sequence}`;
  const envelope = buildModerationEnvelope(
    {
      operation: 'moderation',
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      actorName: actor,
      actorAddress: wallets[actor] ?? 'unknown',
      authorization: {
        model: 'current-primary-registry-revalidation',
        actorRole: input.actorRole ?? roleFor(actor),
        registryIdentifier: roleState.metadata?.identifier ?? null,
        registrySignature:
          input.registrySignature === undefined
            ? (roleState.metadata?.latestSignature ?? null)
            : input.registrySignature,
      },
      ...(input.orderValue === undefined
        ? {}
        : { orderValue: input.orderValue }),
    },
    recordId,
    input.clientCreatedAt ?? '9999-01-01T00:00:00.000Z'
  );
  return {
    metadata: {
      service: 'DOCUMENT',
      publisherName: input.publisher ?? actor,
      identifier: recordId,
      created,
      updated: null,
      latestSignature: `sig-${created}-${recordId}`,
    },
    envelope,
  };
};
const reduce = (records: ModerationRecord[], roles = roleState) =>
  reduceModerationRecords(records, authority, identity, roles);

const pin = record({ action: 'pin', targetType: 'post', targetId: 'post-1' });
const unpin = record({
  action: 'unpin',
  targetType: 'post',
  targetId: 'post-1',
});
assert(reduce([pin]).targets['post-1']?.pinned === true, 'valid moderator pin');
assert(
  reduce([pin, unpin]).targets['post-1']?.pinned === false,
  'valid moderator unpin'
);
const lock = record({
  action: 'lock',
  targetType: 'thread',
  targetId: 'thread-1',
});
const unlock = record({
  action: 'unlock',
  targetType: 'thread',
  targetId: 'thread-1',
});
assert(
  reduce([unlock, lock]).targets['thread-1']?.locked === false,
  'lock/unlock ordering'
);
const solve = record({
  action: 'solve',
  targetType: 'thread',
  targetId: 'thread-1',
});
const unsolve = record({
  action: 'unsolve',
  targetType: 'thread',
  targetId: 'thread-1',
});
assert(
  reduce([unsolve, solve]).targets['thread-1']?.solved === false,
  'solve/unsolve ordering'
);
const hide = record({
  action: 'hide',
  targetType: 'thread',
  targetId: 'thread-1',
  actor: 'admin',
});
const unhide = record({
  action: 'unhide',
  targetType: 'thread',
  targetId: 'thread-1',
  actor: 'admin',
});
assert(
  reduce([hide, unhide]).targets['thread-1']?.hidden === false,
  'hide/unhide ordering'
);
const remove = record({
  action: 'remove',
  targetType: 'post',
  targetId: 'post-1',
  actor: 'admin',
});
const restore = record({
  action: 'restore',
  targetType: 'post',
  targetId: 'post-1',
  actor: 'admin',
});
assert(
  reduce([remove, restore]).targets['post-1']?.removed === false,
  'remove/restore ordering'
);

const regular = record({
  action: 'lock',
  targetType: 'thread',
  targetId: 'thread-1',
  actor: 'member',
});
assert(
  reduce([regular]).diagnostics[0]?.code === 'MODERATION_INSUFFICIENT_ROLE',
  'regular user rejected'
);
const forged = record({
  action: 'lock',
  targetType: 'thread',
  targetId: 'thread-1',
  publisher: 'member',
});
assert(
  reduce([forged]).diagnostics[0]?.code === 'MODERATION_FORGED_ACTOR',
  'forged actor rejected'
);
const forgedWallet: ModerationRecord = {
  ...lock,
  envelope: buildModerationEnvelope(
    { ...lock.envelope.body, actorAddress: 'D' },
    lock.envelope.recordId
  ),
};
assert(
  reduce([forgedWallet]).diagnostics[0]?.code ===
    'MODERATION_WALLET_BINDING_MISSING',
  'forged wallet rejected'
);
const moderatorHide = record({
  action: 'hide',
  targetType: 'thread',
  targetId: 'thread-1',
});
assert(
  reduce([moderatorHide]).diagnostics[0]?.code ===
    'MODERATION_INSUFFICIENT_ROLE',
  'insufficient role rejected'
);
const staffTarget = record({
  action: 'pin',
  targetType: 'post',
  targetId: 'staff-post',
});
assert(
  reduce([staffTarget]).diagnostics[0]?.code === 'MODERATION_INSUFFICIENT_ROLE',
  'equal/lower staff targeting rejected'
);

const revokedState: TrustedRoleAuthorizationState = {
  ...roleState,
  registry: { ...roleState.registry, moderators: [], updatedAt: 2 },
  checkpoint: {
    ...roleState.checkpoint,
    previousOperationId: 'role-revoke',
    previousOperationSignature: 'role-revoked',
  },
  timeline: [
    ...roleState.timeline,
    {
      metadata: {
        service: 'DOCUMENT',
        publisherName: 'sysop',
        identifier: 'role-revoke',
        created: 2,
        updated: null,
        latestSignature: 'role-revoked',
      },
      registry: { ...roleState.registry, moderators: [], updatedAt: 2 },
      checkpoint: {
        ...roleState.checkpoint,
        previousOperationId: 'role-revoke',
        previousOperationSignature: 'role-revoked',
      },
      operationId: 'role-revoke',
    },
  ],
};
const revoked = record({
  action: 'lock',
  targetType: 'thread',
  targetId: 'thread-1',
  actorRole: 'Moderator',
  registrySignature: 'role-current',
});
assert(
  reduce([revoked], revokedState).diagnostics[0]?.code ===
    'MODERATION_ROLE_REVOKED',
  'revoked role rejected'
);
const changedRegistryState: TrustedRoleAuthorizationState = {
  ...roleState,
  registry: { ...roleState.registry, updatedAt: 500 },
  metadata: {
    ...roleState.metadata!,
    created: 0,
    updated: 500,
    latestSignature: 'role-new-version',
  },
  checkpoint: {
    bootstrapIdentifier: 'qdbm-roles-default',
    bootstrapSignature: 'role-new-version',
    previousOperationId: null,
    previousOperationSignature: null,
  },
  timeline: [
    {
      metadata: {
        ...roleState.metadata!,
        created: 500,
        updated: null,
        latestSignature: 'role-new-version',
      },
      registry: { ...roleState.registry, updatedAt: 500 },
      checkpoint: {
        bootstrapIdentifier: 'qdbm-roles-default',
        bootstrapSignature: 'role-new-version',
        previousOperationId: null,
        previousOperationSignature: null,
      },
      operationId: null,
    },
  ],
};
const historicalUnknown = record({
  action: 'lock',
  targetType: 'thread',
  targetId: 'thread-1',
  actorRole: 'Moderator',
  registrySignature: 'role-current',
  created: 400,
});
assert(
  reduce([historicalUnknown], changedRegistryState).diagnostics[0]?.code ===
    'MODERATION_ROLE_CLAIM_MISMATCH',
  'an obsolete registry reference cannot be treated as historical proof'
);
const retroactiveGrant = record({
  action: 'lock',
  targetType: 'thread',
  targetId: 'thread-1',
  actorRole: 'Moderator',
  registrySignature: 'role-new-version',
  created: 400,
});
if (
  retroactiveGrant.envelope.body.authorization.model ===
  'current-primary-registry-revalidation'
)
  retroactiveGrant.envelope.body.authorization.registryIdentifier =
    changedRegistryState.metadata?.identifier ?? null;
assert(
  reduce([retroactiveGrant], changedRegistryState).diagnostics[0]?.code ===
    'MODERATION_ROLE_CLAIM_MISMATCH',
  'a later role grant cannot retroactively authorize an earlier operation'
);
assert(
  reduce([lock], { ...roleState, status: 'UNAVAILABLE', detail: 'outage' })
    .diagnostics[0]?.code === 'MODERATION_ROLE_STATE_UNAVAILABLE',
  'unavailable role state fails closed'
);
assert(
  reduce([lock], {
    ...roleState,
    status: 'UNVERIFIED',
    detail: 'delegated registry',
  }).diagnostics[0]?.code === 'MODERATION_ROLE_STATE_UNVERIFIED',
  'unverified role state fails closed'
);

const highPin = record({
  action: 'pin',
  targetType: 'post',
  targetId: 'post-1',
  actor: 'admin',
  created: 100,
});
const lowUnpin = record({
  action: 'unpin',
  targetType: 'post',
  targetId: 'post-1',
  actor: 'moderator',
  created: 101,
});
const precedence = reduce([lowUnpin, highPin]);
assert(
  precedence.targets['post-1']?.pinned === true &&
    precedence.diagnostics.some(
      (item) => item.code === 'MODERATION_PRECEDENCE_DENIED'
    ),
  'higher role wins conflict'
);

for (const field of [
  'content',
  'likes',
  'poll',
  'tips',
  'owner',
  'roleRegistry',
] as const) {
  const payload = {
    ...pin.envelope,
    body: { ...pin.envelope.body, [field]: 'forged' },
  };
  assert(
    !isModerationEnvelope(payload) &&
      classifyInvalidModerationEnvelope(payload) ===
        'MODERATION_FORBIDDEN_FIELD',
    `forbidden ${field}`
  );
}
const unsupportedAction: unknown = {
  ...pin.envelope,
  body: { ...pin.envelope.body, action: 'ban' },
};
assert(
  !isModerationEnvelope(unsupportedAction) &&
    classifyInvalidModerationEnvelope(unsupportedAction) ===
      'MODERATION_UNSUPPORTED_ACTION',
  'unsupported moderation action has a stable diagnostic'
);
const missing = record({
  action: 'pin',
  targetType: 'post',
  targetId: 'legacy-or-missing',
});
assert(
  reduce([missing]).diagnostics[0]?.code === 'MODERATION_INVALID_TARGET',
  'missing/unresolved target rejected'
);
const wrongType = record({
  action: 'lock',
  targetType: 'thread',
  targetId: 'post-1',
});
assert(
  reduce([wrongType]).diagnostics[0]?.code ===
    'MODERATION_TARGET_TYPE_MISMATCH',
  'target type rejected'
);
const identifierMismatch: ModerationRecord = {
  ...pin,
  metadata: { ...pin.metadata, identifier: 'qdbm-v2-mod-wrong-id' },
};
assert(
  reduce([identifierMismatch]).diagnostics[0]?.code ===
    'MODERATION_IDENTIFIER_MISMATCH',
  'trusted identifier must match record id'
);

const conflictId = 'qdbm-v2-mod-conflict';
const conflictA = record({
  action: 'pin',
  targetType: 'post',
  targetId: 'post-1',
  recordId: conflictId,
});
const conflictB = record({
  action: 'unpin',
  targetType: 'post',
  targetId: 'post-1',
  recordId: conflictId,
  actor: 'admin',
});
assert(
  reduce([conflictA, conflictB]).diagnostics[0]?.code === 'MODERATION_CONFLICT',
  'conflicting duplicate ids quarantined'
);
assert(reduce([pin, pin]).audit.length === 1, 'exact duplicates idempotent');
const republished: ModerationRecord = {
  ...pin,
  metadata: { ...pin.metadata, updated: pin.metadata.created + 1 },
};
assert(
  reduce([republished]).diagnostics[0]?.code ===
    'MODERATION_RESOURCE_REPUBLISHED',
  'mutable reuse of an append-only operation resource is rejected'
);
const permutation = [pin, unpin, lock, unlock, solve, unsolve, hide];
assert(
  JSON.stringify(reduce(permutation)) ===
    JSON.stringify(reduce([...permutation].reverse())),
  'input permutations deterministic'
);
const futureFirst = record({
  action: 'pin',
  targetType: 'post',
  targetId: 'post-1',
  created: 200,
  clientCreatedAt: '9999-01-01',
});
const pastLater = record({
  action: 'unpin',
  targetType: 'post',
  targetId: 'post-1',
  created: 201,
  clientCreatedAt: '1970-01-01',
});
assert(
  reduce([pastLater, futureFirst]).targets['post-1']?.pinned === false,
  'client time is non-authoritative'
);

const legacyTopic: Topic = {
  id: 'topic-1',
  title: 'Legacy',
  description: 'Legacy',
  createdByUserId: 'alice',
  createdAt: '2020-01-01',
  sortOrder: 9,
  status: 'open',
  visibility: 'visible',
  subTopicAccess: 'everyone',
  allowedAddresses: [],
};
const legacyThread: SubTopic = {
  id: 'thread-1',
  topicId: 'topic-1',
  title: 'Legacy',
  description: 'Legacy',
  authorUserId: 'alice',
  createdAt: '2020-01-01',
  lastPostAt: '2020-01-01',
  lastPostAuthorUserId: 'alice',
  isPinned: false,
  pinnedAt: null,
  isSolved: false,
  solvedAt: null,
  solvedByUserId: null,
  isPoll: false,
  access: 'everyone',
  allowedAddresses: [],
  status: 'open',
  visibility: 'visible',
};
const legacyPost: Post = {
  id: 'post-1',
  subTopicId: 'thread-1',
  authorUserId: 'alice',
  parentPostId: null,
  content: 'Legacy readable',
  attachments: [],
  createdAt: '2020-01-01',
  isPinned: true,
  pinnedAt: '2020-01-01',
  pinnedByUserId: 'legacy-mod',
  likes: 7,
  tips: 8,
  likedByAddresses: ['legacy'],
};
const topicOrder = record({
  action: 'set-order',
  targetType: 'topic',
  targetId: 'topic-1',
  actor: 'super',
  orderValue: 0,
});
const empty = reduce([]);
assert(
  applyModerationToForumStructure([legacyTopic], [legacyThread], empty)
    .subTopics[0]?.status === 'open' &&
    applyModerationToPosts([legacyPost], empty)[0]?.isPinned === true,
  'legacy baseline readable'
);
assert(
  applyModerationToForumStructure(
    [legacyTopic],
    [legacyThread],
    reduce([topicOrder])
  ).topics[0]?.sortOrder === 0,
  'authorized topic ordering is an independent moderation dimension'
);
const overridden = applyModerationToPosts([legacyPost], reduce([unpin]))[0];
assert(
  overridden?.isPinned === false &&
    overridden.content === 'Legacy readable' &&
    overridden.likes === 7 &&
    overridden.tips === 8,
  'V2 only overrides moderation dimension'
);
assert(
  applyModerationToPosts(
    [{ ...legacyPost, isPinned: true }],
    reduce([unpin])
  )[0]?.isPinned === false,
  'V1 snapshot cannot override V2 moderation'
);
assert(
  Object.keys(empty.targets).length === 0 && empty.audit.length === 0,
  'index/legacy fields cannot establish authority'
);

const loadRecord = record({
  action: 'lock',
  targetType: 'thread',
  targetId: 'thread-1',
});
const discovered = [
  {
    name: loadRecord.metadata.publisherName,
    identifier: loadRecord.metadata.identifier,
    service: loadRecord.metadata.service,
    created: loadRecord.metadata.created,
    updated: null,
    latestSignature: loadRecord.metadata.latestSignature,
  },
];
const loaded = await loadModerationState(discovered, {
  fetchPayload: async () =>
    JSON.parse(JSON.stringify(loadRecord.envelope)) as unknown,
  identity,
  roleState,
  authority,
});
assert(
  loaded.targets['thread-1']?.locked === true,
  'discovery/reload reconstructs state'
);
const unavailableLoad = await loadModerationState(
  [
    {
      name: 'moderator',
      identifier: 'qdbm-v2-mod-unavailable',
      service: 'DOCUMENT',
      created: 1,
      updated: null,
    },
  ],
  {
    fetchPayload: async () => {
      throw new Error('unavailable');
    },
    identity,
    roleState,
    authority,
  }
);
assert(
  unavailableLoad.diagnostics[0]?.code === 'MODERATION_RESOURCE_UNAVAILABLE',
  'unavailable diagnostic'
);
const malformedLoad = await loadModerationState(
  [
    {
      name: 'moderator',
      identifier: 'qdbm-v2-mod-malformed',
      service: 'DOCUMENT',
      created: 1,
      updated: null,
    },
  ],
  {
    fetchPayload: async () => ({ kind: 'operation', body: {} }),
    identity,
    roleState,
    authority,
  }
);
assert(
  malformedLoad.diagnostics[0]?.code === 'MALFORMED_MODERATION_ENVELOPE',
  'malformed diagnostic'
);
const missingMetadataLoad = await loadModerationState(
  [{ name: 'moderator', identifier: 'qdbm-v2-mod-no-metadata' }],
  {
    fetchPayload: async () => lock.envelope,
    identity,
    roleState,
    authority,
  }
);
assert(
  missingMetadataLoad.diagnostics[0]?.code ===
    'MODERATION_MISSING_TRUSTED_METADATA',
  'missing trusted metadata diagnostic'
);

let published: unknown;
const success = await publishModerationEnvelope(
  pin.envelope,
  async (envelope) => {
    published = envelope;
  }
);
assert(
  success.ok && published === pin.envelope,
  'independent operation publish boundary'
);
const partial = await publishModerationEnvelope(
  pin.envelope,
  async () => undefined,
  async () => {
    throw new Error('index');
  }
);
assert(
  partial.ok && 'partial' in partial && partial.partial.retryable,
  'index failure is partial success'
);
const failed = await publishModerationEnvelope(pin.envelope, async () => {
  throw new Error('authority');
});
assert(
  failed.ok === false && failed.code === 'MODERATION_PUBLICATION_FAILED',
  'authority failure has no fallback'
);
let legacyDeleteBlocked = false;
try {
  await forumQdnService.deletePost();
} catch (error) {
  legacyDeleteBlocked =
    error instanceof Error &&
    error.message.includes('MODERATION_LEGACY_TARGET_BLOCKED');
}
assert(
  legacyDeleteBlocked,
  'legacy full-snapshot deletion is explicitly blocked'
);

const decodeBase64Json = (value: string): unknown => {
  const binary = atob(value);
  return JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0))
    )
  ) as unknown;
};
const runtimePost = buildV2PostEnvelope({
  entityType: 'post',
  entityId: 'runtime-post',
  parentThreadId: 'runtime-thread',
  parentPostId: null,
  publisherName: 'alice',
  walletAddress: 'A',
  content: 'Runtime target',
});
let publishedRuntimeEnvelope: unknown = null;
let publishedRuntimeIdentifier = '';
let runtimeRolePublisher = 'root-name';
const bridgeCalls: Array<Record<string, unknown>> = [];
const testGlobal = globalThis as typeof globalThis & {
  qdnRequest?: (payload: Record<string, unknown>) => Promise<unknown>;
};
testGlobal.qdnRequest = async (payload) => {
  bridgeCalls.push(payload);
  const action = String(payload.action);
  if (action === 'GET_ACCOUNT_NAMES') return [{ name: 'root-name' }];
  if (action === 'GET_NAME_DATA') {
    const name = String(payload.name);
    return { owner: wallets[name] ?? (name === 'root-name' ? 'ROOT' : null) };
  }
  if (action === 'FETCH_NODE_API')
    return {
      type: 'ARBITRARY',
      method: 'PUT',
      signature: 'runtime-role-signature',
      creatorAddress: PRIMARY_SYSOP_ADDRESS,
      timestamp: 2,
      name: 'root-name',
      identifier: 'qdbm-roles-default',
      blockHeight: 2,
      blockSequence: 0,
    };
  if (action === 'SEARCH_QDN_RESOURCES') {
    const identifier = String(payload.identifier);
    if (identifier === 'qdbm-roles-default')
      return [
        {
          name: runtimeRolePublisher,
          service: 'DOCUMENT',
          identifier,
          created: 1,
          updated: 2,
          latestSignature: 'runtime-role-signature',
        },
      ];
    if (identifier === 'qdbm-v2-post-')
      return [
        {
          name: 'alice',
          service: 'DOCUMENT',
          identifier: runtimePost.recordId,
          created: 10,
          updated: null,
          latestSignature: 'runtime-post-signature',
        },
      ];
    if (identifier === 'qdbm-v2-mod-' && publishedRuntimeEnvelope)
      return [
        {
          name: 'moderator',
          service: 'DOCUMENT',
          identifier: publishedRuntimeIdentifier,
          created: 20,
          updated: null,
          latestSignature: 'runtime-moderation-signature',
        },
      ];
    return [];
  }
  if (action === 'FETCH_QDN_RESOURCE') {
    const identifier = String(payload.identifier);
    if (identifier === 'qdbm-roles-default')
      return {
        version: 1,
        type: 'role-registry',
        updatedAt: 2,
        registry: {
          primarySysOpAddress: 'ROOT',
          sysOps: ['S'],
          admins: ['D'],
          moderators: ['M'],
        },
      };
    if (identifier === runtimePost.recordId) return runtimePost;
    if (identifier === publishedRuntimeIdentifier)
      return publishedRuntimeEnvelope;
  }
  if (action === 'PUBLISH_QDN_RESOURCE') {
    publishedRuntimeIdentifier = String(payload.identifier);
    publishedRuntimeEnvelope = decodeBase64Json(String(payload.data64));
    return { success: true };
  }
  throw new Error(`unexpected mocked action ${action}`);
};
const runtimePublish = await forumQdnService.publishV2ModerationOperation({
  action: 'pin',
  targetType: 'post',
  targetId: 'runtime-post',
  actorName: 'moderator',
  actorAddress: 'M',
});
assert(
  runtimePublish.ok &&
    isModerationEnvelope(publishedRuntimeEnvelope) &&
    bridgeCalls.some((call) => call.action === 'PUBLISH_QDN_RESOURCE'),
  'forum QDN service publishes an authenticated independent operation'
);
const runtimeReload = await forumQdnService.loadV2ModerationState();
assert(
  runtimeReload.targets['runtime-post']?.pinned === true,
  'forum QDN service reloads and reduces the published moderation operation'
);
runtimeRolePublisher = 'delegated-root';
const publicationsBeforeUntrustedRole = bridgeCalls.filter(
  (call) => call.action === 'PUBLISH_QDN_RESOURCE'
).length;
let untrustedRoleRejected = false;
try {
  await forumQdnService.publishV2ModerationOperation({
    action: 'unpin',
    targetType: 'post',
    targetId: 'runtime-post',
    actorName: 'moderator',
    actorAddress: 'M',
  });
} catch (error) {
  untrustedRoleRejected =
    error instanceof Error &&
    error.message.includes('MODERATION_INSUFFICIENT_ROLE');
}
assert(
  untrustedRoleRejected &&
    bridgeCalls.filter((call) => call.action === 'PUBLISH_QDN_RESOURCE')
      .length === publicationsBeforeUntrustedRole,
  'delegated role snapshots outside the primary trust root fail closed without publication'
);
delete testGlobal.qdnRequest;

console.log('Architecture V2 moderation tests passed');
