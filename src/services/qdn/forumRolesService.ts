import type { ForumRoleRegistry, UserRole } from '../../types/index.js';
import { fetchWithQdnReadyFallback } from './qdnReadiness.js';
import { requestQortium } from '../qortium/qortiumClient.js';
import {
  discoverQdnResources,
  type DiscoveredQdnResource,
} from './qdnPagination.js';
import { getAccountNames, getUserAccount } from '../qortium/walletService.js';
import { resolveNameWalletAddress } from '../qortium/walletService.js';
import { perfDebugTimeStart } from '../perf/perfDebug.js';
import type { QdbV2ResourceMetadata } from '../architectureV2/types.js';
import { generateForumEntityId } from '../forum/forumId.js';
import {
  buildRoleOperationEnvelope,
  isRoleOperationEnvelope,
  reduceRoleOperations,
  validateRoleMutationAgainstPriorState,
  type DelegableRole,
  type RoleDiagnostic,
  type RoleOperationAction,
  type RoleOperationEnvelope,
  type RoleOperationRecord,
  type RoleTransactionEvidence,
  type TrustedRoleAuthorizationState,
} from '../architectureV2/roles.js';

const FORUM_SERVICE = import.meta.env?.VITE_QORTIUM_QDN_SERVICE ?? 'DOCUMENT';
const FORUM_NAMESPACE =
  import.meta.env?.VITE_QORTIUM_QDN_IDENTIFIER?.trim() || 'qdbm';

export const PRIMARY_SYSOP_ADDRESS = 'QN1XYwwmTzXemusDb9p7T1nKJEACLHGgaL';

const ROLE_IDENTIFIER_PREFIX = `${FORUM_NAMESPACE}-roles-`;
const PRIMARY_ROLE_IDENTIFIER = `${ROLE_IDENTIFIER_PREFIX}default`;
const ROLE_OPERATION_PREFIX = `${FORUM_NAMESPACE}-v2-role-`;
const VERIFY_RETRIES = 5;
const VERIFY_DELAY_MS = 1500;
const ROLE_REGISTRY_CACHE_TTL_MS = 60 * 1000;
const ROLE_OPERATION_DISCOVERY_BUDGET = 10_000;
const MAX_SAFE_QDN_IDENTIFIER_LENGTH = 64;

type SearchQdnResourceResult = DiscoveredQdnResource;

type CoreArbitraryTransaction = {
  type?: unknown;
  method?: unknown;
  signature?: unknown;
  creatorAddress?: unknown;
  timestamp?: unknown;
  name?: unknown;
  identifier?: unknown;
  blockHeight?: unknown;
  blockSequence?: unknown;
};

export type RoleOperationPublishResult =
  | {
      ok: true;
      envelope: RoleOperationEnvelope;
      state: TrustedRoleAuthorizationState;
    }
  | {
      ok: true;
      envelope: RoleOperationEnvelope;
      partial: { pending: 'role-state-refresh'; retryable: true };
      detail: string;
    }
  | {
      ok: false;
      published: boolean;
      code: string;
      detail: string;
    };

type RoleRegistryPayload = {
  version: 1;
  type: 'role-registry';
  updatedAt: number;
  registry: {
    primarySysOpAddress?: string;
    superAdminAddress?: string;
    sysOps?: string[];
    admins: string[];
    moderators: string[];
  };
};

let trustedRoleStateCache: {
  value: TrustedRoleAuthorizationState | null;
  updatedAt: number;
  inflight: Promise<TrustedRoleAuthorizationState> | null;
} = { value: null, updatedAt: 0, inflight: null };

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const sleep = async (durationMs: number) => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
};

const encodeBase64Json = (value: unknown): string => {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
};

const decodeBase64Json = (value: string): unknown => {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const decoded = new TextDecoder().decode(bytes);
  return JSON.parse(decoded) as unknown;
};

const parseJsonLike = (raw: unknown): unknown => {
  if (typeof raw !== 'string') {
    return raw;
  }

  const trimmed = raw.trim();

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return decodeBase64Json(trimmed);
  }
};

const normalizeAddressList = (input: unknown) => {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set<string>();
  const next: string[] = [];

  input.forEach((value) => {
    if (typeof value !== 'string') {
      return;
    }

    const normalized = value.trim();
    if (
      !normalized ||
      normalized === PRIMARY_SYSOP_ADDRESS ||
      seen.has(normalized)
    ) {
      return;
    }

    seen.add(normalized);
    next.push(normalized);
  });

  return next;
};

export const createDefaultRoleRegistry = (): ForumRoleRegistry => ({
  primarySysOpAddress: PRIMARY_SYSOP_ADDRESS,
  sysOps: [],
  admins: [],
  moderators: [],
  updatedAt: null,
});

const parseRoleRegistryPayload = (raw: unknown): RoleRegistryPayload | null => {
  if (
    !isObject(raw) ||
    raw.type !== 'role-registry' ||
    !isObject(raw.registry)
  ) {
    return null;
  }

  return {
    version: 1,
    type: 'role-registry',
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    registry: {
      primarySysOpAddress:
        typeof raw.registry.primarySysOpAddress === 'string' &&
        raw.registry.primarySysOpAddress.trim()
          ? raw.registry.primarySysOpAddress.trim()
          : typeof raw.registry.superAdminAddress === 'string' &&
              raw.registry.superAdminAddress.trim()
            ? raw.registry.superAdminAddress.trim()
            : PRIMARY_SYSOP_ADDRESS,
      sysOps: normalizeAddressList(raw.registry.sysOps),
      admins: normalizeAddressList(raw.registry.admins),
      moderators: normalizeAddressList(raw.registry.moderators),
    },
  };
};

const toForumRoleRegistry = (payload: RoleRegistryPayload) => {
  // The canonical trust root is application configuration, never a mutable
  // payload field—even when the payload itself was published by that root.
  const primarySysOpAddress = PRIMARY_SYSOP_ADDRESS;
  const sysOps = payload.registry.sysOps ?? [];

  return {
    primarySysOpAddress,
    sysOps: sysOps.filter((address) => address !== primarySysOpAddress),
    admins: payload.registry.admins.filter(
      (address) =>
        !payload.registry.moderators.includes(address) &&
        !sysOps.includes(address)
    ),
    moderators: payload.registry.moderators.filter(
      (address) =>
        !payload.registry.admins.includes(address) && !sysOps.includes(address)
    ),
    updatedAt: payload.updatedAt,
  };
};

const searchCanonicalRoleResources = async () => {
  const discovery = await discoverQdnResources(
    {
      service: FORUM_SERVICE,
      identifier: PRIMARY_ROLE_IDENTIFIER,
      prefix: true,
      mode: 'ALL',
      reverse: true,
    },
    { maxResources: ROLE_OPERATION_DISCOVERY_BUDGET }
  );
  return {
    resources: discovery.items.filter(
      (resource) => resource.identifier === PRIMARY_ROLE_IDENTIFIER
    ),
    complete: discovery.completeness === 'complete',
    discovery,
  };
};

const searchRoleOperationResources = async () => {
  const discovery = await discoverQdnResources(
    {
      service: FORUM_SERVICE,
      identifier: ROLE_OPERATION_PREFIX,
      prefix: true,
      mode: 'ALL',
      reverse: false,
    },
    { maxResources: ROLE_OPERATION_DISCOVERY_BUDGET }
  );
  return {
    resources: discovery.items,
    complete: discovery.completeness === 'complete',
    discovery,
  };
};

const toTrustedMetadata = (
  resource: SearchQdnResourceResult
): QdbV2ResourceMetadata | null => {
  if (
    typeof resource.service !== 'string' ||
    typeof resource.created !== 'number' ||
    !Number.isSafeInteger(resource.created) ||
    typeof resource.latestSignature !== 'string' ||
    !resource.latestSignature.trim() ||
    (resource.updated !== undefined &&
      resource.updated !== null &&
      (typeof resource.updated !== 'number' ||
        !Number.isSafeInteger(resource.updated)))
  )
    return null;
  return {
    service: resource.service,
    publisherName: resource.name,
    identifier: resource.identifier,
    created: resource.created,
    updated: resource.updated ?? null,
    latestSignature: resource.latestSignature,
  };
};

const compareTrustedRoleResources = (
  left: { metadata: QdbV2ResourceMetadata },
  right: { metadata: QdbV2ResourceMetadata }
) => {
  const leftTime = left.metadata.updated ?? left.metadata.created;
  const rightTime = right.metadata.updated ?? right.metadata.created;
  if (leftTime !== rightTime) return rightTime - leftTime;
  const signature = (right.metadata.latestSignature ?? '').localeCompare(
    left.metadata.latestSignature ?? ''
  );
  if (signature) return signature;
  const name = right.metadata.publisherName.localeCompare(
    left.metadata.publisherName
  );
  return (
    name || right.metadata.identifier.localeCompare(left.metadata.identifier)
  );
};

const fetchResource = async (
  name: string,
  identifier: string
): Promise<unknown> => {
  const fetcher = () =>
    requestQortium<unknown>({
      action: 'FETCH_QDN_RESOURCE',
      service: FORUM_SERVICE,
      name,
      identifier,
    });

  const raw = await fetchWithQdnReadyFallback(
    FORUM_SERVICE,
    name,
    identifier,
    fetcher
  );
  return parseJsonLike(raw);
};

const parseCoreRoleTransaction = (
  raw: unknown
): RoleTransactionEvidence | null => {
  if (!isObject(raw)) return null;
  const transaction = raw as CoreArbitraryTransaction;
  if (
    transaction.type !== 'ARBITRARY' ||
    transaction.method !== 'PUT' ||
    typeof transaction.signature !== 'string' ||
    !transaction.signature.trim() ||
    typeof transaction.creatorAddress !== 'string' ||
    !transaction.creatorAddress.trim() ||
    typeof transaction.timestamp !== 'number' ||
    !Number.isSafeInteger(transaction.timestamp) ||
    typeof transaction.name !== 'string' ||
    !transaction.name.trim() ||
    typeof transaction.identifier !== 'string' ||
    !transaction.identifier.trim() ||
    (transaction.blockHeight !== undefined &&
      transaction.blockHeight !== null &&
      (typeof transaction.blockHeight !== 'number' ||
        !Number.isSafeInteger(transaction.blockHeight))) ||
    (transaction.blockSequence !== undefined &&
      transaction.blockSequence !== null &&
      (typeof transaction.blockSequence !== 'number' ||
        !Number.isSafeInteger(transaction.blockSequence)))
  )
    return null;
  return {
    type: 'ARBITRARY',
    method: 'PUT',
    signature: transaction.signature,
    creatorAddress: transaction.creatorAddress,
    timestamp: transaction.timestamp,
    name: transaction.name,
    identifier: transaction.identifier,
    blockHeight:
      typeof transaction.blockHeight === 'number'
        ? transaction.blockHeight
        : null,
    blockSequence:
      typeof transaction.blockSequence === 'number'
        ? transaction.blockSequence
        : null,
  };
};

const fetchRoleTransaction = async (signature: string) =>
  parseCoreRoleTransaction(
    await requestQortium<unknown>({
      action: 'FETCH_NODE_API',
      path: `/transactions/signature/${encodeURIComponent(signature)}`,
    })
  );

const assertIdentifierLength = (identifier: string) => {
  if (identifier.length > MAX_SAFE_QDN_IDENTIFIER_LENGTH)
    throw new Error(
      `Role operation identifier exceeds ${MAX_SAFE_QDN_IDENTIFIER_LENGTH} characters.`
    );
};

const verifyPublication = async (ownerName: string, identifier: string) => {
  for (let attempt = 1; attempt <= VERIFY_RETRIES; attempt += 1) {
    try {
      const raw = await requestQortium<unknown>({
        action: 'FETCH_QDN_RESOURCE',
        service: FORUM_SERVICE,
        name: ownerName,
        identifier,
      });

      const parsed = parseRoleRegistryPayload(parseJsonLike(raw));
      if (parsed) {
        return;
      }
    } catch {
      // Keep retrying.
    }

    if (attempt < VERIFY_RETRIES) {
      await sleep(VERIFY_DELAY_MS);
    }
  }

  throw new Error('Role registry was submitted but could not be verified yet.');
};

const verifyRoleOperationPublication = async (
  ownerName: string,
  identifier: string
) => {
  for (let attempt = 1; attempt <= VERIFY_RETRIES; attempt += 1) {
    try {
      const raw = await requestQortium<unknown>({
        action: 'FETCH_QDN_RESOURCE',
        service: FORUM_SERVICE,
        name: ownerName,
        identifier,
      });
      if (isRoleOperationEnvelope(parseJsonLike(raw))) return;
    } catch {
      // The immutable operation may still be propagating through QDN.
    }
    if (attempt < VERIFY_RETRIES) await sleep(VERIFY_DELAY_MS);
  }
  throw new Error(
    'Role operation was submitted but its QDN payload is not readable yet.'
  );
};

const resolveOwnerName = async (providedName?: string): Promise<string> => {
  if (providedName?.trim()) {
    return providedName.trim();
  }

  const account = await getUserAccount();

  if (account.name?.trim()) {
    return account.name.trim();
  }

  throw new Error('Authenticated account has no Qortium name.');
};

export const resolveRoleForAddress = (
  address: string | null | undefined,
  registry: ForumRoleRegistry
): UserRole => {
  if (!address?.trim()) {
    return 'Member';
  }

  const normalized = address.trim();

  if (normalized === registry.primarySysOpAddress) {
    return 'SysOp';
  }

  if (registry.sysOps.includes(normalized)) {
    return 'SuperAdmin';
  }

  if (registry.admins.includes(normalized)) {
    return 'Admin';
  }

  if (registry.moderators.includes(normalized)) {
    return 'Moderator';
  }

  return 'Member';
};

type TrustedBootstrap = {
  status: 'VERIFIED' | 'UNAVAILABLE';
  registry: ForumRoleRegistry;
  metadata: QdbV2ResourceMetadata | null;
  diagnostics: RoleDiagnostic[];
  detail: string;
};

const loadTrustedBootstrap = async (): Promise<TrustedBootstrap> => {
  let trustedNames: string[];
  try {
    trustedNames = await getAccountNames(PRIMARY_SYSOP_ADDRESS);
  } catch {
    return {
      status: 'UNAVAILABLE',
      registry: createDefaultRoleRegistry(),
      metadata: null,
      diagnostics: [
        {
          code: 'ROLE_BOOTSTRAP_TRUST_FAILURE',
          identifier: PRIMARY_ROLE_IDENTIFIER,
          detail: 'current primary SysOp QDN-name ownership is unavailable',
        },
      ],
      detail: 'current primary SysOp QDN-name ownership is unavailable',
    };
  }
  let discovery: Awaited<ReturnType<typeof searchCanonicalRoleResources>>;
  try {
    discovery = await searchCanonicalRoleResources();
  } catch {
    return {
      status: 'UNAVAILABLE',
      registry: createDefaultRoleRegistry(),
      metadata: null,
      diagnostics: [
        {
          code: 'ROLE_BOOTSTRAP_TRUST_FAILURE',
          identifier: PRIMARY_ROLE_IDENTIFIER,
          detail: 'canonical role-registry discovery is unavailable',
        },
      ],
      detail: 'canonical role-registry discovery is unavailable',
    };
  }
  if (!discovery.complete)
    return {
      status: 'UNAVAILABLE',
      registry: createDefaultRoleRegistry(),
      metadata: null,
      diagnostics: [
        {
          code: 'ROLE_DISCOVERY_INCOMPLETE',
          identifier: PRIMARY_ROLE_IDENTIFIER,
          detail: `canonical bootstrap discovery exceeded the ${ROLE_OPERATION_DISCOVERY_BUDGET}-resource safety budget`,
        },
      ],
      detail: 'canonical role-bootstrap discovery is incomplete',
    };
  const resources = discovery.resources;
  const trustedNameSet = new Set(
    trustedNames.map((name) => name.trim().toLowerCase())
  );
  const trustedResources = resources.filter((resource) =>
    trustedNameSet.has(resource.name.trim().toLowerCase())
  );
  const delegatedDiagnostics: RoleDiagnostic[] = resources
    .filter(
      (resource) => !trustedNameSet.has(resource.name.trim().toLowerCase())
    )
    .map((resource) => ({
      code: 'ROLE_LEGACY_DELEGATED_SNAPSHOT_IGNORED',
      identifier: resource.identifier,
      detail: `legacy registry under untrusted publisher ${resource.name} is historical evidence only`,
    }));
  if (trustedResources.length === 0)
    return {
      status: 'VERIFIED',
      registry: createDefaultRoleRegistry(),
      metadata: null,
      diagnostics: delegatedDiagnostics,
      detail:
        'no primary-owned legacy registry exists; the fixed primary SysOp is the bootstrap state',
    };
  const ordered = trustedResources
    .map((resource) => ({
      resource,
      metadata: toTrustedMetadata(resource),
    }))
    .filter(
      (
        candidate
      ): candidate is {
        resource: SearchQdnResourceResult;
        metadata: QdbV2ResourceMetadata;
      } => candidate.metadata !== null
    )
    .sort(compareTrustedRoleResources);
  if (ordered.length !== trustedResources.length)
    return {
      status: 'UNAVAILABLE',
      registry: createDefaultRoleRegistry(),
      metadata: null,
      diagnostics: [
        ...delegatedDiagnostics,
        {
          code: 'ROLE_BOOTSTRAP_TRUST_FAILURE',
          identifier: PRIMARY_ROLE_IDENTIFIER,
          detail:
            'a primary-owned canonical registry lacks trusted Core metadata',
        },
      ],
      detail: 'canonical role bootstrap metadata is incomplete',
    };
  const selected = ordered[0];
  let bootstrapTransaction: RoleTransactionEvidence | null;
  try {
    bootstrapTransaction = await fetchRoleTransaction(
      selected.metadata.latestSignature ?? ''
    );
  } catch {
    bootstrapTransaction = null;
  }
  const bootstrapTimestamp =
    selected.metadata.updated ?? selected.metadata.created;
  if (
    !bootstrapTransaction ||
    bootstrapTransaction.signature !== selected.metadata.latestSignature ||
    bootstrapTransaction.creatorAddress.trim() !== PRIMARY_SYSOP_ADDRESS ||
    bootstrapTransaction.timestamp !== bootstrapTimestamp ||
    bootstrapTransaction.name.trim().toLowerCase() !==
      selected.metadata.publisherName.trim().toLowerCase() ||
    bootstrapTransaction.identifier !== selected.metadata.identifier
  )
    return {
      status: 'UNAVAILABLE',
      registry: createDefaultRoleRegistry(),
      metadata: null,
      diagnostics: [
        ...delegatedDiagnostics,
        {
          code: 'ROLE_BOOTSTRAP_TRUST_FAILURE',
          identifier: selected.resource.identifier,
          detail:
            'latest canonical registry revision is not transaction-bound to the fixed primary SysOp',
        },
      ],
      detail:
        'canonical role bootstrap lacks immutable primary-SysOp transaction proof',
    };
  try {
    const payload = parseRoleRegistryPayload(
      await fetchResource(selected.resource.name, selected.resource.identifier)
    );
    if (!payload)
      return {
        status: 'UNAVAILABLE',
        registry: createDefaultRoleRegistry(),
        metadata: null,
        diagnostics: [
          ...delegatedDiagnostics,
          {
            code: 'ROLE_BOOTSTRAP_TRUST_FAILURE',
            identifier: selected.resource.identifier,
            detail: 'latest primary-owned role registry is malformed',
          },
        ],
        detail: 'latest primary-owned role registry is malformed',
      };
    return {
      status: 'VERIFIED',
      registry: toForumRoleRegistry(payload),
      metadata: selected.metadata,
      diagnostics: delegatedDiagnostics,
      detail: 'primary-owned legacy registry verified as V2 bootstrap',
    };
  } catch {
    return {
      status: 'UNAVAILABLE',
      registry: createDefaultRoleRegistry(),
      metadata: null,
      diagnostics: [
        ...delegatedDiagnostics,
        {
          code: 'ROLE_BOOTSTRAP_TRUST_FAILURE',
          identifier: selected.resource.identifier,
          detail: 'latest primary-owned role-registry payload is unavailable',
        },
      ],
      detail: 'latest primary-owned role-registry payload is unavailable',
    };
  }
};

const loadRoleOperationRecords = async () => {
  const diagnostics: RoleDiagnostic[] = [];
  const records: RoleOperationRecord[] = [];
  let unavailable = false;
  let discovery: Awaited<ReturnType<typeof searchRoleOperationResources>>;
  try {
    discovery = await searchRoleOperationResources();
  } catch {
    return {
      records,
      diagnostics: [
        {
          code: 'ROLE_RESOURCE_UNAVAILABLE' as const,
          identifier: ROLE_OPERATION_PREFIX,
          detail: 'role-operation discovery is unavailable',
        },
      ],
      unavailable: true,
    };
  }
  if (!discovery.complete) {
    diagnostics.push({
      code: 'ROLE_DISCOVERY_INCOMPLETE',
      identifier: ROLE_OPERATION_PREFIX,
      detail: `role-operation discovery exceeded the ${ROLE_OPERATION_DISCOVERY_BUDGET}-resource safety budget`,
    });
    unavailable = true;
  }
  for (const resource of discovery.resources) {
    const metadata = toTrustedMetadata(resource);
    if (!metadata) {
      diagnostics.push({
        code: 'ROLE_MISSING_TRUSTED_METADATA',
        identifier: resource.identifier,
        detail: 'role operation lacks trusted Core ordering/signature metadata',
      });
      unavailable = true;
      continue;
    }
    let payload: unknown;
    try {
      payload = await fetchResource(resource.name, resource.identifier);
    } catch {
      diagnostics.push({
        code: 'ROLE_RESOURCE_UNAVAILABLE',
        identifier: resource.identifier,
        detail: 'role-operation payload is unavailable',
      });
      unavailable = true;
      continue;
    }
    if (!isRoleOperationEnvelope(payload)) {
      diagnostics.push({
        code: 'MALFORMED_ROLE_OPERATION',
        identifier: resource.identifier,
        detail: 'role-operation payload failed strict schema validation',
      });
      continue;
    }
    let transaction: RoleTransactionEvidence | null;
    try {
      transaction = await fetchRoleTransaction(metadata.latestSignature ?? '');
    } catch {
      transaction = null;
    }
    if (!transaction) {
      diagnostics.push({
        code: 'ROLE_TRANSACTION_UNAVAILABLE',
        identifier: resource.identifier,
        detail:
          'immutable role-operation transaction identity evidence is unavailable',
      });
      unavailable = true;
      continue;
    }
    records.push({ metadata, envelope: payload, transaction });
  }
  return { records, diagnostics, unavailable };
};

export const forumRolesService = {
  async loadTrustedRoleAuthorizationState(options?: {
    force?: boolean;
  }): Promise<TrustedRoleAuthorizationState> {
    const now = Date.now();
    if (
      !options?.force &&
      trustedRoleStateCache.value &&
      now - trustedRoleStateCache.updatedAt <= ROLE_REGISTRY_CACHE_TTL_MS
    )
      return trustedRoleStateCache.value;
    if (!options?.force && trustedRoleStateCache.inflight)
      return trustedRoleStateCache.inflight;

    const load = (async (): Promise<TrustedRoleAuthorizationState> => {
      const bootstrap = await loadTrustedBootstrap();
      if (bootstrap.status !== 'VERIFIED')
        return reduceRoleOperations({
          primarySysOpAddress: PRIMARY_SYSOP_ADDRESS,
          bootstrapRegistry: bootstrap.registry,
          bootstrapMetadata: bootstrap.metadata,
          records: [],
          initialDiagnostics: bootstrap.diagnostics,
          status: 'UNAVAILABLE',
          detail: bootstrap.detail,
        });
      const operations = await loadRoleOperationRecords();
      return reduceRoleOperations({
        primarySysOpAddress: PRIMARY_SYSOP_ADDRESS,
        bootstrapRegistry: bootstrap.registry,
        bootstrapMetadata: bootstrap.metadata,
        records: operations.records,
        initialDiagnostics: [
          ...bootstrap.diagnostics,
          ...operations.diagnostics,
        ],
        status: operations.unavailable ? 'UNAVAILABLE' : 'VERIFIED',
        detail: operations.unavailable
          ? 'role history is incomplete; mutations fail closed'
          : 'primary-owned legacy bootstrap plus verified V2 role-operation history',
      });
    })();
    trustedRoleStateCache = {
      ...trustedRoleStateCache,
      inflight: load,
    };
    return load
      .then((value) => {
        trustedRoleStateCache = {
          value,
          updatedAt: Date.now(),
          inflight: null,
        };
        return value;
      })
      .catch((error) => {
        trustedRoleStateCache = { ...trustedRoleStateCache, inflight: null };
        throw error;
      });
  },

  async loadRoleRegistry(): Promise<ForumRoleRegistry> {
    const endTiming = perfDebugTimeStart('role-registry-load');
    const state = await this.loadTrustedRoleAuthorizationState();
    endTiming({
      status: state.status,
      operationCount: state.audit.length,
      sysOpCount: state.registry.sysOps.length,
      adminCount: state.registry.admins.length,
      moderatorCount: state.registry.moderators.length,
    });
    return state.registry;
  },

  async publishRoleRegistry(registry: ForumRoleRegistry, ownerName?: string) {
    const resolvedOwner = await resolveOwnerName(ownerName);
    const resolvedWallet = await resolveNameWalletAddress(resolvedOwner);
    if (resolvedWallet?.trim() !== PRIMARY_SYSOP_ADDRESS)
      throw new Error(
        '[ROLE_UNTRUSTED_PUBLISHER] only a QDN name currently owned by the fixed primary SysOp may publish the legacy bootstrap registry'
      );
    const updatedAt = Date.now();
    const sanitizedRegistry: ForumRoleRegistry = {
      primarySysOpAddress: PRIMARY_SYSOP_ADDRESS,
      sysOps: normalizeAddressList(registry.sysOps),
      admins: normalizeAddressList(registry.admins).filter(
        (address) => !normalizeAddressList(registry.sysOps).includes(address)
      ),
      moderators: normalizeAddressList(registry.moderators).filter(
        (address) =>
          !normalizeAddressList(registry.admins).includes(address) &&
          !normalizeAddressList(registry.sysOps).includes(address)
      ),
      updatedAt,
    };

    const payload: RoleRegistryPayload = {
      version: 1,
      type: 'role-registry',
      updatedAt,
      registry: {
        primarySysOpAddress: sanitizedRegistry.primarySysOpAddress,
        superAdminAddress: sanitizedRegistry.primarySysOpAddress,
        sysOps: sanitizedRegistry.sysOps,
        admins: sanitizedRegistry.admins,
        moderators: sanitizedRegistry.moderators,
      },
    };

    await requestQortium<unknown>({
      action: 'PUBLISH_QDN_RESOURCE',
      service: FORUM_SERVICE,
      name: resolvedOwner,
      identifier: PRIMARY_ROLE_IDENTIFIER,
      title: 'Forum role registry',
      description: 'Qortium discussion board role registry',
      tags: ['forum', 'roles', 'qforum'],
      data64: encodeBase64Json(payload),
    });

    await verifyPublication(resolvedOwner, PRIMARY_ROLE_IDENTIFIER);

    // A new primary-owned bootstrap invalidates every cached reduced state.
    trustedRoleStateCache = { value: null, updatedAt: 0, inflight: null };

    return sanitizedRegistry;
  },

  async publishRoleOperation(input: {
    action: RoleOperationAction;
    role: DelegableRole;
    targetAddress: string;
    actorName: string;
    actorAddress: string;
    reason?: string;
  }): Promise<RoleOperationPublishResult> {
    const actorName = input.actorName.trim();
    const actorAddress = input.actorAddress.trim();
    const targetAddress = input.targetAddress.trim();
    if (!actorName || !actorAddress || !targetAddress)
      return {
        ok: false,
        published: false,
        code: 'MALFORMED_ROLE_OPERATION',
        detail: 'actor name, actor wallet, and target wallet are required',
      };
    let resolvedWallet: string | null = null;
    try {
      resolvedWallet = await resolveNameWalletAddress(actorName);
    } catch {
      resolvedWallet = null;
    }
    if (!resolvedWallet?.trim())
      return {
        ok: false,
        published: false,
        code: 'ROLE_NAME_WALLET_UNAVAILABLE',
        detail: 'current actor QDN name-to-wallet binding is unavailable',
      };
    if (resolvedWallet.trim() !== actorAddress)
      return {
        ok: false,
        published: false,
        code: 'ROLE_PUBLISHER_WALLET_MISMATCH',
        detail: 'current actor QDN name does not belong to the claimed wallet',
      };
    const current = await this.loadTrustedRoleAuthorizationState({
      force: true,
    });
    if (current.status !== 'VERIFIED')
      return {
        ok: false,
        published: false,
        code: 'ROLE_BOOTSTRAP_TRUST_FAILURE',
        detail: current.detail,
      };
    const operation = {
      operation: 'role-change' as const,
      action: input.action,
      targetAddress,
      role: input.role,
      actorName,
      actorAddress,
      prior: current.checkpoint,
      ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
    };
    const authorized = validateRoleMutationAgainstPriorState(
      operation,
      current.registry,
      current.checkpoint
    );
    if (authorized.ok === false)
      return {
        ok: false,
        published: false,
        code: authorized.code,
        detail: authorized.detail,
      };
    const recordId = `${ROLE_OPERATION_PREFIX}${generateForumEntityId(
      'role',
      actorName
    )}`;
    assertIdentifierLength(recordId);
    const envelope = buildRoleOperationEnvelope(operation, recordId);
    try {
      await requestQortium<unknown>({
        action: 'PUBLISH_QDN_RESOURCE',
        service: FORUM_SERVICE,
        name: actorName,
        identifier: recordId,
        title: `${input.action === 'assign' ? 'Assign' : 'Revoke'} ${input.role}`,
        description: 'Discussion Boards Architecture V2 role operation',
        tags: ['forum', 'qdb-v2', 'role-operation', input.action],
        data64: encodeBase64Json(envelope),
      });
    } catch (error) {
      return {
        ok: false,
        published: false,
        code: 'ROLE_PUBLICATION_FAILED',
        detail:
          error instanceof Error
            ? error.message
            : 'role-operation publication failed',
      };
    }
    trustedRoleStateCache = { value: null, updatedAt: 0, inflight: null };
    try {
      await verifyRoleOperationPublication(actorName, recordId);
    } catch (error) {
      return {
        ok: true,
        envelope,
        partial: { pending: 'role-state-refresh', retryable: true },
        detail:
          error instanceof Error
            ? error.message
            : 'role operation is published but confirmation is pending',
      };
    }
    let reloaded: TrustedRoleAuthorizationState;
    try {
      reloaded = await this.loadTrustedRoleAuthorizationState({ force: true });
    } catch (error) {
      return {
        ok: true,
        envelope,
        partial: { pending: 'role-state-refresh', retryable: true },
        detail:
          error instanceof Error
            ? error.message
            : 'role operation is published but reduced-state refresh failed',
      };
    }
    if (reloaded.audit.some((entry) => entry.recordId === recordId))
      return { ok: true, envelope, state: reloaded };
    const rejection = reloaded.diagnostics.find(
      (entry) => entry.identifier === recordId
    );
    if (rejection)
      return {
        ok: false,
        published: true,
        code: rejection.code,
        detail: rejection.detail,
      };
    return {
      ok: true,
      envelope,
      partial: { pending: 'role-state-refresh', retryable: true },
      detail:
        'role operation is published but has not appeared in complete trusted discovery yet',
    };
  },
};
