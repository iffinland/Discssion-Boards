import type {
  ForumRoleRegistry,
  Post,
  SubTopic,
  Topic,
  UserRole,
} from '../../types/index.js';
import type { V2State } from './reducer.js';
import type {
  QdbV2ResourceMetadata,
  RejectionCode,
  V2EntityType,
} from './types.js';
import type { IdentityValidator } from './validation.js';
import { validateMetadata } from './validation.js';

export type ModerationAction =
  | 'pin'
  | 'unpin'
  | 'lock'
  | 'unlock'
  | 'solve'
  | 'unsolve'
  | 'hide'
  | 'unhide'
  | 'remove'
  | 'restore'
  | 'set-order';

export type ModerationRoleVerificationStatus =
  | 'VERIFIED'
  | 'UNVERIFIED'
  | 'UNAVAILABLE';

export type TrustedRoleAuthorizationState = {
  status: ModerationRoleVerificationStatus;
  model: 'current-primary-registry-revalidation';
  registry: ForumRoleRegistry;
  metadata: QdbV2ResourceMetadata | null;
  detail: string;
};

export type ModerationAuthorizationReference = {
  model: 'current-primary-registry-revalidation';
  actorRole: UserRole;
  registryIdentifier: string | null;
  registrySignature: string | null;
};

export type ModerationOperation = {
  operation: 'moderation';
  action: ModerationAction;
  targetType: V2EntityType;
  targetId: string;
  actorName: string;
  actorAddress: string;
  authorization: ModerationAuthorizationReference;
  reason?: string;
  orderValue?: number;
};

export type ModerationEnvelope = {
  schema: 'qdb-v2';
  schemaVersion: 2;
  kind: 'operation';
  recordType: 'moderation';
  recordId: string;
  targetId: string;
  body: ModerationOperation;
  clientCreatedAt?: string;
};

export type ModerationRecord = {
  metadata: QdbV2ResourceMetadata;
  envelope: ModerationEnvelope;
};

export type DiscoveredModerationResource = {
  name?: string;
  identifier?: string;
  service?: string;
  created?: number;
  updated?: number | null;
  latestSignature?: string;
};

export type ModerationDiagnosticCode =
  | RejectionCode
  | 'MALFORMED_MODERATION_ENVELOPE'
  | 'MODERATION_INVALID_TARGET'
  | 'MODERATION_TARGET_TYPE_MISMATCH'
  | 'MODERATION_IDENTIFIER_MISMATCH'
  | 'MODERATION_FORGED_ACTOR'
  | 'MODERATION_WALLET_BINDING_MISSING'
  | 'MODERATION_INSUFFICIENT_ROLE'
  | 'MODERATION_ROLE_REVOKED'
  | 'MODERATION_ROLE_CLAIM_MISMATCH'
  | 'MODERATION_ROLE_STATE_UNVERIFIED'
  | 'MODERATION_ROLE_STATE_UNAVAILABLE'
  | 'MODERATION_FORBIDDEN_FIELD'
  | 'MODERATION_UNSUPPORTED_ACTION'
  | 'MODERATION_PRECEDENCE_DENIED'
  | 'MODERATION_CONFLICT'
  | 'MODERATION_RESOURCE_REPUBLISHED'
  | 'MODERATION_RESOURCE_UNAVAILABLE'
  | 'MODERATION_MISSING_TRUSTED_METADATA'
  | 'MODERATION_LEGACY_TARGET_BLOCKED';

export type ModerationDiagnostic = {
  code: ModerationDiagnosticCode;
  identifier: string;
  detail: string;
};

export type ModerationDecision = {
  action: ModerationAction;
  actorName: string;
  actorAddress: string;
  actorRole: UserRole;
  reason: string | null;
  trustedCreated: number;
  latestSignature: string | null;
  identifier: string;
};

export type EntityModerationState = {
  targetType: V2EntityType;
  pinned?: boolean;
  locked?: boolean;
  solved?: boolean;
  hidden?: boolean;
  removed?: boolean;
  order?: number;
  decisions: Partial<
    Record<
      'pin' | 'lock' | 'solve' | 'hide' | 'remove' | 'order',
      ModerationDecision
    >
  >;
};

export type ReducedModerationState = {
  targets: Record<string, EntityModerationState>;
  diagnostics: ModerationDiagnostic[];
  audit: ModerationDecision[];
};

export type ModerationLoaderDependencies = {
  fetchPayload: (resource: DiscoveredModerationResource) => Promise<unknown>;
  identity: IdentityValidator;
  roleState: TrustedRoleAuthorizationState;
  authority: V2State;
};

export type ModerationPublishResult =
  | { ok: true; envelope: ModerationEnvelope }
  | {
      ok: true;
      envelope: ModerationEnvelope;
      partial: { pending: 'derived-index'; retryable: true };
      detail: string;
    }
  | {
      ok: false;
      code: 'MODERATION_PUBLICATION_FAILED';
      detail: string;
    };

const MODERATION_ACTIONS: readonly ModerationAction[] = [
  'pin',
  'unpin',
  'lock',
  'unlock',
  'solve',
  'unsolve',
  'hide',
  'unhide',
  'remove',
  'restore',
  'set-order',
];

const ROLE_RANK: Record<UserRole, number> = {
  Member: 0,
  Moderator: 1,
  Admin: 2,
  SuperAdmin: 3,
  SysOp: 4,
};

const MINIMUM_ROLE: Record<
  V2EntityType,
  Partial<Record<ModerationAction, UserRole>>
> = {
  topic: {
    lock: 'Admin',
    unlock: 'Admin',
    hide: 'Admin',
    unhide: 'Admin',
    remove: 'Admin',
    restore: 'Admin',
    'set-order': 'SuperAdmin',
  },
  thread: {
    pin: 'Admin',
    unpin: 'Admin',
    lock: 'Moderator',
    unlock: 'Moderator',
    solve: 'Moderator',
    unsolve: 'Moderator',
    hide: 'Admin',
    unhide: 'Admin',
    remove: 'Admin',
    restore: 'Admin',
    'set-order': 'SuperAdmin',
  },
  post: {
    pin: 'Moderator',
    unpin: 'Moderator',
    hide: 'Admin',
    unhide: 'Admin',
    remove: 'Admin',
    restore: 'Admin',
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

const isUserRole = (value: unknown): value is UserRole =>
  value === 'Member' ||
  value === 'Moderator' ||
  value === 'Admin' ||
  value === 'SuperAdmin' ||
  value === 'SysOp';

const isEntityType = (value: unknown): value is V2EntityType =>
  value === 'topic' || value === 'thread' || value === 'post';

const isModerationAction = (value: unknown): value is ModerationAction =>
  MODERATION_ACTIONS.some((action) => action === value);

export const resolveRoleFromTrustedState = (
  address: string,
  state: TrustedRoleAuthorizationState
): UserRole => {
  const normalized = address.trim();
  if (normalized === state.registry.primarySysOpAddress) return 'SysOp';
  if (state.registry.sysOps.includes(normalized)) return 'SuperAdmin';
  if (state.registry.admins.includes(normalized)) return 'Admin';
  if (state.registry.moderators.includes(normalized)) return 'Moderator';
  return 'Member';
};

export const isModerationEnvelope = (
  value: unknown
): value is ModerationEnvelope => {
  if (!isRecord(value) || !isRecord(value.body)) return false;
  const body = value.body;
  if (!isRecord(body.authorization)) return false;
  const authorization = body.authorization;
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
      'action',
      'targetType',
      'targetId',
      'actorName',
      'actorAddress',
      'authorization',
      'reason',
      'orderValue',
    ]) &&
    hasOnlyKeys(authorization, [
      'model',
      'actorRole',
      'registryIdentifier',
      'registrySignature',
    ]) &&
    value.schema === 'qdb-v2' &&
    value.schemaVersion === 2 &&
    value.kind === 'operation' &&
    value.recordType === 'moderation' &&
    typeof value.recordId === 'string' &&
    value.recordId.trim().length > 0 &&
    typeof value.targetId === 'string' &&
    value.targetId.trim().length > 0 &&
    (value.clientCreatedAt === undefined ||
      typeof value.clientCreatedAt === 'string') &&
    body.operation === 'moderation' &&
    isModerationAction(body.action) &&
    isEntityType(body.targetType) &&
    typeof body.targetId === 'string' &&
    body.targetId === value.targetId &&
    typeof body.actorName === 'string' &&
    body.actorName.trim().length > 0 &&
    typeof body.actorAddress === 'string' &&
    body.actorAddress.trim().length > 0 &&
    (body.reason === undefined || typeof body.reason === 'string') &&
    (body.action === 'set-order'
      ? Number.isSafeInteger(body.orderValue) &&
        typeof body.orderValue === 'number' &&
        body.orderValue >= 0
      : body.orderValue === undefined) &&
    authorization.model === 'current-primary-registry-revalidation' &&
    isUserRole(authorization.actorRole) &&
    (typeof authorization.registryIdentifier === 'string' ||
      authorization.registryIdentifier === null) &&
    (typeof authorization.registrySignature === 'string' ||
      authorization.registrySignature === null)
  );
};

export const classifyInvalidModerationEnvelope = (
  value: unknown
): ModerationDiagnosticCode => {
  if (!isRecord(value) || !isRecord(value.body))
    return 'MALFORMED_MODERATION_ENVELOPE';
  if (
    typeof value.targetId === 'string' &&
    typeof value.body.targetId === 'string' &&
    value.targetId !== value.body.targetId
  )
    return 'MODERATION_INVALID_TARGET';
  const allowedEnvelope = [
    'schema',
    'schemaVersion',
    'kind',
    'recordType',
    'recordId',
    'targetId',
    'body',
    'clientCreatedAt',
  ];
  const allowedBody = [
    'operation',
    'action',
    'targetType',
    'targetId',
    'actorName',
    'actorAddress',
    'authorization',
    'reason',
    'orderValue',
  ];
  if (
    !hasOnlyKeys(value, allowedEnvelope) ||
    !hasOnlyKeys(value.body, allowedBody)
  )
    return 'MODERATION_FORBIDDEN_FIELD';
  if (
    value.body.operation === 'moderation' &&
    !isModerationAction(value.body.action)
  )
    return 'MODERATION_UNSUPPORTED_ACTION';
  return 'MALFORMED_MODERATION_ENVELOPE';
};

export const buildModerationEnvelope = (
  body: ModerationOperation,
  recordId: string,
  clientCreatedAt = new Date().toISOString()
): ModerationEnvelope => ({
  schema: 'qdb-v2',
  schemaVersion: 2,
  kind: 'operation',
  recordType: 'moderation',
  recordId,
  targetId: body.targetId,
  body,
  clientCreatedAt,
});

const canonicalize = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
};

const compareRecords = (left: ModerationRecord, right: ModerationRecord) => {
  if (left.metadata.created !== right.metadata.created)
    return left.metadata.created - right.metadata.created;
  const signature = (left.metadata.latestSignature ?? '').localeCompare(
    right.metadata.latestSignature ?? ''
  );
  if (signature) return signature;
  const identifier = left.metadata.identifier.localeCompare(
    right.metadata.identifier
  );
  if (identifier) return identifier;
  return left.metadata.publisherName.localeCompare(
    right.metadata.publisherName
  );
};

const dimensionForAction = (
  action: ModerationAction
): keyof EntityModerationState['decisions'] => {
  if (action === 'pin' || action === 'unpin') return 'pin';
  if (action === 'lock' || action === 'unlock') return 'lock';
  if (action === 'solve' || action === 'unsolve') return 'solve';
  if (action === 'hide' || action === 'unhide') return 'hide';
  if (action === 'remove' || action === 'restore') return 'remove';
  return 'order';
};

const roleStateChangedSinceClaim = (
  operation: ModerationOperation,
  state: TrustedRoleAuthorizationState
) =>
  operation.authorization.registrySignature !==
    (state.metadata?.latestSignature ?? null) ||
  operation.authorization.registryIdentifier !==
    (state.metadata?.identifier ?? null);

const diagnostic = (
  code: ModerationDiagnosticCode,
  record: ModerationRecord,
  detail: string
): ModerationDiagnostic => ({
  code,
  identifier: record.metadata.identifier,
  detail,
});

const validateRecord = (
  record: ModerationRecord,
  authority: V2State,
  identity: IdentityValidator,
  roleState: TrustedRoleAuthorizationState
):
  | { ok: true; actorRole: UserRole }
  | { ok: false; diagnostic: ModerationDiagnostic } => {
  const metadata = validateMetadata(record.metadata);
  if (metadata.ok === false)
    return {
      ok: false,
      diagnostic: diagnostic(metadata.code, record, metadata.detail),
    };
  if (record.metadata.updated !== null)
    return {
      ok: false,
      diagnostic: diagnostic(
        'MODERATION_RESOURCE_REPUBLISHED',
        record,
        'moderation operations are append-only and cannot reuse an updated QDN resource'
      ),
    };
  if (record.metadata.identifier !== record.envelope.recordId)
    return {
      ok: false,
      diagnostic: diagnostic(
        'MODERATION_IDENTIFIER_MISMATCH',
        record,
        'trusted QDN identifier does not match moderation record id'
      ),
    };
  const body = record.envelope.body;
  const target = authority.entities[body.targetId];
  if (!target)
    return {
      ok: false,
      diagnostic: diagnostic(
        'MODERATION_INVALID_TARGET',
        record,
        'target has no authoritative V2 entity; unresolved legacy authority is read-only'
      ),
    };
  if (target.entityType !== body.targetType)
    return {
      ok: false,
      diagnostic: diagnostic(
        'MODERATION_TARGET_TYPE_MISMATCH',
        record,
        'moderation target type does not match authoritative entity'
      ),
    };
  const publisher = identity.validatePublisher(record.metadata, body.actorName);
  if (publisher.ok === false)
    return {
      ok: false,
      diagnostic: diagnostic(
        'MODERATION_FORGED_ACTOR',
        record,
        publisher.detail
      ),
    };
  const wallet = identity.validateWalletBinding(
    body.actorName,
    body.actorAddress
  );
  if (wallet.ok === false)
    return {
      ok: false,
      diagnostic: diagnostic(
        'MODERATION_WALLET_BINDING_MISSING',
        record,
        wallet.detail
      ),
    };
  if (roleState.status === 'UNAVAILABLE')
    return {
      ok: false,
      diagnostic: diagnostic(
        'MODERATION_ROLE_STATE_UNAVAILABLE',
        record,
        roleState.detail
      ),
    };
  if (roleState.status === 'UNVERIFIED')
    return {
      ok: false,
      diagnostic: diagnostic(
        'MODERATION_ROLE_STATE_UNVERIFIED',
        record,
        roleState.detail
      ),
    };
  const actorRole = resolveRoleFromTrustedState(body.actorAddress, roleState);
  if (actorRole !== body.authorization.actorRole) {
    const revoked =
      ROLE_RANK[actorRole] < ROLE_RANK[body.authorization.actorRole] &&
      roleStateChangedSinceClaim(body, roleState);
    return {
      ok: false,
      diagnostic: diagnostic(
        revoked ? 'MODERATION_ROLE_REVOKED' : 'MODERATION_ROLE_CLAIM_MISMATCH',
        record,
        revoked
          ? 'current trusted role state no longer authorizes the claimed role'
          : 'payload role claim does not match current trusted role state'
      ),
    };
  }
  if (actorRole !== 'SysOp' && roleStateChangedSinceClaim(body, roleState))
    return {
      ok: false,
      diagnostic: diagnostic(
        'MODERATION_ROLE_STATE_UNAVAILABLE',
        record,
        'the referenced historical role-registry version is no longer independently verifiable'
      ),
    };
  const registryOrderTime = roleState.metadata
    ? (roleState.metadata.updated ?? roleState.metadata.created)
    : null;
  if (
    actorRole !== 'SysOp' &&
    registryOrderTime !== null &&
    record.metadata.created < registryOrderTime
  )
    return {
      ok: false,
      diagnostic: diagnostic(
        'MODERATION_ROLE_CLAIM_MISMATCH',
        record,
        'moderation publication predates the trusted registry version it claims'
      ),
    };
  const minimumRole = MINIMUM_ROLE[body.targetType][body.action];
  if (!minimumRole || ROLE_RANK[actorRole] < ROLE_RANK[minimumRole])
    return {
      ok: false,
      diagnostic: diagnostic(
        'MODERATION_INSUFFICIENT_ROLE',
        record,
        `${actorRole} cannot ${body.action} ${body.targetType}`
      ),
    };
  const targetOwnerRole = resolveRoleFromTrustedState(
    target.walletAddress,
    roleState
  );
  const sameWallet = target.walletAddress.trim() === body.actorAddress.trim();
  if (
    !sameWallet &&
    targetOwnerRole !== 'Member' &&
    ROLE_RANK[actorRole] <= ROLE_RANK[targetOwnerRole]
  )
    return {
      ok: false,
      diagnostic: diagnostic(
        'MODERATION_INSUFFICIENT_ROLE',
        record,
        'staff may not moderate content owned by an equal or higher trusted role'
      ),
    };
  return { ok: true, actorRole };
};

export const reduceModerationRecords = (
  records: ModerationRecord[],
  authority: V2State,
  identity: IdentityValidator,
  roleState: TrustedRoleAuthorizationState
): ReducedModerationState => {
  const state: ReducedModerationState = {
    targets: {},
    diagnostics: [],
    audit: [],
  };
  const grouped = new Map<string, ModerationRecord[]>();
  records.forEach((record) => {
    const group = grouped.get(record.envelope.recordId) ?? [];
    group.push(record);
    grouped.set(record.envelope.recordId, group);
  });
  const candidates: ModerationRecord[] = [];
  [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([, group]) => {
      const distinct = new Map(
        group.map((record) => [
          canonicalize({
            metadata: record.metadata,
            envelope: record.envelope,
          }),
          record,
        ])
      );
      if (distinct.size > 1) {
        const first = [...group].sort(compareRecords)[0];
        state.diagnostics.push(
          diagnostic(
            'MODERATION_CONFLICT',
            first,
            'conflicting records reuse the same moderation record id'
          )
        );
        return;
      }
      candidates.push([...distinct.values()][0]);
    });

  [...candidates].sort(compareRecords).forEach((record) => {
    const valid = validateRecord(record, authority, identity, roleState);
    if (valid.ok === false) {
      state.diagnostics.push(valid.diagnostic);
      return;
    }
    const body = record.envelope.body;
    const dimension = dimensionForAction(body.action);
    const current = state.targets[body.targetId] ?? {
      targetType: body.targetType,
      decisions: {},
    };
    const prior = current.decisions[dimension];
    if (prior && ROLE_RANK[valid.actorRole] < ROLE_RANK[prior.actorRole]) {
      state.diagnostics.push(
        diagnostic(
          'MODERATION_PRECEDENCE_DENIED',
          record,
          `${valid.actorRole} cannot override ${prior.actorRole} moderation`
        )
      );
      return;
    }
    const decision: ModerationDecision = {
      action: body.action,
      actorName: body.actorName,
      actorAddress: body.actorAddress,
      actorRole: valid.actorRole,
      reason: body.reason?.trim() || null,
      trustedCreated: record.metadata.created,
      latestSignature: record.metadata.latestSignature ?? null,
      identifier: record.metadata.identifier,
    };
    const next: EntityModerationState = {
      ...current,
      decisions: { ...current.decisions, [dimension]: decision },
    };
    if (dimension === 'pin') next.pinned = body.action === 'pin';
    else if (dimension === 'lock') next.locked = body.action === 'lock';
    else if (dimension === 'solve') next.solved = body.action === 'solve';
    else if (dimension === 'hide') next.hidden = body.action === 'hide';
    else if (dimension === 'remove') next.removed = body.action === 'remove';
    else next.order = body.orderValue;
    state.targets[body.targetId] = next;
    state.audit.push(decision);
  });
  return state;
};

export const loadModerationState = async (
  resources: DiscoveredModerationResource[],
  dependencies: ModerationLoaderDependencies
): Promise<ReducedModerationState> => {
  const records: ModerationRecord[] = [];
  const diagnostics: ModerationDiagnostic[] = [];
  for (const resource of resources) {
    const identifier = resource.identifier ?? '';
    if (
      !resource.name ||
      !identifier ||
      !resource.service ||
      typeof resource.created !== 'number' ||
      (resource.updated !== undefined &&
        resource.updated !== null &&
        typeof resource.updated !== 'number')
    ) {
      diagnostics.push({
        code: 'MODERATION_MISSING_TRUSTED_METADATA',
        identifier,
        detail: 'moderation resource lacks trusted Core metadata',
      });
      continue;
    }
    let payload: unknown;
    try {
      payload = await dependencies.fetchPayload(resource);
    } catch {
      diagnostics.push({
        code: 'MODERATION_RESOURCE_UNAVAILABLE',
        identifier,
        detail: 'moderation resource payload is unavailable',
      });
      continue;
    }
    if (!isModerationEnvelope(payload)) {
      diagnostics.push({
        code: classifyInvalidModerationEnvelope(payload),
        identifier,
        detail: 'moderation payload failed strict schema validation',
      });
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
    });
  }
  const reduced = reduceModerationRecords(
    records,
    dependencies.authority,
    dependencies.identity,
    dependencies.roleState
  );
  return {
    ...reduced,
    diagnostics: [...diagnostics, ...reduced.diagnostics],
  };
};

export const applyModerationToForumStructure = (
  topics: Topic[],
  subTopics: SubTopic[],
  moderation: ReducedModerationState
) => {
  const moderatedTopics = topics
    .map((topic) => {
      const state = moderation.targets[topic.id];
      if (!state || state.targetType !== 'topic') return topic;
      return {
        ...topic,
        ...(state.locked === undefined
          ? {}
          : { status: state.locked ? ('locked' as const) : ('open' as const) }),
        ...(state.hidden === undefined
          ? {}
          : {
              visibility: state.hidden
                ? ('hidden' as const)
                : ('visible' as const),
            }),
        ...(state.order === undefined ? {} : { sortOrder: state.order }),
      };
    })
    .filter((topic) => moderation.targets[topic.id]?.removed !== true)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const moderatedSubTopics = subTopics
    .map((subTopic) => {
      const state = moderation.targets[subTopic.id];
      if (!state || state.targetType !== 'thread') return subTopic;
      const decisions = Object.values(state.decisions).filter(
        (decision): decision is NonNullable<typeof decision> =>
          decision !== undefined
      );
      const latest = decisions.sort(
        (left, right) => right.trustedCreated - left.trustedCreated
      )[0];
      return {
        ...subTopic,
        ...(state.pinned === undefined
          ? {}
          : {
              isPinned: state.pinned,
              pinnedAt: state.pinned
                ? new Date(
                    state.decisions.pin?.trustedCreated ?? 0
                  ).toISOString()
                : null,
            }),
        ...(state.locked === undefined
          ? {}
          : { status: state.locked ? ('locked' as const) : ('open' as const) }),
        ...(state.solved === undefined
          ? {}
          : {
              isSolved: state.solved,
              solvedAt: state.solved
                ? new Date(
                    state.decisions.solve?.trustedCreated ?? 0
                  ).toISOString()
                : null,
              solvedByUserId: state.solved
                ? (state.decisions.solve?.actorName ?? null)
                : null,
            }),
        ...(state.hidden === undefined
          ? {}
          : {
              visibility: state.hidden
                ? ('hidden' as const)
                : ('visible' as const),
            }),
        ...(state.order === undefined ? {} : { moderationOrder: state.order }),
        ...(latest
          ? {
              lastModerationAction: latest.action,
              lastModerationReason: latest.reason,
              lastModeratedByUserId: latest.actorName,
              lastModeratedAt: new Date(latest.trustedCreated).toISOString(),
            }
          : {}),
      };
    })
    .filter((subTopic) => moderation.targets[subTopic.id]?.removed !== true);
  return { topics: moderatedTopics, subTopics: moderatedSubTopics };
};

export const applyModerationToPosts = (
  posts: Post[],
  moderation: ReducedModerationState
) =>
  posts
    .map((post) => {
      const state = moderation.targets[post.id];
      if (!state || state.targetType !== 'post') return post;
      return {
        ...post,
        ...(state.pinned === undefined
          ? {}
          : {
              isPinned: state.pinned,
              pinnedAt: state.pinned
                ? new Date(
                    state.decisions.pin?.trustedCreated ?? 0
                  ).toISOString()
                : null,
              pinnedByUserId: state.pinned
                ? (state.decisions.pin?.actorName ?? null)
                : null,
            }),
        moderationHidden: state.hidden ?? post.moderationHidden,
        moderationRemoved: state.removed ?? post.moderationRemoved,
      };
    })
    .filter((post) => !post.moderationHidden && !post.moderationRemoved);

export const publishModerationEnvelope = async (
  envelope: ModerationEnvelope,
  publishAuthoritative: (envelope: ModerationEnvelope) => Promise<void>,
  publishDerived?: () => Promise<void>
): Promise<ModerationPublishResult> => {
  try {
    await publishAuthoritative(envelope);
  } catch (error) {
    return {
      ok: false,
      code: 'MODERATION_PUBLICATION_FAILED',
      detail:
        error instanceof Error
          ? error.message
          : 'moderation operation publication failed',
    };
  }
  if (publishDerived) {
    try {
      await publishDerived();
    } catch (error) {
      return {
        ok: true,
        envelope,
        partial: { pending: 'derived-index', retryable: true },
        detail:
          error instanceof Error
            ? error.message
            : 'derived index publication failed',
      };
    }
  }
  return { ok: true, envelope };
};
