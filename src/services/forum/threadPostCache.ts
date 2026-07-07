import type { Post } from '../../types';

const STORAGE_PREFIX = 'forum-thread-posts:';
const INDEX_KEY = 'forum-thread-posts:index';
const CACHE_TTL_MS = 5 * 60 * 1000;

type ThreadPostCacheEntry = {
  cachedAt: number;
  posts: Post[];
};

type ThreadIndexEntry = {
  subTopicId: string;
  updatedAt: number;
};

const isValidPost = (value: unknown): value is Post => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const maybePost = value as Record<string, unknown>;
  return (
    typeof maybePost.id === 'string' &&
    typeof maybePost.subTopicId === 'string' &&
    typeof maybePost.authorUserId === 'string' &&
    typeof maybePost.content === 'string' &&
    typeof maybePost.createdAt === 'string' &&
    (typeof maybePost.likes === 'number' || maybePost.likes === undefined) &&
    (typeof maybePost.tips === 'number' || maybePost.tips === undefined) &&
    (Array.isArray(maybePost.likedByAddresses) ||
      maybePost.likedByAddresses === undefined)
  );
};

const getStorageKey = (subTopicId: string) => `${STORAGE_PREFIX}${subTopicId}`;

const readIndex = (): ThreadIndexEntry[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  const raw = window.localStorage.getItem(INDEX_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry) => typeof entry === 'object' && entry !== null)
      .map((entry) => entry as Partial<ThreadIndexEntry>)
      .filter(
        (entry): entry is ThreadIndexEntry =>
          typeof entry.subTopicId === 'string' &&
          typeof entry.updatedAt === 'number'
      );
  } catch {
    return [];
  }
};

const writeIndex = (entries: ThreadIndexEntry[]) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(INDEX_KEY, JSON.stringify(entries));
};

const updateIndex = (subTopicId: string) => {
  const next = readIndex()
    .filter((entry) => entry.subTopicId !== subTopicId)
    .concat({ subTopicId, updatedAt: Date.now() })
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 30);

  writeIndex(next);
};

const readCacheEntry = (subTopicId: string): ThreadPostCacheEntry | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(getStorageKey(subTopicId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ThreadPostCacheEntry>;
    if (typeof parsed.cachedAt !== 'number' || !Array.isArray(parsed.posts)) {
      return null;
    }

    const validPosts = parsed.posts.filter(isValidPost).map((post) => ({
      ...post,
      likes: typeof post.likes === 'number' ? post.likes : 0,
      tips: typeof post.tips === 'number' ? post.tips : 0,
      likedByAddresses: Array.isArray(post.likedByAddresses)
        ? post.likedByAddresses.filter(
            (value): value is string => typeof value === 'string'
          )
        : [],
    }));
    return {
      cachedAt: parsed.cachedAt,
      posts: validPosts,
    };
  } catch {
    return null;
  }
};

const writeCacheEntry = (subTopicId: string, posts: Post[]) => {
  if (typeof window === 'undefined') {
    return;
  }

  const payload: ThreadPostCacheEntry = {
    cachedAt: Date.now(),
    posts,
  };

  window.localStorage.setItem(
    getStorageKey(subTopicId),
    JSON.stringify(payload)
  );
  updateIndex(subTopicId);
};

export const threadPostCache = {
  read(subTopicId: string) {
    const entry = readCacheEntry(subTopicId);
    if (!entry) {
      return null;
    }

    return {
      posts: entry.posts,
      isStale: Date.now() - entry.cachedAt > CACHE_TTL_MS,
    };
  },
  write(subTopicId: string, posts: Post[]) {
    writeCacheEntry(subTopicId, posts);
  },
  listRecentSubTopicIds(limit = 5) {
    return readIndex()
      .slice(0, Math.max(1, limit))
      .map((entry) => entry.subTopicId);
  },
};
