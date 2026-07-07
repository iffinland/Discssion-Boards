import type { Post, SubTopic, Topic, User } from '../../types';

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, ' ')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const createSearchHaystack = (parts: Array<string | null | undefined>) =>
  normalizeText(parts.filter(Boolean).join(' '));

export const tokenizeSearchQuery = (value: string) => {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(' ') : [];
};

const matchesTokens = (haystack: string, tokens: string[]) => {
  if (tokens.length === 0) {
    return true;
  }

  return tokens.every((token) => haystack.includes(token));
};

type StructureSearchTopic = Topic & { subTopics: SubTopic[] };

type StructureTopicIndexEntry = {
  topicId: string;
  haystack: string;
};

type StructureSubTopicIndexEntry = {
  subTopicId: string;
  topicId: string;
  haystack: string;
};

export type ForumStructureSearchIndex = {
  topicEntries: StructureTopicIndexEntry[];
  subTopicEntries: StructureSubTopicIndexEntry[];
};

export type ForumStructureSearchResult = {
  topics: StructureSearchTopic[];
  matchedTopicCount: number;
  matchedSubTopicCount: number;
};

export const buildForumStructureSearchIndex = (
  topics: Topic[],
  subTopics: SubTopic[],
  users: User[]
): ForumStructureSearchIndex => {
  const userMap = new Map(users.map((user) => [user.id, user.displayName]));
  const topicMap = new Map(topics.map((topic) => [topic.id, topic]));

  return {
    topicEntries: topics.map((topic) => ({
      topicId: topic.id,
      haystack: normalizeText(
        [
          topic.title,
          topic.description,
          topic.status,
          topic.visibility,
          topic.subTopicAccess,
          ...topic.allowedAddresses,
        ].join(' ')
      ),
    })),
    subTopicEntries: subTopics.map((subTopic) => {
      const parentTopic = topicMap.get(subTopic.topicId);
      const authorName =
        userMap.get(subTopic.authorUserId) ?? subTopic.authorUserId;

      return {
        subTopicId: subTopic.id,
        topicId: subTopic.topicId,
        haystack: normalizeText(
          [
            subTopic.title,
            subTopic.description,
            subTopic.access,
            ...subTopic.allowedAddresses,
            subTopic.status,
            subTopic.visibility,
            subTopic.isSolved ? 'solved' : 'unsolved',
            authorName,
            parentTopic?.title ?? '',
            parentTopic?.description ?? '',
          ].join(' ')
        ),
      };
    }),
  };
};

export const searchForumStructure = (
  searchIndex: ForumStructureSearchIndex,
  topics: StructureSearchTopic[],
  query: string
): ForumStructureSearchResult => {
  const tokens = tokenizeSearchQuery(query);

  if (tokens.length === 0) {
    return {
      topics,
      matchedTopicCount: topics.length,
      matchedSubTopicCount: topics.reduce(
        (count, topic) => count + topic.subTopics.length,
        0
      ),
    };
  }

  const topicMatches = new Set(
    searchIndex.topicEntries
      .filter((entry) => matchesTokens(entry.haystack, tokens))
      .map((entry) => entry.topicId)
  );

  const subTopicMatches = new Set(
    searchIndex.subTopicEntries
      .filter((entry) => matchesTokens(entry.haystack, tokens))
      .map((entry) => entry.subTopicId)
  );

  const filteredTopics = topics
    .map((topic) => {
      const topicMatched = topicMatches.has(topic.id);
      const nextSubTopics = topicMatched
        ? topic.subTopics
        : topic.subTopics.filter((subTopic) =>
            subTopicMatches.has(subTopic.id)
          );

      return {
        ...topic,
        subTopics: nextSubTopics,
      };
    })
    .filter(
      (topic) => topicMatches.has(topic.id) || topic.subTopics.length > 0
    );

  return {
    topics: filteredTopics,
    matchedTopicCount: filteredTopics.length,
    matchedSubTopicCount: filteredTopics.reduce(
      (count, topic) => count + topic.subTopics.length,
      0
    ),
  };
};

type ThreadPostIndexEntry = {
  postId: string;
  haystack: string;
};

export type ThreadPostSearchIndex = {
  entries: ThreadPostIndexEntry[];
};

export const buildThreadPostSearchIndex = (
  posts: Post[],
  users: User[]
): ThreadPostSearchIndex => {
  const userMap = new Map(users.map((user) => [user.id, user.displayName]));

  return {
    entries: posts.map((post) => ({
      postId: post.id,
      haystack: normalizeText(
        [
          post.content,
          post.poll?.question ?? '',
          post.poll?.description ?? '',
          ...(post.poll?.options.map((option) => option.label) ?? []),
          userMap.get(post.authorUserId) ?? post.authorUserId,
        ].join(' ')
      ),
    })),
  };
};

export const searchThreadPosts = (
  searchIndex: ThreadPostSearchIndex,
  posts: Post[],
  query: string
) => {
  const tokens = tokenizeSearchQuery(query);

  if (tokens.length === 0) {
    return posts;
  }

  const matchedPostIds = new Set(
    searchIndex.entries
      .filter((entry) => matchesTokens(entry.haystack, tokens))
      .map((entry) => entry.postId)
  );

  return posts.filter((post) => matchedPostIds.has(post.id));
};
