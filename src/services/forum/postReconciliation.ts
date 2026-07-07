import type { Post } from '../../types';

const STORAGE_KEY = 'forum-post-reconciliation:v1';
const RECENT_MUTATION_TTL_MS = 48 * 60 * 60 * 1000;
const MAX_RECENT_MUTATIONS = 300;

type RecentPostMutation = {
  post: Post;
  recordedAt: number;
};

const canUseStorage = () =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

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
    typeof maybePost.createdAt === 'string'
  );
};

const readMutations = (): RecentPostMutation[] => {
  if (!canUseStorage()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry) => typeof entry === 'object' && entry !== null)
      .map((entry) => entry as Partial<RecentPostMutation>)
      .filter(
        (entry): entry is RecentPostMutation =>
          typeof entry.recordedAt === 'number' && isValidPost(entry.post)
      );
  } catch {
    return [];
  }
};

const writeMutations = (mutations: RecentPostMutation[]) => {
  if (!canUseStorage()) {
    return;
  }

  const now = Date.now();
  const pruned = mutations
    .filter((entry) => now - entry.recordedAt <= RECENT_MUTATION_TTL_MS)
    .sort((a, b) => b.recordedAt - a.recordedAt)
    .slice(0, MAX_RECENT_MUTATIONS);

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
  } catch {
    // Ignore storage failures. Reconciliation still works in memory state.
  }
};

export const getPostRevisionTime = (post: Post) => {
  const timestamp = Date.parse(
    post.updatedAt ?? post.pinnedAt ?? post.editedAt ?? post.createdAt
  );
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export const reconcilePostCollections = (...collections: Post[][]) => {
  const merged = new Map<string, Post>();

  collections.flat().forEach((post) => {
    const existing = merged.get(post.id);
    if (
      !existing ||
      getPostRevisionTime(post) > getPostRevisionTime(existing)
    ) {
      merged.set(post.id, post);
    }
  });

  return [...merged.values()];
};

export const recordRecentPostMutation = (post: Post) => {
  const mutations = readMutations().filter(
    (entry) => entry.post.id !== post.id
  );
  writeMutations([{ post, recordedAt: Date.now() }, ...mutations]);
};

export const readRecentPostMutations = (subTopicId: string) => {
  const normalizedId = subTopicId.trim();
  if (!normalizedId) {
    return [];
  }

  const mutations = readMutations();
  writeMutations(mutations);

  return mutations
    .filter((entry) => entry.post.subTopicId === normalizedId)
    .map((entry) => entry.post);
};
