import { requestQortium } from '../qortium/qortiumClient';

const READY_STATUS = 'READY';
const BUILDABLE_STATUSES = new Set([
  'PUBLISHED',
  'DOWNLOADING',
  'DOWNLOADED',
  'BUILDING',
]);
const MISSING_STATUSES = new Set([
  'MISSING',
  'NOT_FOUND',
  'NOT PUBLISHED',
  'NOT_PUBLISHED',
  'DOES_NOT_EXIST',
]);
const STATUS_POLL_RETRIES = 8;
const STATUS_POLL_DELAY_MS = 1200;
const RESOURCE_FETCH_CONCURRENCY = 6;
const MISSING_RESOURCE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MISSING_RESOURCE_STORAGE_KEY = 'forum-missing-qdn-resources';

type QdnStatusResponse =
  | string
  | {
      status?: string;
      localChunkCount?: number;
      totalChunkCount?: number;
    };

let missingResourceCache: Map<string, number> | null = null;

const sleep = async (durationMs: number) => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
};

const canUseStorage = () =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const toResourceKey = (service: string, name: string, identifier: string) =>
  `${service}:${name}:${identifier}`;

const pruneMissingResourceCache = (cache: Map<string, number>) => {
  const now = Date.now();
  for (const [key, expiresAt] of cache.entries()) {
    if (expiresAt <= now) {
      cache.delete(key);
    }
  }
};

const persistMissingResourceCache = (cache: Map<string, number>) => {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(
      MISSING_RESOURCE_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(cache))
    );
  } catch {
    // Ignore storage failures.
  }
};

const getMissingResourceCache = () => {
  if (missingResourceCache) {
    pruneMissingResourceCache(missingResourceCache);
    return missingResourceCache;
  }

  const next = new Map<string, number>();

  if (canUseStorage()) {
    try {
      const raw = window.localStorage.getItem(MISSING_RESOURCE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        Object.entries(parsed).forEach(([key, expiresAt]) => {
          if (typeof expiresAt === 'number' && Number.isFinite(expiresAt)) {
            next.set(key, expiresAt);
          }
        });
      }
    } catch {
      // Ignore storage failures.
    }
  }

  pruneMissingResourceCache(next);
  persistMissingResourceCache(next);
  missingResourceCache = next;
  return next;
};

export const isMissingResourceError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.trim().toLowerCase();
  if (!message) {
    return false;
  }

  return (
    message.includes('404') ||
    message.includes('not found') ||
    message.includes('resource does not exist') ||
    message.includes('unknown resource')
  );
};

const isMissingResourceResponse = (value: unknown) => {
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return (
    normalized === 'resource does not exist' ||
    normalized.includes('404') ||
    normalized.includes('not found') ||
    normalized.includes('resource does not exist') ||
    normalized.includes('unknown resource')
  );
};

const quarantineMissingResource = (
  service: string,
  name: string,
  identifier: string
) => {
  const cache = getMissingResourceCache();
  cache.set(
    toResourceKey(service, name, identifier),
    Date.now() + MISSING_RESOURCE_TTL_MS
  );
  persistMissingResourceCache(cache);
};

const isResourceQuarantined = (
  service: string,
  name: string,
  identifier: string
) => getMissingResourceCache().has(toResourceKey(service, name, identifier));

const normalizeStatus = (value: QdnStatusResponse): string => {
  if (typeof value === 'string') {
    return value.toUpperCase();
  }

  if (typeof value?.status === 'string') {
    return value.status.toUpperCase();
  }

  return '';
};

const getQdnResourceStatus = async (
  service: string,
  name: string,
  identifier: string,
  build?: boolean
) => {
  return requestQortium<QdnStatusResponse>({
    action: 'GET_QDN_RESOURCE_STATUS',
    service,
    name,
    identifier,
    build,
  });
};

export const ensureQdnResourceReady = async (
  service: string,
  name: string,
  identifier: string
) => {
  if (isResourceQuarantined(service, name, identifier)) {
    throw new Error(
      `QDN resource is temporarily quarantined as missing: ${service}/${name}/${identifier}`
    );
  }

  let status = normalizeStatus(
    await getQdnResourceStatus(service, name, identifier, false)
  );

  if (status === READY_STATUS) {
    return;
  }

  if (MISSING_STATUSES.has(status)) {
    throw new Error(
      `QDN resource does not exist: ${service}/${name}/${identifier}`
    );
  }

  if (BUILDABLE_STATUSES.has(status)) {
    // Trigger build once when resource is known but not yet ready.
    await getQdnResourceStatus(service, name, identifier, true);
  }

  for (let attempt = 0; attempt < STATUS_POLL_RETRIES; attempt += 1) {
    status = normalizeStatus(
      await getQdnResourceStatus(service, name, identifier, false)
    );

    if (status === READY_STATUS) {
      return;
    }

    if (MISSING_STATUSES.has(status)) {
      throw new Error(
        `QDN resource does not exist: ${service}/${name}/${identifier}`
      );
    }

    if (attempt < STATUS_POLL_RETRIES - 1) {
      await sleep(STATUS_POLL_DELAY_MS);
    }
  }

  throw new Error(
    `QDN resource is not ready yet: ${service}/${name}/${identifier}`
  );
};

export const fetchWithQdnReadyFallback = async <T>(
  service: string,
  name: string,
  identifier: string,
  fetcher: () => Promise<T>
) => {
  if (isResourceQuarantined(service, name, identifier)) {
    throw new Error(
      `QDN resource is temporarily quarantined as missing: ${service}/${name}/${identifier}`
    );
  }

  try {
    const result = await fetcher();
    if (isMissingResourceResponse(result)) {
      throw new Error(String(result));
    }
    return result;
  } catch (initialError) {
    if (isMissingResourceError(initialError)) {
      try {
        await ensureQdnResourceReady(service, name, identifier);
        const result = await fetcher();
        if (isMissingResourceResponse(result)) {
          throw new Error(String(result));
        }
        return result;
      } catch (readinessError) {
        if (isMissingResourceError(readinessError)) {
          quarantineMissingResource(service, name, identifier);
        }
        throw initialError;
      }
    }

    try {
      await ensureQdnResourceReady(service, name, identifier);
    } catch {
      throw initialError;
    }

    return fetcher();
  }
};

export const mapWithConcurrency = async <TInput, TOutput>(
  items: TInput[],
  mapper: (item: TInput, index: number) => Promise<TOutput>,
  concurrency = RESOURCE_FETCH_CONCURRENCY
) => {
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
};
