import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useForumCommands } from '../features/forum/hooks/useForumCommands';
import {
  useForumDataQuery,
  type ForumLoadStatus,
} from '../features/forum/hooks/useForumDataQuery';
import type {
  ForumMutationResult,
  ForumPollDraft,
  ForumUploadAttachmentResult,
  ForumUploadImageResult,
  ForumUploadVideoResult,
} from '../features/forum/types';
import type {
  ThreadSearchSnapshot,
  TopicDirectorySnapshot,
} from '../services/qdn/forumSearchIndexService';
import { threadPostCache } from '../services/forum/threadPostCache';
import {
  reconcilePostCollections,
  readRecentPostMutations,
} from '../services/forum/postReconciliation';
import {
  clearThreadQuarantine,
  isThreadQuarantined,
  quarantineThread,
} from '../services/forum/threadLoadQuarantine';
import { forumSearchIndexService } from '../services/qdn/forumSearchIndexService';
import { forumQdnService } from '../services/qdn/forumQdnService';
import {
  loadThreadIndexCached,
  writeThreadIndexCache,
} from '../services/qdn/threadIndexCache';
import type {
  ForumRoleRegistry,
  Post,
  PostAttachment,
  SubTopic,
  Topic,
  TopicAccess,
  User,
} from '../types';

type ForumAuthMode = 'qortium';

type ForumDataContextValue = {
  users: User[];
  currentUser: User;
  authenticatedAddress: string | null;
  roleRegistry: ForumRoleRegistry;
  availableAuthNames: string[];
  activeAuthName: string | null;
  topicDirectoryIndex: TopicDirectorySnapshot | null;
  threadSearchIndexes: Record<string, ThreadSearchSnapshot>;
  topics: Topic[];
  subTopics: SubTopic[];
  posts: Post[];
  authMode: ForumAuthMode;
  isAuthenticated: boolean;
  isAuthReady: boolean;
  canSwitchUser: boolean;
  isThreadPostsLoading: boolean;
  loadError: string | null;
  isRetrying: boolean;
  loadingStage: string;
  loadStatus: ForumLoadStatus;
};

type ForumActionsContextValue = {
  authenticate: () => Promise<void>;
  setCurrentUser: (userId: string) => void;
  retryLoadData: () => void;
  createTopic: (input: {
    title: string;
    description: string;
    status: Topic['status'];
    subTopicAccess: TopicAccess;
    allowedAddresses: string[];
  }) => Promise<ForumMutationResult>;
  reorderTopics: (orderedTopicIds: string[]) => Promise<ForumMutationResult>;
  reorderPinnedSubTopics: (input: {
    topicId: string;
    orderedPinnedSubTopicIds: string[];
  }) => Promise<ForumMutationResult>;
  createSubTopic: (input: {
    topicId: string;
    title: string;
    description: string;
    access: TopicAccess;
    allowedAddresses: string[];
    isPoll?: boolean;
  }) => Promise<ForumMutationResult>;
  updateTopicSettings: (input: {
    topicId: string;
    title: string;
    description: string;
    status: Topic['status'];
    visibility: Topic['visibility'];
    subTopicAccess: TopicAccess;
    allowedAddresses: string[];
  }) => Promise<ForumMutationResult>;
  updateTopicOwnerContent: (input: { topicId: string; title: string; description: string }) => Promise<ForumMutationResult>;
  updateSubTopicOwnerContent: (input: { subTopicId: string; title: string; description: string }) => Promise<ForumMutationResult>;
  updateSubTopicSettings: (input: {
    subTopicId: string;
    topicId?: string;
    title: string;
    description: string;
    status: SubTopic['status'];
    visibility: SubTopic['visibility'];
    isPinned: boolean;
    isSolved: boolean;
    isPoll?: boolean;
    access: TopicAccess;
    allowedAddresses: string[];
    moderationReason?: string | null;
  }) => Promise<ForumMutationResult>;
  toggleSubTopicSolved: (input: {
    subTopicId: string;
    reason?: string | null;
  }) => Promise<ForumMutationResult>;
  createPost: (input: {
    subTopicId: string;
    content: string;
    parentPostId?: string | null;
    attachments?: PostAttachment[];
    poll?: ForumPollDraft | null;
  }) => Promise<ForumMutationResult>;
  upsertRoleAssignment: (input: {
    address: string;
    role: 'SuperAdmin' | 'Admin' | 'Moderator';
  }) => Promise<ForumMutationResult>;
  removeRoleAssignment: (address: string) => Promise<ForumMutationResult>;
  uploadPostImage: (file: File) => Promise<ForumUploadImageResult>;
  uploadPostAttachment: (file: File) => Promise<ForumUploadAttachmentResult>;
  uploadPostVideo: (
    file: File,
    title?: string
  ) => Promise<ForumUploadVideoResult>;
  updatePost: (input: {
    postId: string;
    content: string;
    attachments?: PostAttachment[];
  }) => Promise<ForumMutationResult>;
  togglePostPin: (postId: string) => Promise<ForumMutationResult>;
  voteOnPoll: (input: {
    postId: string;
    optionIds: string[];
  }) => Promise<ForumMutationResult>;
  closePoll: (input: { postId: string }) => Promise<ForumMutationResult>;
  deletePost: (input: {
    postId: string;
    reason?: string | null;
  }) => Promise<ForumMutationResult>;
  likePost: (postId: string) => void;
  tipPost: (postId: string) => Promise<ForumMutationResult>;
  loadThreadPosts: (subTopicId: string) => Promise<ForumMutationResult>;
};

const ForumDataContext = createContext<ForumDataContextValue | null>(null);
const ForumActionsContext = createContext<ForumActionsContextValue | null>(
  null
);

const postsFromThreadIndex = (snapshot: ThreadSearchSnapshot): Post[] => {
  return snapshot.posts.map((post) => ({
    id: post.postId,
    subTopicId: snapshot.subTopicId,
    authorUserId: post.authorUserId,
    parentPostId: post.parentPostId,
    content: post.content,
    attachments: post.attachments,
    poll: post.poll ?? null,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt ?? post.editedAt ?? post.createdAt,
    editedAt: post.editedAt ?? null,
    isPinned: post.isPinned === true,
    pinnedAt: post.pinnedAt ?? null,
    pinnedByUserId: post.pinnedByUserId ?? null,
    likes: post.likes,
    tips: post.tips,
    likedByAddresses: post.likedByAddresses,
  }));
};

export const ForumProvider = ({ children }: { children: ReactNode }) => {
  const {
    users,
    setUsers,
    topics,
    setTopics,
    subTopics,
    setSubTopics,
    posts,
    setPosts,
    currentUser,
    authenticatedAddress,
    roleRegistry,
    topicDirectoryIndex,
    threadSearchIndexes,
    setRoleRegistry,
    setTopicDirectoryIndex,
    setThreadSearchIndexes,
    availableAuthNames,
    activeAuthName,
    setActiveAuthName,
    isAuthReady,
    authMode,
    isAuthenticated,
    authenticate,
    loadError,
    isRetrying,
    loadingStage,
    loadStatus,
    retryLoadData,
  } = useForumDataQuery();
  const {
    createTopic,
    reorderTopics,
    reorderPinnedSubTopics,
    createSubTopic,
    updateTopicOwnerContent,
    updateTopicSettings,
    updateSubTopicOwnerContent,
    updateSubTopicSettings,
    toggleSubTopicSolved,
    upsertRoleAssignment,
    removeRoleAssignment,
    createPost,
    uploadPostImage,
    uploadPostAttachment,
    uploadPostVideo,
    updatePost,
    togglePostPin,
    voteOnPoll,
    closePoll,
    deletePost,
    likePost,
    tipPost,
  } = useForumCommands({
    currentUser,
    isAuthenticated,
    authenticatedAddress,
    roleRegistry,
    topics,
    subTopics,
    posts,
    setTopicDirectoryIndex,
    setThreadSearchIndexes,
    setRoleRegistry,
    setUsers,
    setTopics,
    setSubTopics,
    setPosts,
  });
  const loadedThreadsRef = useRef<Set<string>>(new Set());
  const isBackgroundSyncingRef = useRef(false);
  const [isThreadPostsLoading, setIsThreadPostsLoading] = useState(false);
  const threadLoadStateKey = `${authenticatedAddress ?? 'guest'}:${activeAuthName ?? currentUser.id}`;

  const setCurrentUser = useCallback(
    (name: string) => {
      if (!name) {
        return;
      }
      setActiveAuthName(name);
    },
    [setActiveAuthName]
  );

  const loadThreadPosts = useCallback(
    async (subTopicId: string): Promise<ForumMutationResult> => {
      const normalizedId = subTopicId.trim();
      if (!normalizedId) {
        return { ok: false, error: 'Sub-topic id is required.' };
      }

      if (isThreadQuarantined(normalizedId)) {
        return {
          ok: false,
          error:
            'This thread is temporarily quarantined because its QDN data is missing.',
        };
      }

      if (loadedThreadsRef.current.has(normalizedId)) {
        return { ok: true };
      }

      const cached = threadPostCache.read(normalizedId);
      const recentMutations = readRecentPostMutations(normalizedId);
      if (cached?.posts.length) {
        setPosts((current) => {
          const merged = reconcilePostCollections(
            current,
            cached.posts,
            recentMutations
          );
          threadPostCache.write(
            normalizedId,
            merged.filter((post) => post.subTopicId === normalizedId)
          );
          return merged;
        });
        if (!cached.isStale) {
          loadedThreadsRef.current.add(normalizedId);
          return { ok: true };
        }
      }

      setIsThreadPostsLoading(true);
      try {
        let loadedPosts: Post[] | null = null;

        try {
          const loadedThreadIndex = await loadThreadIndexCached(
            normalizedId,
            forumSearchIndexService.loadThreadIndex
          );
          if (loadedThreadIndex) {
            setThreadSearchIndexes((current) => ({
              ...current,
              [normalizedId]: loadedThreadIndex,
            }));
            loadedPosts = postsFromThreadIndex(loadedThreadIndex);
          }
        } catch {
          // Fall back to direct QDN post loading when the thread index is unavailable.
        }

        if (!loadedPosts) {
          loadedPosts = await forumQdnService.loadPostsBySubTopic(normalizedId);
        }

        setPosts((current) => {
          const merged = reconcilePostCollections(
            current,
            loadedPosts,
            recentMutations
          );
          threadPostCache.write(
            normalizedId,
            merged.filter((post) => post.subTopicId === normalizedId)
          );
          return merged;
        });
        clearThreadQuarantine(normalizedId);
        loadedThreadsRef.current.add(normalizedId);
        return { ok: true };
      } catch (error) {
        if (cached?.posts.length) {
          loadedThreadsRef.current.add(normalizedId);
          return { ok: true };
        }

        quarantineThread(normalizedId);

        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to load thread posts.',
        };
      } finally {
        setIsThreadPostsLoading(false);
      }
    },
    [setPosts, setThreadSearchIndexes]
  );

  const dataValue = useMemo<ForumDataContextValue>(
    () => ({
      users,
      currentUser,
      authenticatedAddress,
      roleRegistry,
      availableAuthNames,
      activeAuthName,
      topicDirectoryIndex,
      threadSearchIndexes,
      topics,
      subTopics,
      posts,
      authMode,
      isAuthenticated,
      isAuthReady,
      canSwitchUser: availableAuthNames.length > 1,
      isThreadPostsLoading,
      loadError,
      isRetrying,
      loadingStage,
      loadStatus,
    }),
    [
      users,
      currentUser,
      authenticatedAddress,
      roleRegistry,
      topicDirectoryIndex,
      threadSearchIndexes,
      availableAuthNames,
      activeAuthName,
      topics,
      subTopics,
      posts,
      authMode,
      isAuthenticated,
      isAuthReady,
      isThreadPostsLoading,
      loadError,
      isRetrying,
      loadingStage,
      loadStatus,
    ]
  );

  const actionsValue = useMemo<ForumActionsContextValue>(
    () => ({
      authenticate,
      setCurrentUser,
      retryLoadData,
      createTopic,
      reorderTopics,
      reorderPinnedSubTopics,
      createSubTopic,
      updateTopicOwnerContent,
      updateTopicSettings,
      updateSubTopicOwnerContent,
      updateSubTopicSettings,
      toggleSubTopicSolved,
      upsertRoleAssignment,
      removeRoleAssignment,
      createPost,
      uploadPostImage,
      uploadPostAttachment,
      uploadPostVideo,
      updatePost,
      togglePostPin,
      voteOnPoll,
      closePoll,
      deletePost,
      likePost,
      tipPost,
      loadThreadPosts,
    }),
    [
      authenticate,
      setCurrentUser,
      retryLoadData,
      createTopic,
      reorderTopics,
      reorderPinnedSubTopics,
      createSubTopic,
      updateTopicOwnerContent,
      updateTopicSettings,
      updateSubTopicOwnerContent,
      updateSubTopicSettings,
      toggleSubTopicSolved,
      upsertRoleAssignment,
      removeRoleAssignment,
      createPost,
      uploadPostImage,
      uploadPostAttachment,
      uploadPostVideo,
      updatePost,
      togglePostPin,
      voteOnPoll,
      closePoll,
      deletePost,
      likePost,
      tipPost,
      loadThreadPosts,
    ]
  );

  useEffect(() => {
    loadedThreadsRef.current.clear();
  }, [threadLoadStateKey]);

  useEffect(() => {
    if (posts.length === 0) {
      loadedThreadsRef.current.clear();
    }
  }, [posts.length, subTopics.length]);

  useEffect(() => {
    if (!isAuthReady || !isAuthenticated || subTopics.length === 0) {
      return;
    }

    const runBackgroundSync = async () => {
      if (isBackgroundSyncingRef.current) {
        return;
      }

      isBackgroundSyncingRef.current = true;
      try {
        const recentFromCache = threadPostCache.listRecentSubTopicIds(2);
        const recentActiveSubTopics = [...subTopics]
          .sort(
            (a, b) =>
              new Date(b.lastPostAt).getTime() -
              new Date(a.lastPostAt).getTime()
          )
          .slice(0, 2)
          .map((subTopic) => subTopic.id);

        const targets = Array.from(
          new Set([...recentFromCache, ...recentActiveSubTopics])
        );

        for (const subTopicId of targets) {
          const cached = threadPostCache.read(subTopicId);
          if (
            loadedThreadsRef.current.has(subTopicId) ||
            isThreadQuarantined(subTopicId) ||
            (cached && !cached.isStale)
          ) {
            continue;
          }

          try {
            const threadIndex = await loadThreadIndexCached(
              subTopicId,
              forumSearchIndexService.loadThreadIndex
            );
            if (!threadIndex) {
              continue;
            }

            threadPostCache.write(
              subTopicId,
              postsFromThreadIndex(threadIndex)
            );
            writeThreadIndexCache(subTopicId, threadIndex);
            clearThreadQuarantine(subTopicId);
          } catch {
            quarantineThread(subTopicId);
          }
        }
      } finally {
        isBackgroundSyncingRef.current = false;
      }
    };

    const maybeWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (typeof maybeWindow.requestIdleCallback === 'function') {
      const requestIdle = maybeWindow.requestIdleCallback;
      const idleId = requestIdle(
        () => {
          void runBackgroundSync();
        },
        { timeout: 10_000 }
      );

      return () => {
        if (typeof maybeWindow.cancelIdleCallback === 'function') {
          maybeWindow.cancelIdleCallback(idleId);
        }
      };
    }

    const timeoutId = window.setTimeout(() => {
      void runBackgroundSync();
    }, 10_000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isAuthReady, isAuthenticated, subTopics]);

  return (
    <ForumDataContext.Provider value={dataValue}>
      <ForumActionsContext.Provider value={actionsValue}>
        {children}
      </ForumActionsContext.Provider>
    </ForumDataContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useForumDataContext = () => {
  const context = useContext(ForumDataContext);

  if (!context) {
    throw new Error('useForumDataContext must be used within ForumProvider');
  }

  return context;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useForumActionsContext = () => {
  const context = useContext(ForumActionsContext);

  if (!context) {
    throw new Error('useForumActionsContext must be used within ForumProvider');
  }

  return context;
};
