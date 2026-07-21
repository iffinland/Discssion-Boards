import {
  buildRoleOperationEnvelope,
  isRoleOperationEnvelope,
  reduceRoleOperations,
  resolveRole,
  type RoleLineage,
  type RoleOperationRecord,
} from '../src/services/architectureV2/roles.js';
import {
  isModerationEnvelope,
  reduceModerationRecords,
} from '../src/services/architectureV2/moderation.js';
import { buildV2PostEnvelope } from '../src/services/architectureV2/runtime.js';
import { forumQdnService } from '../src/services/qdn/forumQdnService.js';
import {
  PRIMARY_SYSOP_ADDRESS,
  forumRolesService,
} from '../src/services/qdn/forumRolesService.js';
import { clearWalletLookupCaches } from '../src/services/qortium/walletService.js';
import type { ForumRoleRegistry } from '../src/types/index.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const bootstrapMetadata = {
  service: 'DOCUMENT',
  publisherName: 'root-name',
  identifier: 'qdbm-roles-default',
  created: 1,
  updated: 2,
  latestSignature: 'bootstrap-signature',
};
const bootstrapRegistry: ForumRoleRegistry = {
  primarySysOpAddress: 'ROOT',
  sysOps: [],
  admins: ['LEGACY-ADMIN'],
  moderators: ['LEGACY-MODERATOR'],
  updatedAt: 2,
};
const roleRecord = (input: {
  id: string;
  created: number;
  actorName: string;
  actorAddress: string;
  targetAddress: string;
  role: 'Moderator' | 'Admin' | 'SuperAdmin';
  action?: 'assign' | 'revoke';
  prior: RoleLineage;
  publisher?: string;
  transactionName?: string;
  transactionCreator?: string;
  signature?: string;
  updated?: number | null;
  clientCreatedAt?: string;
}): RoleOperationRecord => {
  const signature = input.signature ?? `sig-${input.created}-${input.id}`;
  const publisher = input.publisher ?? input.actorName;
  return {
    metadata: {
      service: 'DOCUMENT',
      publisherName: publisher,
      identifier: input.id,
      created: input.created,
      updated: input.updated ?? null,
      latestSignature: signature,
    },
    envelope: buildRoleOperationEnvelope(
      {
        operation: 'role-change',
        action: input.action ?? 'assign',
        targetAddress: input.targetAddress,
        role: input.role,
        actorName: input.actorName,
        actorAddress: input.actorAddress,
        prior: input.prior,
      },
      input.id,
      input.clientCreatedAt ?? '9999-01-01T00:00:00.000Z'
    ),
    transaction: {
      type: 'ARBITRARY',
      method: 'PUT',
      signature,
      creatorAddress: input.transactionCreator ?? input.actorAddress,
      timestamp: input.created,
      name: input.transactionName ?? publisher,
      identifier: input.id,
      blockHeight: input.created,
      blockSequence: 0,
    },
  };
};

const reduce = (records: RoleOperationRecord[]) =>
  reduceRoleOperations({
    primarySysOpAddress: 'ROOT',
    bootstrapRegistry,
    bootstrapMetadata,
    records,
  });

const bootstrap = reduce([]);
assert(
  resolveRole('LEGACY-ADMIN', bootstrap.registry) === 'Admin' &&
    resolveRole('LEGACY-MODERATOR', bootstrap.registry) === 'Moderator',
  'trusted legacy assignments survive bootstrap migration'
);
const grantSuper = roleRecord({
  id: 'role-01-super',
  created: 10,
  actorName: 'root',
  actorAddress: 'ROOT',
  targetAddress: 'SUPER',
  role: 'SuperAdmin',
  prior: bootstrap.checkpoint,
});
const afterSuper = reduce([grantSuper]);
assert(
  resolveRole('SUPER', afterSuper.registry) === 'SuperAdmin',
  'SysOp grant'
);
const grantAdmin = roleRecord({
  id: 'role-02-admin',
  created: 11,
  actorName: 'super',
  actorAddress: 'SUPER',
  targetAddress: 'ADMIN',
  role: 'Admin',
  prior: afterSuper.checkpoint,
});
const afterAdmin = reduce([grantSuper, grantAdmin]);
assert(
  resolveRole('ADMIN', afterAdmin.registry) === 'Admin',
  'delegated SuperAdmin grant'
);
const grantModerator = roleRecord({
  id: 'role-03-moderator',
  created: 12,
  actorName: 'admin',
  actorAddress: 'ADMIN',
  targetAddress: 'MODERATOR',
  role: 'Moderator',
  prior: afterAdmin.checkpoint,
});
const afterModerator = reduce([grantSuper, grantAdmin, grantModerator]);
assert(
  resolveRole('MODERATOR', afterModerator.registry) === 'Moderator',
  'delegated Admin lower-role grant'
);
const repeatedAssign = roleRecord({
  id: 'role-04-repeat-assign',
  created: 13,
  actorName: 'admin',
  actorAddress: 'ADMIN',
  targetAddress: 'MODERATOR',
  role: 'Moderator',
  prior: afterModerator.checkpoint,
});
const afterRepeat = reduce([
  grantSuper,
  grantAdmin,
  grantModerator,
  repeatedAssign,
]);
assert(
  afterRepeat.registry.moderators.filter((value) => value === 'MODERATOR')
    .length === 1,
  'repeated assignment is idempotent'
);
const revokeModerator = roleRecord({
  id: 'role-05-revoke',
  created: 14,
  actorName: 'admin',
  actorAddress: 'ADMIN',
  targetAddress: 'MODERATOR',
  role: 'Moderator',
  action: 'revoke',
  prior: afterRepeat.checkpoint,
});
const afterRevoke = reduce([
  grantSuper,
  grantAdmin,
  grantModerator,
  repeatedAssign,
  revokeModerator,
]);
assert(
  resolveRole('MODERATOR', afterRevoke.registry) === 'Member',
  'revocation'
);
const repeatedRevoke = roleRecord({
  id: 'role-06-repeat-revoke',
  created: 15,
  actorName: 'admin',
  actorAddress: 'ADMIN',
  targetAddress: 'MODERATOR',
  role: 'Moderator',
  action: 'revoke',
  prior: afterRevoke.checkpoint,
});
assert(
  reduce([
    grantSuper,
    grantAdmin,
    grantModerator,
    repeatedAssign,
    revokeModerator,
    repeatedRevoke,
  ]).audit.length === 6,
  'repeated revocation is deterministic and idempotent'
);

const rejectionCode = (record: RoleOperationRecord) =>
  reduce([record]).diagnostics[0]?.code;
assert(
  rejectionCode(
    roleRecord({
      id: 'bad-member',
      created: 20,
      actorName: 'member',
      actorAddress: 'MEMBER',
      targetAddress: 'OTHER',
      role: 'Moderator',
      prior: bootstrap.checkpoint,
    })
  ) === 'ROLE_INSUFFICIENT_PRIOR_ROLE',
  'Member cannot assign roles'
);
assert(
  rejectionCode(
    roleRecord({
      id: 'bad-moderator',
      created: 20,
      actorName: 'legacy-moderator',
      actorAddress: 'LEGACY-MODERATOR',
      targetAddress: 'OTHER',
      role: 'Moderator',
      prior: bootstrap.checkpoint,
    })
  ) === 'ROLE_INSUFFICIENT_PRIOR_ROLE',
  'Moderator cannot assign roles'
);
const selfEscalation = roleRecord({
  id: 'bad-self',
  created: 20,
  actorName: 'legacy-admin',
  actorAddress: 'LEGACY-ADMIN',
  targetAddress: 'LEGACY-ADMIN',
  role: 'SuperAdmin',
  prior: bootstrap.checkpoint,
});
assert(
  rejectionCode(selfEscalation) === 'ROLE_SELF_ESCALATION_ATTEMPT',
  'self escalation rejected'
);
const illegalAbove = roleRecord({
  id: 'bad-above',
  created: 20,
  actorName: 'legacy-admin',
  actorAddress: 'LEGACY-ADMIN',
  targetAddress: 'OTHER',
  role: 'SuperAdmin',
  prior: bootstrap.checkpoint,
});
assert(
  rejectionCode(illegalAbove) === 'ROLE_FORBIDDEN_ASSIGNMENT',
  'grant above actor rejected'
);
const rootMutation = roleRecord({
  id: 'bad-root',
  created: 20,
  actorName: 'root',
  actorAddress: 'ROOT',
  targetAddress: 'ROOT',
  role: 'SuperAdmin',
  action: 'revoke',
  prior: bootstrap.checkpoint,
});
assert(
  rejectionCode(rootMutation) === 'ROLE_PROTECTED_SYSOP_MUTATION',
  'fixed root protected'
);
const peerMutation = roleRecord({
  id: 'bad-peer',
  created: 20,
  actorName: 'legacy-admin',
  actorAddress: 'LEGACY-ADMIN',
  targetAddress: 'ADMIN-PEER',
  role: 'Moderator',
  prior: bootstrap.checkpoint,
});
const peerBootstrap: ForumRoleRegistry = {
  ...bootstrapRegistry,
  admins: [...bootstrapRegistry.admins, 'ADMIN-PEER'],
};
assert(
  reduceRoleOperations({
    primarySysOpAddress: 'ROOT',
    bootstrapRegistry: peerBootstrap,
    bootstrapMetadata,
    records: [peerMutation],
  }).diagnostics[0]?.code === 'ROLE_TARGET_HIERARCHY_VIOLATION',
  'peer/higher target protected'
);
assert(
  rejectionCode({
    ...illegalAbove,
    metadata: { ...illegalAbove.metadata, publisherName: 'forger' },
  }) === 'ROLE_FORGED_ACTOR',
  'forged embedded actor rejected before authorization'
);
assert(
  rejectionCode(
    roleRecord({
      ...{
        id: 'bad-wallet',
        created: 20,
        actorName: 'root',
        actorAddress: 'ROOT',
        targetAddress: 'OTHER',
        role: 'Moderator' as const,
        prior: bootstrap.checkpoint,
      },
      transactionCreator: 'FORGED',
    })
  ) === 'ROLE_PUBLISHER_WALLET_MISMATCH',
  'publisher wallet mismatch rejected'
);
assert(
  rejectionCode(
    roleRecord({
      id: 'bad-publisher',
      created: 20,
      actorName: 'root',
      actorAddress: 'ROOT',
      targetAddress: 'OTHER',
      role: 'Moderator',
      prior: bootstrap.checkpoint,
      transactionName: 'different-name',
    })
  ) === 'ROLE_UNTRUSTED_PUBLISHER',
  'untrusted QDN publisher rejected'
);
const unauthorizedGrant = roleRecord({
  id: 'bad-chain-grant',
  created: 21,
  actorName: 'member',
  actorAddress: 'MEMBER',
  targetAddress: 'ATTACKER',
  role: 'Admin',
  prior: bootstrap.checkpoint,
});
const consumeForgedGrant = roleRecord({
  id: 'bad-chain-consume',
  created: 22,
  actorName: 'attacker',
  actorAddress: 'ATTACKER',
  targetAddress: 'ALLY',
  role: 'Moderator',
  prior: {
    ...bootstrap.checkpoint,
    previousOperationId: unauthorizedGrant.envelope.recordId,
    previousOperationSignature:
      unauthorizedGrant.metadata.latestSignature ?? null,
  },
});
const badChain = reduce([unauthorizedGrant, consumeForgedGrant]);
assert(
  badChain.audit.length === 0 &&
    badChain.diagnostics.some((item) => item.code === 'ROLE_LINEAGE_MISMATCH'),
  'authorization is prior-state sequential and cannot consume a forged grant'
);

const branchA = roleRecord({
  id: 'branch-a',
  created: 30,
  signature: 'a-signature',
  actorName: 'root',
  actorAddress: 'ROOT',
  targetAddress: 'BRANCH-A',
  role: 'Admin',
  prior: bootstrap.checkpoint,
  clientCreatedAt: '9999-12-31T00:00:00.000Z',
});
const branchB = roleRecord({
  id: 'branch-b',
  created: 30,
  signature: 'b-signature',
  actorName: 'root',
  actorAddress: 'ROOT',
  targetAddress: 'BRANCH-B',
  role: 'Admin',
  prior: bootstrap.checkpoint,
  clientCreatedAt: '1970-01-01T00:00:00.000Z',
});
const branchForward = reduce([branchA, branchB]);
const branchReverse = reduce([branchB, branchA]);
assert(
  JSON.stringify(branchForward.registry) ===
    JSON.stringify(branchReverse.registry) &&
    JSON.stringify(branchForward.diagnostics) ===
      JSON.stringify(branchReverse.diagnostics) &&
    resolveRole('BRANCH-A', branchForward.registry) === 'Admin' &&
    resolveRole('BRANCH-B', branchForward.registry) === 'Member',
  'trusted metadata tie-breakers are deterministic and client time is ignored'
);
const conflictingCopy = {
  ...branchA,
  envelope: buildRoleOperationEnvelope(
    { ...branchA.envelope.body, targetAddress: 'CONFLICT' },
    branchA.envelope.recordId
  ),
};
assert(
  reduce([branchA, conflictingCopy]).diagnostics[0]?.code ===
    'ROLE_OPERATION_CONFLICT',
  'conflicting duplicate resource is quarantined'
);
assert(
  !isRoleOperationEnvelope({
    ...grantSuper.envelope,
    body: { ...grantSuper.envelope.body, role: 'SysOp' },
  }),
  'SysOp transfer is not representable by the strict role schema'
);

const decodeBase64Json = (value: string): unknown => {
  const binary = atob(value);
  return JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0))
    )
  ) as unknown;
};
type RuntimeResource = {
  name: string;
  service: string;
  identifier: string;
  created: number;
  updated: number | null;
  latestSignature: string;
};
const runtimeWallets: Record<string, string> = {
  'root-name': PRIMARY_SYSOP_ADDRESS,
  'super-name': 'RUNTIME-SUPER',
  'admin-name': 'RUNTIME-ADMIN',
  'moderator-name': 'RUNTIME-MODERATOR',
  'member-name': 'RUNTIME-MEMBER',
};
const runtimePost = buildV2PostEnvelope({
  entityType: 'post',
  entityId: 'role-runtime-post',
  parentThreadId: 'role-runtime-thread',
  parentPostId: null,
  publisherName: 'member-name',
  walletAddress: 'RUNTIME-MEMBER',
  content: 'Role integration target',
});
const roleResources: RuntimeResource[] = [];
const rolePayloads = new Map<string, unknown>();
const transactions = new Map<string, unknown>();
transactions.set('runtime-bootstrap-signature', {
  type: 'ARBITRARY',
  method: 'PUT',
  signature: 'runtime-bootstrap-signature',
  creatorAddress: PRIMARY_SYSOP_ADDRESS,
  timestamp: 2,
  name: 'root-name',
  identifier: 'qdbm-roles-default',
  blockHeight: 2,
  blockSequence: 0,
});
const moderationResources: RuntimeResource[] = [];
const moderationPayloads = new Map<string, unknown>();
let runtimeSequence = 100;
let rejectNextPublication = false;
let failRoleDiscovery = false;
let failRoleDiscoveryAfterNextPublish = false;
const bridgeCalls: Array<Record<string, unknown>> = [];
const testGlobal = globalThis as typeof globalThis & {
  qdnRequest?: (payload: Record<string, unknown>) => Promise<unknown>;
};
testGlobal.qdnRequest = async (payload) => {
  bridgeCalls.push(payload);
  const action = String(payload.action);
  if (action === 'GET_ACCOUNT_NAMES') return [{ name: 'root-name' }];
  if (action === 'GET_NAME_DATA')
    return { owner: runtimeWallets[String(payload.name)] ?? null };
  if (action === 'SEARCH_QDN_RESOURCES') {
    const identifier = String(payload.identifier);
    if (identifier === 'qdbm-roles-default')
      return [
        {
          name: 'delegated-snapshot',
          service: 'DOCUMENT',
          identifier,
          created: 2,
          updated: 3,
          latestSignature: 'delegated-snapshot-signature',
        },
        {
          name: 'root-name',
          service: 'DOCUMENT',
          identifier,
          created: 1,
          updated: 2,
          latestSignature: 'runtime-bootstrap-signature',
        },
      ].slice(Number(payload.offset ?? 0), Number(payload.offset ?? 0) + 100);
    if (identifier === 'qdbm-v2-role-') {
      if (failRoleDiscovery)
        throw new Error('temporary role discovery failure');
      return roleResources.slice(
        Number(payload.offset ?? 0),
        Number(payload.offset ?? 0) + 100
      );
    }
    if (identifier === 'qdbm-v2-post-')
      return [
        {
          name: 'member-name',
          service: 'DOCUMENT',
          identifier: runtimePost.recordId,
          created: 50,
          updated: null,
          latestSignature: 'runtime-post-signature',
        },
      ];
    if (identifier === 'qdbm-v2-mod-') return moderationResources;
    return [];
  }
  if (action === 'FETCH_QDN_RESOURCE') {
    const name = String(payload.name);
    const identifier = String(payload.identifier);
    if (identifier === 'qdbm-roles-default' && name === 'root-name')
      return {
        version: 1,
        type: 'role-registry',
        updatedAt: 2,
        registry: {
          primarySysOpAddress: PRIMARY_SYSOP_ADDRESS,
          sysOps: [],
          admins: ['LEGACY-RUNTIME-ADMIN'],
          moderators: [],
        },
      };
    if (identifier === runtimePost.recordId) return runtimePost;
    if (rolePayloads.has(identifier)) return rolePayloads.get(identifier);
    if (moderationPayloads.has(identifier))
      return moderationPayloads.get(identifier);
    throw new Error('mock resource unavailable');
  }
  if (action === 'FETCH_NODE_API') {
    const signature = decodeURIComponent(
      String(payload.path).split('/').pop() ?? ''
    );
    const transaction = transactions.get(signature);
    if (!transaction) throw new Error('mock transaction unavailable');
    return transaction;
  }
  if (action === 'PUBLISH_QDN_RESOURCE') {
    if (rejectNextPublication) {
      rejectNextPublication = false;
      throw new Error('mock publication rejected');
    }
    const identifier = String(payload.identifier);
    const name = String(payload.name);
    const decoded = decodeBase64Json(String(payload.data64));
    runtimeSequence += 1;
    if (identifier.startsWith('qdbm-v2-role-')) {
      const signature = `runtime-role-signature-${runtimeSequence}`;
      roleResources.push({
        name,
        service: 'DOCUMENT',
        identifier,
        created: runtimeSequence,
        updated: null,
        latestSignature: signature,
      });
      rolePayloads.set(identifier, decoded);
      transactions.set(signature, {
        type: 'ARBITRARY',
        method: 'PUT',
        signature,
        creatorAddress: runtimeWallets[name],
        timestamp: runtimeSequence,
        name,
        identifier,
        blockHeight: runtimeSequence,
        blockSequence: 0,
      });
      if (failRoleDiscoveryAfterNextPublish) {
        failRoleDiscoveryAfterNextPublish = false;
        failRoleDiscovery = true;
      }
    } else if (identifier.startsWith('qdbm-v2-mod-')) {
      moderationResources.push({
        name,
        service: 'DOCUMENT',
        identifier,
        created: runtimeSequence,
        updated: null,
        latestSignature: `runtime-mod-signature-${runtimeSequence}`,
      });
      moderationPayloads.set(identifier, decoded);
    }
    return { success: true };
  }
  throw new Error(`unexpected mocked action ${action}`);
};

clearWalletLookupCaches();
const runtimeBootstrap =
  await forumRolesService.loadTrustedRoleAuthorizationState({
    force: true,
  });
assert(
  runtimeBootstrap.status === 'VERIFIED' &&
    resolveRole('LEGACY-RUNTIME-ADMIN', runtimeBootstrap.registry) ===
      'Admin' &&
    runtimeBootstrap.diagnostics.some(
      (item) => item.code === 'ROLE_LEGACY_DELEGATED_SNAPSHOT_IGNORED'
    ),
  'canonical legacy registry bootstraps while delegated snapshots remain untrusted evidence'
);
const publishRole = async (
  input: Parameters<typeof forumRolesService.publishRoleOperation>[0]
) => {
  const result = await forumRolesService.publishRoleOperation(input);
  assert(
    result.ok && !('partial' in result),
    `role publication persists: ${input.action} ${input.role}`
  );
  if (!result.ok || 'partial' in result)
    throw new Error('unreachable role publish assertion');
  return result.state;
};
let runtimeState = await publishRole({
  action: 'assign',
  role: 'SuperAdmin',
  targetAddress: 'RUNTIME-SUPER',
  actorName: 'root-name',
  actorAddress: PRIMARY_SYSOP_ADDRESS,
});
runtimeState = await publishRole({
  action: 'assign',
  role: 'Admin',
  targetAddress: 'RUNTIME-ADMIN',
  actorName: 'super-name',
  actorAddress: 'RUNTIME-SUPER',
});
runtimeState = await publishRole({
  action: 'assign',
  role: 'Moderator',
  targetAddress: 'RUNTIME-MODERATOR',
  actorName: 'admin-name',
  actorAddress: 'RUNTIME-ADMIN',
});
const reloadedGrant = await forumRolesService.loadTrustedRoleAuthorizationState(
  {
    force: true,
  }
);
assert(
  resolveRole('RUNTIME-SUPER', reloadedGrant.registry) === 'SuperAdmin' &&
    resolveRole('RUNTIME-ADMIN', reloadedGrant.registry) === 'Admin' &&
    resolveRole('RUNTIME-MODERATOR', reloadedGrant.registry) === 'Moderator' &&
    reloadedGrant.audit.length === 3,
  'delegated SuperAdmin/Admin grants survive full discovery and reduction reload'
);

const moderationPublish = await forumQdnService.publishV2ModerationOperation({
  action: 'pin',
  targetType: 'post',
  targetId: 'role-runtime-post',
  actorName: 'moderator-name',
  actorAddress: 'RUNTIME-MODERATOR',
});
assert(
  moderationPublish.ok,
  'delegated role authorizes Phase 4 moderation after reload'
);
const moderationBeforeRevoke = await forumQdnService.loadV2ModerationState();
assert(
  moderationBeforeRevoke.targets['role-runtime-post']?.pinned === true,
  'published moderation operation reloads under delegated role history'
);
runtimeState = await publishRole({
  action: 'revoke',
  role: 'Moderator',
  targetAddress: 'RUNTIME-MODERATOR',
  actorName: 'admin-name',
  actorAddress: 'RUNTIME-ADMIN',
});
assert(
  resolveRole('RUNTIME-MODERATOR', runtimeState.registry) === 'Member',
  'delegated revoke persisted'
);
const reloadedRevoke =
  await forumRolesService.loadTrustedRoleAuthorizationState({
    force: true,
  });
assert(
  resolveRole('RUNTIME-MODERATOR', reloadedRevoke.registry) === 'Member',
  'revocation survives full reload'
);
const publicationsBeforeRevokedModeration = moderationResources.length;
let revokedModerationRejected = false;
try {
  await forumQdnService.publishV2ModerationOperation({
    action: 'unpin',
    targetType: 'post',
    targetId: 'role-runtime-post',
    actorName: 'moderator-name',
    actorAddress: 'RUNTIME-MODERATOR',
  });
} catch (error) {
  revokedModerationRejected =
    error instanceof Error &&
    error.message.includes('MODERATION_INSUFFICIENT_ROLE');
}
assert(
  revokedModerationRejected &&
    moderationResources.length === publicationsBeforeRevokedModeration,
  'revoked actor cannot publish a new moderation operation'
);
const moderationAfterRevoke = await forumQdnService.loadV2ModerationState();
assert(
  moderationAfterRevoke.targets['role-runtime-post']?.pinned === true,
  'later revocation does not retroactively invalidate prior valid moderation'
);

const auditBeforeFailure = reloadedRevoke.audit.length;
rejectNextPublication = true;
const rejectedPublication = await forumRolesService.publishRoleOperation({
  action: 'assign',
  role: 'Moderator',
  targetAddress: 'REJECTED-TARGET',
  actorName: 'root-name',
  actorAddress: PRIMARY_SYSOP_ADDRESS,
});
assert(
  rejectedPublication.ok === false &&
    !rejectedPublication.published &&
    (await forumRolesService.loadTrustedRoleAuthorizationState({ force: true }))
      .audit.length === auditBeforeFailure,
  'publication rejection leaves trusted state unchanged'
);
failRoleDiscoveryAfterNextPublish = true;
const partialPublication = await forumRolesService.publishRoleOperation({
  action: 'assign',
  role: 'Moderator',
  targetAddress: 'RECOVERABLE-TARGET',
  actorName: 'root-name',
  actorAddress: PRIMARY_SYSOP_ADDRESS,
});
assert(
  partialPublication.ok &&
    'partial' in partialPublication &&
    partialPublication.partial.pending === 'role-state-refresh',
  'published authority plus refresh failure is explicit retryable partial success'
);
failRoleDiscovery = false;
const recovered = await forumRolesService.loadTrustedRoleAuthorizationState({
  force: true,
});
assert(
  resolveRole('RECOVERABLE-TARGET', recovered.registry) === 'Moderator',
  'partial publication is recoverable by complete reload'
);

const historicalModeration = moderationResources[0];
const historicalEnvelope = moderationPayloads.get(
  historicalModeration.identifier
);
assert(
  isModerationEnvelope(historicalEnvelope),
  'historical moderation payload remains schema-valid'
);
assert(
  reduceModerationRecords(
    [
      {
        metadata: {
          service: historicalModeration.service,
          publisherName: historicalModeration.name,
          identifier: historicalModeration.identifier,
          created: historicalModeration.created,
          updated: historicalModeration.updated,
          latestSignature: historicalModeration.latestSignature,
        },
        envelope: historicalEnvelope,
      },
    ],
    {
      entities: {
        'role-runtime-post': runtimePost.body,
      },
      quarantined: [],
    },
    {
      validatePublisher: (metadata, claimed) =>
        metadata.publisherName === claimed
          ? { ok: true }
          : { ok: false, code: 'IDENTITY_UNVERIFIED', detail: 'publisher' },
      validateWalletBinding: (name, wallet) =>
        runtimeWallets[name] === wallet
          ? { ok: true }
          : { ok: false, code: 'IDENTITY_UNVERIFIED', detail: 'wallet' },
    },
    recovered
  ).targets['role-runtime-post']?.pinned === true,
  'historical role checkpoint is consumed deterministically by moderation'
);

assert(
  bridgeCalls.some((call) => call.action === 'FETCH_NODE_API'),
  'immutable Core transaction evidence participates in role verification'
);
const trustedBootstrapTransaction = transactions.get(
  'runtime-bootstrap-signature'
);
transactions.set('runtime-bootstrap-signature', {
  ...(typeof trustedBootstrapTransaction === 'object' &&
  trustedBootstrapTransaction !== null
    ? trustedBootstrapTransaction
    : {}),
  creatorAddress: 'TRANSFERRED-NAME-OWNER',
});
const transferredBootstrap =
  await forumRolesService.loadTrustedRoleAuthorizationState({ force: true });
assert(
  transferredBootstrap.status === 'UNAVAILABLE' &&
    transferredBootstrap.diagnostics.some(
      (item) => item.code === 'ROLE_BOOTSTRAP_TRUST_FAILURE'
    ),
  'current/cached name ownership cannot replace immutable primary transaction proof'
);
transactions.set('runtime-bootstrap-signature', trustedBootstrapTransaction);
delete testGlobal.qdnRequest;

console.log('Architecture V2 role persistence tests passed');
