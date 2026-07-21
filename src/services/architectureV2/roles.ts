import type { ForumRoleRegistry, UserRole } from '../../types/index.js';
import type { QdbV2ResourceMetadata } from './types.js';
import { validateMetadata } from './validation.js';

export type RoleOperationAction = 'assign' | 'revoke';
export type DelegableRole = 'Moderator' | 'Admin' | 'SuperAdmin';
export type RoleVerificationStatus = 'VERIFIED' | 'UNVERIFIED' | 'UNAVAILABLE';

export type RoleLineage = {
  bootstrapIdentifier: string | null;
  bootstrapSignature: string | null;
  previousOperationId: string | null;
  previousOperationSignature: string | null;
};

export type RoleOperation = {
  operation: 'role-change';
  action: RoleOperationAction;
  targetAddress: string;
  role: DelegableRole;
  actorName: string;
  actorAddress: string;
  prior: RoleLineage;
  reason?: string;
};

export type RoleOperationEnvelope = {
  schema: 'qdb-v2';
  schemaVersion: 2;
  kind: 'operation';
  recordType: 'role-change';
  recordId: string;
  targetId: string;
  body: RoleOperation;
  clientCreatedAt?: string;
};

export type RoleTransactionEvidence = {
  type: 'ARBITRARY';
  method: 'PUT';
  signature: string;
  creatorAddress: string;
  timestamp: number;
  name: string;
  identifier: string;
  blockHeight?: number | null;
  blockSequence?: number | null;
};

export type RoleOperationRecord = {
  metadata: QdbV2ResourceMetadata;
  envelope: RoleOperationEnvelope;
  transaction: RoleTransactionEvidence;
};

export type RoleDiagnosticCode =
  | 'MALFORMED_ROLE_OPERATION'
  | 'ROLE_FORGED_ACTOR'
  | 'ROLE_PUBLISHER_WALLET_MISMATCH'
  | 'ROLE_UNTRUSTED_PUBLISHER'
  | 'ROLE_INSUFFICIENT_PRIOR_ROLE'
  | 'ROLE_SELF_ESCALATION_ATTEMPT'
  | 'ROLE_FORBIDDEN_ASSIGNMENT'
  | 'ROLE_FORBIDDEN_REVOCATION'
  | 'ROLE_TARGET_HIERARCHY_VIOLATION'
  | 'ROLE_TARGET_ROLE_MISMATCH'
  | 'ROLE_PROTECTED_SYSOP_MUTATION'
  | 'ROLE_OPERATION_CONFLICT'
  | 'ROLE_LINEAGE_MISMATCH'
  | 'ROLE_IDENTIFIER_MISMATCH'
  | 'ROLE_TRANSACTION_MISMATCH'
  | 'ROLE_RESOURCE_REPUBLISHED'
  | 'ROLE_RESOURCE_UNAVAILABLE'
  | 'ROLE_TRANSACTION_UNAVAILABLE'
  | 'ROLE_NAME_WALLET_UNAVAILABLE'
  | 'ROLE_MISSING_TRUSTED_METADATA'
  | 'ROLE_LEGACY_DELEGATED_SNAPSHOT_IGNORED'
  | 'ROLE_OPERATION_PREDATES_BOOTSTRAP'
  | 'ROLE_BOOTSTRAP_TRUST_FAILURE'
  | 'ROLE_DISCOVERY_INCOMPLETE';

export type RoleDiagnostic = {
  code: RoleDiagnosticCode;
  identifier: string;
  detail: string;
};

export type RoleAuditEntry = {
  recordId: string;
  action: RoleOperationAction;
  role: DelegableRole;
  targetAddress: string;
  actorName: string;
  actorAddress: string;
  actorRole: UserRole;
  priorRole: UserRole;
  resultingRole: UserRole;
  trustedCreated: number;
  latestSignature: string;
  blockHeight: number | null;
  blockSequence: number | null;
  reason: string | null;
  checkpoint: RoleLineage;
};

export type RoleTimelineEntry = {
  metadata: QdbV2ResourceMetadata | null;
  registry: ForumRoleRegistry;
  checkpoint: RoleLineage;
  operationId: string | null;
};

export type TrustedRoleAuthorizationState = {
  status: RoleVerificationStatus;
  model: 'v2-role-operation-history';
  registry: ForumRoleRegistry;
  metadata: QdbV2ResourceMetadata | null;
  checkpoint: RoleLineage;
  timeline: RoleTimelineEntry[];
  audit: RoleAuditEntry[];
  diagnostics: RoleDiagnostic[];
  detail: string;
};

const ROLE_RANK: Record<UserRole, number> = {
  Member: 0,
  Moderator: 1,
  Admin: 2,
  SuperAdmin: 3,
  SysOp: 4,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

const isDelegableRole = (value: unknown): value is DelegableRole =>
  value === 'Moderator' || value === 'Admin' || value === 'SuperAdmin';

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

export const isRoleOperationEnvelope = (
  value: unknown
): value is RoleOperationEnvelope => {
  if (!isRecord(value) || !isRecord(value.body)) return false;
  const body = value.body;
  if (!isRecord(body.prior)) return false;
  const prior = body.prior;
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
      'targetAddress',
      'role',
      'actorName',
      'actorAddress',
      'prior',
      'reason',
    ]) &&
    hasOnlyKeys(prior, [
      'bootstrapIdentifier',
      'bootstrapSignature',
      'previousOperationId',
      'previousOperationSignature',
    ]) &&
    value.schema === 'qdb-v2' &&
    value.schemaVersion === 2 &&
    value.kind === 'operation' &&
    value.recordType === 'role-change' &&
    typeof value.recordId === 'string' &&
    value.recordId.trim().length > 0 &&
    typeof value.targetId === 'string' &&
    value.targetId.trim().length > 0 &&
    (value.clientCreatedAt === undefined ||
      typeof value.clientCreatedAt === 'string') &&
    body.operation === 'role-change' &&
    (body.action === 'assign' || body.action === 'revoke') &&
    typeof body.targetAddress === 'string' &&
    body.targetAddress.trim().length > 0 &&
    value.targetId === body.targetAddress &&
    isDelegableRole(body.role) &&
    typeof body.actorName === 'string' &&
    body.actorName.trim().length > 0 &&
    typeof body.actorAddress === 'string' &&
    body.actorAddress.trim().length > 0 &&
    (body.reason === undefined || typeof body.reason === 'string') &&
    isNullableString(prior.bootstrapIdentifier) &&
    isNullableString(prior.bootstrapSignature) &&
    isNullableString(prior.previousOperationId) &&
    isNullableString(prior.previousOperationSignature) &&
    ((prior.bootstrapIdentifier === null &&
      prior.bootstrapSignature === null) ||
      (Boolean(prior.bootstrapIdentifier?.trim()) &&
        Boolean(prior.bootstrapSignature?.trim()))) &&
    ((prior.previousOperationId === null &&
      prior.previousOperationSignature === null) ||
      (Boolean(prior.previousOperationId?.trim()) &&
        Boolean(prior.previousOperationSignature?.trim())))
  );
};

export const buildRoleOperationEnvelope = (
  body: RoleOperation,
  recordId: string,
  clientCreatedAt = new Date().toISOString()
): RoleOperationEnvelope => ({
  schema: 'qdb-v2',
  schemaVersion: 2,
  kind: 'operation',
  recordType: 'role-change',
  recordId,
  targetId: body.targetAddress,
  body,
  clientCreatedAt,
});

const normalizeAddresses = (values: string[], excluded: Set<string>) => {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim())
    .filter((value) => {
      if (!value || seen.has(value) || excluded.has(value)) return false;
      seen.add(value);
      return true;
    });
};

export const normalizeRoleRegistry = (
  registry: ForumRoleRegistry
): ForumRoleRegistry => {
  const root = registry.primarySysOpAddress.trim();
  const excluded = new Set([root]);
  const sysOps = normalizeAddresses(registry.sysOps, excluded);
  sysOps.forEach((address) => excluded.add(address));
  const admins = normalizeAddresses(registry.admins, excluded);
  admins.forEach((address) => excluded.add(address));
  const moderators = normalizeAddresses(registry.moderators, excluded);
  return {
    primarySysOpAddress: root,
    sysOps,
    admins,
    moderators,
    updatedAt: registry.updatedAt,
  };
};

export const resolveRole = (
  address: string | null | undefined,
  registry: ForumRoleRegistry
): UserRole => {
  const normalized = address?.trim();
  if (!normalized) return 'Member';
  if (normalized === registry.primarySysOpAddress) return 'SysOp';
  if (registry.sysOps.includes(normalized)) return 'SuperAdmin';
  if (registry.admins.includes(normalized)) return 'Admin';
  if (registry.moderators.includes(normalized)) return 'Moderator';
  return 'Member';
};

export const roleLineageEquals = (left: RoleLineage, right: RoleLineage) =>
  left.bootstrapIdentifier === right.bootstrapIdentifier &&
  left.bootstrapSignature === right.bootstrapSignature &&
  left.previousOperationId === right.previousOperationId &&
  left.previousOperationSignature === right.previousOperationSignature;

const bootstrapCheckpoint = (
  metadata: QdbV2ResourceMetadata | null
): RoleLineage => ({
  bootstrapIdentifier: metadata?.identifier ?? null,
  bootstrapSignature: metadata?.latestSignature ?? null,
  previousOperationId: null,
  previousOperationSignature: null,
});

export const compareRoleOrder = (
  left: QdbV2ResourceMetadata,
  right: QdbV2ResourceMetadata
) => {
  if (left.created !== right.created) return left.created - right.created;
  const signature = (left.latestSignature ?? '').localeCompare(
    right.latestSignature ?? ''
  );
  if (signature) return signature;
  const identifier = left.identifier.localeCompare(right.identifier);
  if (identifier) return identifier;
  return left.publisherName.localeCompare(right.publisherName);
};

const effectiveBootstrapMetadata = (
  metadata: QdbV2ResourceMetadata | null
): QdbV2ResourceMetadata | null =>
  metadata
    ? {
        ...metadata,
        created: metadata.updated ?? metadata.created,
        updated: null,
      }
    : null;

const canonicalize = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
};

const diagnostic = (
  code: RoleDiagnosticCode,
  identifier: string,
  detail: string
): RoleDiagnostic => ({ code, identifier, detail });

const replaceRole = (
  registry: ForumRoleRegistry,
  address: string,
  role: UserRole
): ForumRoleRegistry => ({
  ...registry,
  sysOps: registry.sysOps.filter((value) => value !== address),
  admins: registry.admins.filter((value) => value !== address),
  moderators: registry.moderators.filter((value) => value !== address),
  ...(role === 'SuperAdmin'
    ? {
        sysOps: [
          ...registry.sysOps.filter((value) => value !== address),
          address,
        ],
      }
    : {}),
  ...(role === 'Admin'
    ? {
        admins: [
          ...registry.admins.filter((value) => value !== address),
          address,
        ],
      }
    : {}),
  ...(role === 'Moderator'
    ? {
        moderators: [
          ...registry.moderators.filter((value) => value !== address),
          address,
        ],
      }
    : {}),
});

export const validateRoleMutationAgainstPriorState = (
  operation: RoleOperation,
  registry: ForumRoleRegistry,
  checkpoint: RoleLineage
):
  | { ok: true; actorRole: UserRole; targetRole: UserRole }
  | { ok: false; code: RoleDiagnosticCode; detail: string } => {
  if (!roleLineageEquals(operation.prior, checkpoint))
    return {
      ok: false,
      code: 'ROLE_LINEAGE_MISMATCH',
      detail: 'role operation does not extend the current trusted checkpoint',
    };
  const actorRole = resolveRole(operation.actorAddress, registry);
  const targetRole = resolveRole(operation.targetAddress, registry);
  if (operation.targetAddress === registry.primarySysOpAddress)
    return {
      ok: false,
      code: 'ROLE_PROTECTED_SYSOP_MUTATION',
      detail: 'the fixed primary SysOp trust root cannot be changed',
    };
  if (operation.targetAddress === operation.actorAddress)
    return {
      ok: false,
      code: 'ROLE_SELF_ESCALATION_ATTEMPT',
      detail: 'delegated actors cannot mutate their own role',
    };
  if (ROLE_RANK[actorRole] <= ROLE_RANK.Member)
    return {
      ok: false,
      code: 'ROLE_INSUFFICIENT_PRIOR_ROLE',
      detail: `${actorRole} cannot mutate role state`,
    };
  if (actorRole === 'Moderator')
    return {
      ok: false,
      code: 'ROLE_INSUFFICIENT_PRIOR_ROLE',
      detail: 'Moderator cannot assign or revoke roles',
    };
  if (ROLE_RANK[operation.role] >= ROLE_RANK[actorRole])
    return {
      ok: false,
      code:
        operation.action === 'assign'
          ? 'ROLE_FORBIDDEN_ASSIGNMENT'
          : 'ROLE_FORBIDDEN_REVOCATION',
      detail: 'an actor cannot mutate a role equal to or above their own',
    };
  if (targetRole !== 'Member' && ROLE_RANK[targetRole] >= ROLE_RANK[actorRole])
    return {
      ok: false,
      code: 'ROLE_TARGET_HIERARCHY_VIOLATION',
      detail: 'an actor cannot modify a peer or higher-role target',
    };
  if (
    operation.action === 'revoke' &&
    targetRole !== 'Member' &&
    targetRole !== operation.role
  )
    return {
      ok: false,
      code: 'ROLE_TARGET_ROLE_MISMATCH',
      detail: 'the target no longer holds the role being revoked',
    };
  return { ok: true, actorRole, targetRole };
};

const validateRecord = (
  record: RoleOperationRecord,
  registry: ForumRoleRegistry,
  checkpoint: RoleLineage
):
  | { ok: true; actorRole: UserRole; targetRole: UserRole }
  | { ok: false; diagnostic: RoleDiagnostic } => {
  const metadata = validateMetadata(record.metadata);
  if (metadata.ok === false)
    return {
      ok: false,
      diagnostic: diagnostic(
        'ROLE_MISSING_TRUSTED_METADATA',
        record.metadata.identifier,
        metadata.detail
      ),
    };
  if (!record.metadata.latestSignature?.trim())
    return {
      ok: false,
      diagnostic: diagnostic(
        'ROLE_MISSING_TRUSTED_METADATA',
        record.metadata.identifier,
        'role operation requires a trusted latest transaction signature'
      ),
    };
  if (record.metadata.updated !== null)
    return {
      ok: false,
      diagnostic: diagnostic(
        'ROLE_RESOURCE_REPUBLISHED',
        record.metadata.identifier,
        'role operations are append-only and cannot reuse an updated resource'
      ),
    };
  if (record.metadata.identifier !== record.envelope.recordId)
    return {
      ok: false,
      diagnostic: diagnostic(
        'ROLE_IDENTIFIER_MISMATCH',
        record.metadata.identifier,
        'trusted identifier does not match the role operation record id'
      ),
    };
  const operation = record.envelope.body;
  if (
    record.metadata.publisherName.trim().toLowerCase() !==
    operation.actorName.trim().toLowerCase()
  )
    return {
      ok: false,
      diagnostic: diagnostic(
        'ROLE_FORGED_ACTOR',
        record.metadata.identifier,
        'embedded role actor does not match the QDN publisher'
      ),
    };
  const transaction = record.transaction;
  if (
    transaction.type !== 'ARBITRARY' ||
    transaction.method !== 'PUT' ||
    transaction.signature !== record.metadata.latestSignature ||
    transaction.timestamp !== record.metadata.created ||
    transaction.identifier !== record.metadata.identifier
  )
    return {
      ok: false,
      diagnostic: diagnostic(
        'ROLE_TRANSACTION_MISMATCH',
        record.metadata.identifier,
        'Core transaction evidence does not match the discovered role resource'
      ),
    };
  if (
    transaction.name.trim().toLowerCase() !==
    record.metadata.publisherName.trim().toLowerCase()
  )
    return {
      ok: false,
      diagnostic: diagnostic(
        'ROLE_UNTRUSTED_PUBLISHER',
        record.metadata.identifier,
        'Core transaction name does not match the discovered QDN publisher'
      ),
    };
  if (transaction.creatorAddress.trim() !== operation.actorAddress.trim())
    return {
      ok: false,
      diagnostic: diagnostic(
        'ROLE_PUBLISHER_WALLET_MISMATCH',
        record.metadata.identifier,
        'Core transaction creator does not match the claimed actor wallet'
      ),
    };
  const authorized = validateRoleMutationAgainstPriorState(
    operation,
    registry,
    checkpoint
  );
  if (authorized.ok === false)
    return {
      ok: false,
      diagnostic: diagnostic(
        authorized.code,
        record.metadata.identifier,
        authorized.detail
      ),
    };
  return authorized;
};

export const reduceRoleOperations = (input: {
  primarySysOpAddress: string;
  bootstrapRegistry: ForumRoleRegistry;
  bootstrapMetadata: QdbV2ResourceMetadata | null;
  records: RoleOperationRecord[];
  initialDiagnostics?: RoleDiagnostic[];
  status?: RoleVerificationStatus;
  detail?: string;
}): TrustedRoleAuthorizationState => {
  let registry = normalizeRoleRegistry({
    ...input.bootstrapRegistry,
    primarySysOpAddress: input.primarySysOpAddress,
  });
  let checkpoint = bootstrapCheckpoint(input.bootstrapMetadata);
  const diagnostics = [...(input.initialDiagnostics ?? [])];
  const audit: RoleAuditEntry[] = [];
  const timeline: RoleTimelineEntry[] = [
    {
      metadata: effectiveBootstrapMetadata(input.bootstrapMetadata),
      registry,
      checkpoint,
      operationId: null,
    },
  ];
  const groups = new Map<string, RoleOperationRecord[]>();
  input.records.forEach((record) => {
    const key = `${record.metadata.publisherName.trim().toLowerCase()}\u0000${record.metadata.identifier}`;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  });
  const candidates: RoleOperationRecord[] = [];
  [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([, group]) => {
      const distinct = new Map(
        group.map((record) => [
          canonicalize({
            metadata: record.metadata,
            envelope: record.envelope,
            transaction: record.transaction,
          }),
          record,
        ])
      );
      if (distinct.size > 1) {
        const first = [...group].sort((left, right) =>
          compareRoleOrder(left.metadata, right.metadata)
        )[0];
        diagnostics.push(
          diagnostic(
            'ROLE_OPERATION_CONFLICT',
            first.metadata.identifier,
            'conflicting records reuse one publisher/identifier resource key'
          )
        );
        return;
      }
      candidates.push([...distinct.values()][0]);
    });
  const bootstrapOrder = effectiveBootstrapMetadata(input.bootstrapMetadata);
  candidates
    .sort((left, right) => compareRoleOrder(left.metadata, right.metadata))
    .forEach((record) => {
      if (
        bootstrapOrder &&
        compareRoleOrder(record.metadata, bootstrapOrder) <= 0
      ) {
        diagnostics.push(
          diagnostic(
            'ROLE_OPERATION_PREDATES_BOOTSTRAP',
            record.metadata.identifier,
            'role operation is not later than the trusted bootstrap checkpoint'
          )
        );
        return;
      }
      const valid = validateRecord(record, registry, checkpoint);
      if (valid.ok === false) {
        diagnostics.push(valid.diagnostic);
        return;
      }
      const body = record.envelope.body;
      const resultingRole =
        body.action === 'assign' ? body.role : ('Member' as const);
      if (
        body.action === 'assign' ||
        (body.action === 'revoke' && valid.targetRole === body.role)
      )
        registry = normalizeRoleRegistry(
          replaceRole(registry, body.targetAddress, resultingRole)
        );
      checkpoint = {
        bootstrapIdentifier: checkpoint.bootstrapIdentifier,
        bootstrapSignature: checkpoint.bootstrapSignature,
        previousOperationId: record.envelope.recordId,
        previousOperationSignature: record.metadata.latestSignature ?? null,
      };
      registry = { ...registry, updatedAt: record.metadata.created };
      const auditEntry: RoleAuditEntry = {
        recordId: record.envelope.recordId,
        action: body.action,
        role: body.role,
        targetAddress: body.targetAddress,
        actorName: body.actorName,
        actorAddress: body.actorAddress,
        actorRole: valid.actorRole,
        priorRole: valid.targetRole,
        resultingRole: resolveRole(body.targetAddress, registry),
        trustedCreated: record.metadata.created,
        latestSignature: record.metadata.latestSignature ?? '',
        blockHeight: record.transaction.blockHeight ?? null,
        blockSequence: record.transaction.blockSequence ?? null,
        reason: body.reason?.trim() || null,
        checkpoint,
      };
      audit.push(auditEntry);
      timeline.push({
        metadata: record.metadata,
        registry,
        checkpoint,
        operationId: record.envelope.recordId,
      });
    });
  return {
    status: input.status ?? 'VERIFIED',
    model: 'v2-role-operation-history',
    registry,
    metadata: input.bootstrapMetadata,
    checkpoint,
    timeline,
    audit,
    diagnostics,
    detail: input.detail ?? 'trusted legacy bootstrap plus V2 role operations',
  };
};

export const resolveRoleAt = (
  state: TrustedRoleAuthorizationState,
  metadata: QdbV2ResourceMetadata
):
  | {
      ok: true;
      registry: ForumRoleRegistry;
      checkpoint: RoleLineage;
    }
  | { ok: false; code: RoleDiagnosticCode; detail: string } => {
  if (state.status !== 'VERIFIED')
    return {
      ok: false,
      code: 'ROLE_BOOTSTRAP_TRUST_FAILURE',
      detail: state.detail,
    };
  let selected: RoleTimelineEntry | null = null;
  for (const entry of state.timeline) {
    if (!entry.metadata || compareRoleOrder(entry.metadata, metadata) < 0)
      selected = entry;
  }
  if (!selected)
    return {
      ok: false,
      code: 'ROLE_OPERATION_PREDATES_BOOTSTRAP',
      detail: 'operation predates the trusted role bootstrap',
    };
  return {
    ok: true,
    registry: selected.registry,
    checkpoint: selected.checkpoint,
  };
};
