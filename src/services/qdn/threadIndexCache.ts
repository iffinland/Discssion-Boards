import type { ThreadSearchSnapshot } from './forumSearchIndexService';

const THREAD_INDEX_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const THREAD_INDEX_STORAGE_PREFIX = 'forum-thread-index:';
const THREAD_INDEX_STORAGE_LIST_KEY = 'forum-thread-index:list';
const THREAD_INDEX_STORAGE_LIMIT = 100;

type ThreadIndexCacheEntry = {
  snapshot: ThreadSearchSnapshot | null;
  cachedAt: number;
};

const cache = new Map<string, ThreadIndexCacheEntry>();
const inflight = new Map<string, Promise<ThreadSearchSnapshot | null>>();

const normalizeSubTopicId = (value: string) => value.trim();

const isFresh = (entry: ThreadIndexCacheEntry) => {
  return Date.now() - entry.cachedAt < THREAD_INDEX_CACHE_TTL_MS;
};

const canUseStorage = () =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const getStorageKey = (subTopicId: string) =>
  `${THREAD_INDEX_STORAGE_PREFIX}${subTopicId}`;

const readStorageList = (): string[] => {
  if (!canUseStorage()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(THREAD_INDEX_STORAGE_LIST_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
};

const writeStorageList = (subTopicId: string) => {
  if (!canUseStorage()) {
    return;
  }

  const previousList = readStorageList();
  const nextList = [
    subTopicId,
    ...previousList.filter((item) => item !== subTopicId),
  ].slice(0, THREAD_INDEX_STORAGE_LIMIT);

  try {
    window.localStorage.setItem(
      THREAD_INDEX_STORAGE_LIST_KEY,
      JSON.stringify(nextList)
    );

    previousList
      .filter((item) => !nextList.includes(item))
      .forEach((item) => {
        window.localStorage.removeItem(getStorageKey(item));
      });
  } catch {
    // Ignore storage failures.
  }
};

const readStorageEntry = (subTopicId: string): ThreadIndexCacheEntry | null => {
  if (!canUseStorage()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(getStorageKey(subTopicId));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<ThreadIndexCacheEntry>;
    if (typeof parsed.cachedAt !== 'number') {
      return null;
    }

    return {
      cachedAt: parsed.cachedAt,
      snapshot: parsed.snapshot ?? null,
    };
  } catch {
    return null;
  }
};

const writeStorageEntry = (
  subTopicId: string,
  entry: ThreadIndexCacheEntry
) => {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(
      getStorageKey(subTopicId),
      JSON.stringify(entry)
    );
    writeStorageList(subTopicId);
  } catch {
    // Ignore storage failures.
  }
};

export const readThreadIndexCache = (subTopicId: string) => {
  const normalizedId = normalizeSubTopicId(subTopicId);
  if (!normalizedId) {
    return null;
  }

  const entry = cache.get(normalizedId);
  if (entry && isFresh(entry)) {
    return entry.snapshot;
  }

  const storedEntry = readStorageEntry(normalizedId);
  if (!storedEntry || !isFresh(storedEntry)) {
    return null;
  }

  cache.set(normalizedId, storedEntry);
  return storedEntry.snapshot;
};

export const writeThreadIndexCache = (
  subTopicId: string,
  snapshot: ThreadSearchSnapshot | null
) => {
  const normalizedId = normalizeSubTopicId(subTopicId);
  if (!normalizedId) {
    return;
  }

  const entry = {
    snapshot,
    cachedAt: Date.now(),
  };
  cache.set(normalizedId, entry);
  writeStorageEntry(normalizedId, entry);
};

export const loadThreadIndexCached = async (
  subTopicId: string,
  loader: (subTopicId: string) => Promise<ThreadSearchSnapshot | null>
) => {
  const normalizedId = normalizeSubTopicId(subTopicId);
  if (!normalizedId) {
    return null;
  }

  const cachedEntry = cache.get(normalizedId);
  if (cachedEntry && isFresh(cachedEntry)) {
    return cachedEntry.snapshot;
  }

  const storedEntry = readStorageEntry(normalizedId);
  if (storedEntry && isFresh(storedEntry)) {
    cache.set(normalizedId, storedEntry);
    return storedEntry.snapshot;
  }

  const existingInflight = inflight.get(normalizedId);
  if (existingInflight) {
    return existingInflight;
  }

  const requestPromise = loader(normalizedId)
    .then((snapshot) => {
      writeThreadIndexCache(normalizedId, snapshot);
      return snapshot;
    })
    .finally(() => {
      inflight.delete(normalizedId);
    });

  inflight.set(normalizedId, requestPromise);
  return requestPromise;
};
