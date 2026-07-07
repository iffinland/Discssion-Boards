import { useMemo } from 'react';

import type { Post, SubTopic, User } from '../../../types';

type UseThreadDataQueryParams = {
  threadId?: string;
  users: User[];
  subTopics: SubTopic[];
  posts: Post[];
};

export const useThreadDataQuery = ({
  threadId,
  users,
  subTopics,
  posts,
}: UseThreadDataQueryParams) => {
  const subTopic = useMemo(
    () => subTopics.find((item) => item.id === threadId),
    [subTopics, threadId]
  );

  const threadPosts = useMemo(() => {
    return posts
      .filter((post) => post.subTopicId === threadId)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
  }, [threadId, posts]);

  const userMap = useMemo(() => {
    return new Map(users.map((user) => [user.id, user]));
  }, [users]);

  const resolveAuthorDisplayName = (authorUserId: string) =>
    userMap.get(authorUserId)?.displayName ?? 'Member';

  return {
    subTopic,
    threadPosts,
    userMap,
    resolveAuthorDisplayName,
  };
};
