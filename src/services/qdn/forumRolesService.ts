import type { ForumRoleRegistry, UserRole } from '../../types/index.js';
import { fetchWithQdnReadyFallback } from './qdnReadiness.js';
import { requestQortium } from '../qortium/qortiumClient.js';
import { getAccountNames, getUserAccount } from '../qortium/walletService.js';
import { perfDebugTimeStart } from '../perf/perfDebug.js';
import type { QdbV2ResourceMetadata } from '../architectureV2/types.js';
import type { TrustedRoleAuthorizationState } from '../architectureV2/moderation.js';

const FORUM_SERVICE = import.meta.env?.VITE_QORTIUM_QDN_SERVICE ?? 'DOCUMENT';
const FORUM_NAMESPACE =
  import.meta.env?.VITE_QORTIUM_QDN_IDENTIFIER?.trim() || 'qdbm';

export const PRIMARY_SYSOP_ADDRESS = 'QN1XYwwmTzXemusDb9p7T1nKJEACLHGgaL';

const ROLE_IDENTIFIER_PREFIX = `${FORUM_NAMESPACE}-roles-`;
const PRIMARY_ROLE_IDENTIFIER = `${ROLE_IDENTIFIER_PREFIX}default`;
const VERIFY_RETRIES = 5;
const VERIFY_DELAY_MS = 1500;
const ROLE_REGISTRY_CACHE_TTL_MS = 60 * 1000;

type SearchQdnResourceResult = {
  name: string;
  identifier: string;
  service?: string;
  created?: number;
  updated?: number | null;
  latestSignature?: string;
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

let roleRegistryCache: {
  value: ForumRoleRegistry | null;
  updatedAt: number;
  inflight: Promise<ForumRoleRegistry> | null;
} = {
  value: null,
  updatedAt: 0,
  inflight: null,
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

const searchByPrefix = async (
  prefix: string
): Promise<SearchQdnResourceResult[]> => {
  const search = await requestQortium<SearchQdnResourceResult[]>({
    action: 'SEARCH_QDN_RESOURCES',
    service: FORUM_SERVICE,
    identifier: prefix,
    prefix: true,
    mode: 'ALL',
    reverse: true,
    limit: 100,
    offset: 0,
  });

  return Array.isArray(search) ? search : [];
};

const searchCanonicalRoleResources = async () => {
  const search = await requestQortium<SearchQdnResourceResult[]>({
    action: 'SEARCH_QDN_RESOURCES',
    service: FORUM_SERVICE,
    identifier: PRIMARY_ROLE_IDENTIFIER,
    prefix: false,
    mode: 'ALL',
    reverse: true,
    includeStatus: true,
    limit: 100,
    offset: 0,
  });
  return Array.isArray(search) ? search : [];
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
      let trustedNames: string[];
      try {
        trustedNames = await getAccountNames(PRIMARY_SYSOP_ADDRESS);
      } catch {
        return {
          status: 'UNAVAILABLE',
          model: 'current-primary-registry-revalidation',
          registry: createDefaultRoleRegistry(),
          metadata: null,
          detail: 'current primary SysOp QDN-name ownership is unavailable',
        };
      }
      if (trustedNames.length === 0)
        return {
          status: 'UNAVAILABLE',
          model: 'current-primary-registry-revalidation',
          registry: createDefaultRoleRegistry(),
          metadata: null,
          detail: 'primary SysOp currently owns no verifiable QDN name',
        };
      let resources: SearchQdnResourceResult[];
      try {
        resources = await searchCanonicalRoleResources();
      } catch {
        return {
          status: 'UNAVAILABLE',
          model: 'current-primary-registry-revalidation',
          registry: createDefaultRoleRegistry(),
          metadata: null,
          detail: 'canonical role-registry discovery is unavailable',
        };
      }
      const trustedNameSet = new Set(
        trustedNames.map((name) => name.trim().toLowerCase())
      );
      const trustedResources = resources.filter((resource) =>
        trustedNameSet.has(resource.name.trim().toLowerCase())
      );
      if (trustedResources.length === 0) {
        if (resources.length > 0)
          return {
            status: 'UNVERIFIED',
            model: 'current-primary-registry-revalidation',
            registry: createDefaultRoleRegistry(),
            metadata: null,
            detail:
              'role registries exist only under publishers outside the primary SysOp trust root',
          };
        return {
          status: 'VERIFIED',
          model: 'current-primary-registry-revalidation',
          registry: createDefaultRoleRegistry(),
          metadata: null,
          detail:
            'no canonical registry is published; only the fixed primary SysOp role is authoritative',
        };
      }
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
          status: 'UNVERIFIED',
          model: 'current-primary-registry-revalidation',
          registry: createDefaultRoleRegistry(),
          metadata: null,
          detail:
            'a canonical role-registry candidate lacks trusted Core ordering metadata',
        };
      const selected = ordered[0];
      try {
        const payload = parseRoleRegistryPayload(
          await fetchResource(
            selected.resource.name,
            selected.resource.identifier
          )
        );
        if (!payload)
          return {
            status: 'UNVERIFIED',
            model: 'current-primary-registry-revalidation',
            registry: createDefaultRoleRegistry(),
            metadata: null,
            detail: 'latest canonical role-registry payload is malformed',
          };
        return {
          status: 'VERIFIED',
          model: 'current-primary-registry-revalidation',
          registry: toForumRoleRegistry(payload),
          metadata: selected.metadata,
          detail:
            'current role registry verified under a name owned by the primary SysOp address',
        };
      } catch {
        return {
          status: 'UNAVAILABLE',
          model: 'current-primary-registry-revalidation',
          registry: createDefaultRoleRegistry(),
          metadata: null,
          detail:
            'latest trusted canonical role-registry payload is unavailable',
        };
      }
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
    const now = Date.now();

    if (
      roleRegistryCache.value &&
      now - roleRegistryCache.updatedAt <= ROLE_REGISTRY_CACHE_TTL_MS
    ) {
      endTiming({ cacheHit: true });
      return roleRegistryCache.value;
    }

    if (roleRegistryCache.inflight) {
      endTiming({ reusedInflight: true });
      return roleRegistryCache.inflight;
    }

    const loadPromise = (async (): Promise<ForumRoleRegistry> => {
      let trustedNames: string[] = [];

      try {
        trustedNames = await getAccountNames(PRIMARY_SYSOP_ADDRESS);
      } catch {
        trustedNames = [];
      }

      if (trustedNames.length === 0) {
        return createDefaultRoleRegistry();
      }

      const trustedNameSet = new Set(
        trustedNames.map((name) => name.trim().toLowerCase())
      );
      const results = (await searchByPrefix(ROLE_IDENTIFIER_PREFIX)).filter(
        (item) => trustedNameSet.has(item.name.trim().toLowerCase())
      );

      for (const item of results) {
        try {
          const raw = await fetchResource(item.name, item.identifier);
          const payload = parseRoleRegistryPayload(raw);

          if (payload) {
            return toForumRoleRegistry(payload);
          }
        } catch {
          // Ignore malformed resources and continue.
        }
      }

      return createDefaultRoleRegistry();
    })()
      .then((result) => {
        roleRegistryCache = {
          value: result,
          updatedAt: Date.now(),
          inflight: null,
        };
        return result;
      })
      .catch((error) => {
        roleRegistryCache = {
          ...roleRegistryCache,
          inflight: null,
        };
        throw error;
      });

    roleRegistryCache = {
      ...roleRegistryCache,
      inflight: loadPromise,
    };

    return loadPromise.then((result) => {
      endTiming({
        cacheHit: false,
        sysOpCount: result.sysOps.length,
        adminCount: result.admins.length,
        moderatorCount: result.moderators.length,
      });
      return result;
    });
  },

  async publishRoleRegistry(registry: ForumRoleRegistry, ownerName?: string) {
    const resolvedOwner = await resolveOwnerName(ownerName);
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

    roleRegistryCache = {
      value: sanitizedRegistry,
      updatedAt,
      inflight: null,
    };

    // A delegated publication must never poison the trusted moderation-role
    // cache. Force the next moderation authorization to rediscover the
    // primary-owned canonical registry.
    trustedRoleStateCache = { value: null, updatedAt: 0, inflight: null };

    return sanitizedRegistry;
  },
};
