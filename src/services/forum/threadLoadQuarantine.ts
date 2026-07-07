const THREAD_QUARANTINE_TTL_MS = 15 * 60 * 1000;
const THREAD_QUARANTINE_STORAGE_KEY = 'forum-broken-thread-quarantine';

let cache: Map<string, number> | null = null;

const canUseStorage = () =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const pruneExpired = (map: Map<string, number>) => {
  const now = Date.now();
  for (const [subTopicId, expiresAt] of map.entries()) {
    if (expiresAt <= now) {
      map.delete(subTopicId);
    }
  }
};

const persist = (map: Map<string, number>) => {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(
      THREAD_QUARANTINE_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(map))
    );
  } catch {
    // Ignore storage failures.
  }
};

const getCache = () => {
  if (cache) {
    pruneExpired(cache);
    return cache;
  }

  const next = new Map<string, number>();

  if (canUseStorage()) {
    try {
      const raw = window.localStorage.getItem(THREAD_QUARANTINE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        Object.entries(parsed).forEach(([subTopicId, expiresAt]) => {
          if (typeof expiresAt === 'number' && Number.isFinite(expiresAt)) {
            next.set(subTopicId, expiresAt);
          }
        });
      }
    } catch {
      // Ignore storage failures.
    }
  }

  pruneExpired(next);
  persist(next);
  cache = next;
  return next;
};

const normalizeSubTopicId = (value: string) => value.trim();

export const isThreadQuarantined = (subTopicId: string) => {
  const normalizedId = normalizeSubTopicId(subTopicId);
  if (!normalizedId) {
    return false;
  }

  return getCache().has(normalizedId);
};

export const quarantineThread = (
  subTopicId: string,
  ttlMs = THREAD_QUARANTINE_TTL_MS
) => {
  const normalizedId = normalizeSubTopicId(subTopicId);
  if (!normalizedId) {
    return;
  }

  const next = getCache();
  next.set(normalizedId, Date.now() + ttlMs);
  persist(next);
};

export const clearThreadQuarantine = (subTopicId: string) => {
  const normalizedId = normalizeSubTopicId(subTopicId);
  if (!normalizedId) {
    return;
  }

  const next = getCache();
  if (next.delete(normalizedId)) {
    persist(next);
  }
};
