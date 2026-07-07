import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

import ShareIcon from '../components/common/ShareIcon';
import PostComposerModal from '../features/forum/components/PostComposerModal';
import PostEditModal from '../features/forum/components/PostEditModal';
import QortTipModal from '../features/forum/components/QortTipModal';
import ThreadSkeleton from '../features/forum/components/ThreadSkeleton';
import ThreadPostCard from '../features/forum/components/ThreadPostCard';
import { useThreadActions } from '../features/forum/hooks/useThreadActions';
import { useThreadDataQuery } from '../features/forum/hooks/useThreadDataQuery';
import { useForumActions, useForumData } from '../hooks/useForumData';
import {
  buildThreadPostSearchIndex,
  createSearchHaystack,
  searchThreadPosts,
  tokenizeSearchQuery,
} from '../services/forum/forumSearch';
import {
  canAccessSubTopic,
  resolveAccessLabel,
} from '../services/forum/forumAccess';
import { resolveRoleForAddress } from '../services/qdn/forumRolesService';
import {
  buildThreadShareLink,
  copyToClipboard,
} from '../services/qortium/share';
import { resolveNameWalletAddress } from '../services/qortium/walletService';
import { perfDebugLog, perfDebugTimeStart } from '../services/perf/perfDebug';
import type { Post, PostAttachment, UserRole } from '../types';

const THREAD_BATCH_SIZE = 12;
const THREAD_VIRTUALIZE_THRESHOLD = 30;
const THREAD_VIRTUAL_ROW_ESTIMATE = 280;
const THREAD_VIRTUAL_OVERSCAN = 6;
const AUTHOR_ROLE_INITIAL_BATCH_SIZE = 8;
const AUTHOR_ROLE_BATCH_SIZE = 6;
type PostSortMode = 'oldest' | 'newest';

type ThreadPageProps = {
  onSearchQueryChange: (value: string) => void;
};

const ThreadPage = ({ onSearchQueryChange }: ThreadPageProps) => {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    users,
    currentUser,
    authenticatedAddress,
    roleRegistry,
    topics,
    subTopics,
    posts,
    threadSearchIndexes,
    isAuthenticated,
    isThreadPostsLoading,
    isAuthReady,
  } = useForumData();
  const {
    updateSubTopicSettings,
    toggleSubTopicSolved,
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
  } = useForumActions();
  const [threadLoadError, setThreadLoadError] = useState<string | null>(null);
  const [moderationFeedback, setModerationFeedback] = useState<string | null>(
    null
  );
  const [isThreadShareCopied, setIsThreadShareCopied] = useState(false);
  const [highlightedPostId, setHighlightedPostId] = useState<string | null>(
    null
  );
  const [replyContextPostId, setReplyContextPostId] = useState<string | null>(
    null
  );
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [editText, setEditText] = useState('');
  const [editAttachments, setEditAttachments] = useState<PostAttachment[]>([]);
  const [postSortMode, setPostSortMode] = useState<PostSortMode>('oldest');
  const [threadSearchQuery, setThreadSearchQuery] = useState('');
  const [authorRolesByUserId, setAuthorRolesByUserId] = useState<
    Record<string, UserRole>
  >({});
  const [hasInitialThreadLoadCompleted, setHasInitialThreadLoadCompleted] =
    useState(false);
  const [visibleCount, setVisibleCount] = useState<number>(THREAD_BATCH_SIZE);
  const [virtualScrollTop, setVirtualScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [virtualFocusIndex, setVirtualFocusIndex] = useState<number | null>(
    null
  );
  const postListRef = useRef<HTMLElement | null>(null);
  const postListTopRef = useRef(0);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const resolvedAuthorAddressRef = useRef<Map<string, string | null>>(
    new Map()
  );
  const requestedAuthorRolesRef = useRef<Set<string>>(new Set());
  const deferredSearchQuery = useDeferredValue(threadSearchQuery);

  const { subTopic, threadPosts, userMap, resolveAuthorDisplayName } =
    useThreadDataQuery({
      threadId: id,
      users,
      subTopics,
      posts,
    });
  const parentTopic = useMemo(
    () => topics.find((topic) => topic.id === subTopic?.topicId),
    [subTopic?.topicId, topics]
  );

  const {
    replyText,
    replyTarget,
    replyAttachments,
    pollDraft,
    setReplyText,
    setReplyAttachments,
    setPollDraft,
    feedback,
    isTipModalOpen,
    tipAmount,
    tipRecipientName,
    tipRecipientAddress,
    tipResolveError,
    isResolvingTipRecipient,
    isSendingTip,
    isTipBalanceLoading,
    formattedTipBalance,
    handleSubmitReply,
    handleReplyToPost,
    handleCancelReplyTarget,
    resetComposer,
    handleEditPost,
    handleDeletePost,
    handleSharePost,
    handleSendTip,
    closeTipModal,
    setTipAmount,
    submitTip,
    uploadImageForReply,
    uploadAttachmentForReply,
    uploadVideoForReply,
  } = useThreadActions({
    threadId: id,
    createPost,
    uploadPostImage,
    uploadPostAttachment,
    uploadPostVideo,
    updatePost,
    deletePost,
    tipPost,
    resolveAuthorDisplayName,
  });

  const postSearchIndex = useMemo(
    () =>
      subTopic && threadSearchIndexes[subTopic.id]
        ? {
            entries: threadSearchIndexes[subTopic.id].posts.map((post) => ({
              postId: post.postId,
              haystack: createSearchHaystack([
                post.content,
                post.poll?.question ?? '',
                post.poll?.description ?? '',
                ...(post.poll?.options.map((option) => option.label) ?? []),
                post.authorUserId,
              ]),
            })),
          }
        : buildThreadPostSearchIndex(threadPosts, users),
    [subTopic, threadPosts, threadSearchIndexes, users]
  );
  const filteredThreadPosts = useMemo(
    () => searchThreadPosts(postSearchIndex, threadPosts, deferredSearchQuery),
    [deferredSearchQuery, postSearchIndex, threadPosts]
  );
  const hasActiveThreadSearch = deferredSearchQuery.trim().length > 0;
  const orderedThreadPosts = useMemo(() => {
    const sorted = [...filteredThreadPosts].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    return postSortMode === 'newest' ? sorted.reverse() : sorted;
  }, [filteredThreadPosts, postSortMode]);
  const pinnedThreadPosts = useMemo(
    () =>
      orderedThreadPosts
        .filter((post) => post.isPinned === true)
        .sort(
          (a, b) =>
            new Date(b.pinnedAt ?? b.updatedAt ?? b.createdAt).getTime() -
            new Date(a.pinnedAt ?? a.updatedAt ?? a.createdAt).getTime()
        ),
    [orderedThreadPosts]
  );
  const regularThreadPosts = useMemo(
    () => orderedThreadPosts.filter((post) => post.isPinned !== true),
    [orderedThreadPosts]
  );
  const sharedPostId = useMemo(
    () => new URLSearchParams(location.search).get('post'),
    [location.search]
  );
  const shouldAutoOpenComposer = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('compose') === '1';
  }, [location.search]);
  const threadPostMap = useMemo(
    () => new Map(threadPosts.map((post) => [post.id, post])),
    [threadPosts]
  );
  const visiblePosts = useMemo(
    () => regularThreadPosts.slice(0, visibleCount),
    [regularThreadPosts, visibleCount]
  );
  const displayPosts = useMemo(() => {
    if (!sharedPostId) {
      return visiblePosts;
    }

    if (visiblePosts.some((post) => post.id === sharedPostId)) {
      return visiblePosts;
    }

    const sharedPost = threadPostMap.get(sharedPostId);
    if (!sharedPost || sharedPost.isPinned === true) {
      return visiblePosts;
    }

    return [...visiblePosts, sharedPost].sort((a, b) =>
      postSortMode === 'newest'
        ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }, [postSortMode, sharedPostId, threadPostMap, visiblePosts]);
  const shouldVirtualize = displayPosts.length >= THREAD_VIRTUALIZE_THRESHOLD;
  const virtualWindow = useMemo(() => {
    if (!shouldVirtualize) {
      return {
        start: 0,
        end: displayPosts.length,
      };
    }

    const baseVisibleRows = Math.max(
      THREAD_BATCH_SIZE,
      Math.ceil(Math.max(viewportHeight, 1) / THREAD_VIRTUAL_ROW_ESTIMATE)
    );

    let start = Math.max(
      0,
      Math.floor(virtualScrollTop / THREAD_VIRTUAL_ROW_ESTIMATE) -
        THREAD_VIRTUAL_OVERSCAN
    );

    if (virtualFocusIndex !== null) {
      start = Math.max(0, virtualFocusIndex - THREAD_VIRTUAL_OVERSCAN);
    }

    const end = Math.min(
      displayPosts.length,
      start + baseVisibleRows + THREAD_VIRTUAL_OVERSCAN * 2
    );

    return { start, end };
  }, [
    displayPosts.length,
    shouldVirtualize,
    viewportHeight,
    virtualFocusIndex,
    virtualScrollTop,
  ]);
  const renderedPosts = useMemo(
    () => displayPosts.slice(virtualWindow.start, virtualWindow.end),
    [displayPosts, virtualWindow.end, virtualWindow.start]
  );
  const topSpacerHeight = shouldVirtualize
    ? virtualWindow.start * THREAD_VIRTUAL_ROW_ESTIMATE
    : 0;
  const bottomSpacerHeight = shouldVirtualize
    ? (displayPosts.length - virtualWindow.end) * THREAD_VIRTUAL_ROW_ESTIMATE
    : 0;
  const renderWindowSize = renderedPosts.length;
  const visibleAuthorIds = useMemo(
    () => [
      ...new Set(
        renderedPosts
          .map((post) => post.authorUserId)
          .filter(Boolean)
          .concat(pinnedThreadPosts.map((post) => post.authorUserId))
      ),
    ],
    [pinnedThreadPosts, renderedPosts]
  );

  const canLoadMore = visibleCount < regularThreadPosts.length;
  const canModerate = currentUser.role !== 'Member';
  const canLockSubTopic = canModerate;
  const canManageSubTopicAdvanced =
    currentUser.role === 'SysOp' ||
    currentUser.role === 'SuperAdmin' ||
    currentUser.role === 'Admin';
  const canDeletePosts = canManageSubTopicAdvanced;
  const hasSubTopicAccess = subTopic
    ? canAccessSubTopic(subTopic, currentUser, authenticatedAddress)
    : false;
  const hasActiveSearch = tokenizeSearchQuery(deferredSearchQuery).length > 0;
  const likeActorId = useMemo(() => {
    const normalizedAddress = authenticatedAddress?.trim().toLowerCase();
    if (normalizedAddress) {
      return `addr:${normalizedAddress}`;
    }

    const normalizedUserId = currentUser.id?.trim().toLowerCase();
    if (normalizedUserId) {
      return `user:${normalizedUserId}`;
    }

    return '';
  }, [authenticatedAddress, currentUser.id]);
  const pollVoterId = authenticatedAddress ?? currentUser.id;
  const isComposerDisabled =
    !hasSubTopicAccess ||
    subTopic?.status === 'locked' ||
    subTopic?.visibility === 'hidden';
  const composerHelperText = !hasSubTopicAccess
    ? 'You do not have access to post in this sub-topic.'
    : subTopic?.visibility === 'hidden'
      ? 'This sub-topic is hidden.'
      : subTopic?.status === 'locked'
        ? 'This sub-topic is locked.'
        : null;

  useEffect(() => {
    if (!shouldAutoOpenComposer) {
      return;
    }

    resetComposer();
    setIsComposerOpen(true);
    const params = new URLSearchParams(location.search);
    params.delete('compose');
    params.delete('firstPost');
    const nextSearch = params.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
      },
      { replace: true }
    );
  }, [
    location.pathname,
    location.search,
    navigate,
    resetComposer,
    shouldAutoOpenComposer,
  ]);

  useEffect(() => {
    let active = true;
    const missingAuthorIds = visibleAuthorIds.filter(
      (authorUserId) =>
        authorRolesByUserId[authorUserId] === undefined &&
        !requestedAuthorRolesRef.current.has(authorUserId)
    );

    if (missingAuthorIds.length === 0) {
      return () => {
        active = false;
      };
    }

    missingAuthorIds.forEach((authorUserId) => {
      requestedAuthorRolesRef.current.add(authorUserId);
    });

    const maybeWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    const resolveRoleBatch = async (authorIds: string[]) => {
      const resolvedEntries = await Promise.all(
        authorIds.map(async (authorUserId) => {
          const directRole = resolveRoleForAddress(authorUserId, roleRegistry);
          if (directRole !== 'Member') {
            return [authorUserId, directRole] as const;
          }

          const knownAddress =
            userMap.get(authorUserId)?.address?.trim() ||
            resolvedAuthorAddressRef.current.get(authorUserId) ||
            null;
          if (knownAddress) {
            return [
              authorUserId,
              resolveRoleForAddress(knownAddress, roleRegistry),
            ] as const;
          }

          try {
            const resolvedAddress =
              await resolveNameWalletAddress(authorUserId);
            resolvedAuthorAddressRef.current.set(authorUserId, resolvedAddress);

            return [
              authorUserId,
              resolveRoleForAddress(resolvedAddress, roleRegistry),
            ] as const;
          } catch {
            resolvedAuthorAddressRef.current.set(authorUserId, null);
            return [authorUserId, 'Member'] as const;
          }
        })
      );

      if (!active) {
        return;
      }

      setAuthorRolesByUserId((current) => ({
        ...current,
        ...Object.fromEntries(resolvedEntries),
      }));
    };

    const resolveAuthorRoles = async () => {
      const endTiming = perfDebugTimeStart('thread-page-author-role-load', {
        threadId: id ?? null,
        authorCount: missingAuthorIds.length,
        renderedPostCount: renderedPosts.length,
      });
      await resolveRoleBatch(
        missingAuthorIds.slice(0, AUTHOR_ROLE_INITIAL_BATCH_SIZE)
      );

      for (
        let startIndex = AUTHOR_ROLE_INITIAL_BATCH_SIZE;
        startIndex < missingAuthorIds.length && active;
        startIndex += AUTHOR_ROLE_BATCH_SIZE
      ) {
        await new Promise<void>((resolve) => {
          if (typeof maybeWindow.requestIdleCallback === 'function') {
            maybeWindow.requestIdleCallback(() => resolve(), { timeout: 1200 });
            return;
          }

          window.setTimeout(resolve, 120);
        });

        if (!active) {
          return;
        }

        await resolveRoleBatch(
          missingAuthorIds.slice(
            startIndex,
            startIndex + AUTHOR_ROLE_BATCH_SIZE
          )
        );
      }

      endTiming({
        threadId: id ?? null,
        resolvedAuthorCount: missingAuthorIds.length,
      });
    };

    void resolveAuthorRoles();

    return () => {
      active = false;
    };
  }, [
    authorRolesByUserId,
    id,
    renderedPosts.length,
    roleRegistry,
    userMap,
    visibleAuthorIds,
  ]);

  const handleToggleSubTopicStatus = async () => {
    if (!subTopic) {
      return;
    }

    const result = await updateSubTopicSettings({
      subTopicId: subTopic.id,
      title: subTopic.title,
      description: subTopic.description,
      status: subTopic.status === 'locked' ? 'open' : 'locked',
      visibility: subTopic.visibility,
      isPinned: subTopic.isPinned,
      isSolved: subTopic.isSolved,
      access: subTopic.access,
      allowedAddresses: subTopic.allowedAddresses,
    });

    setModerationFeedback(
      result.ok
        ? 'Sub-topic status updated.'
        : (result.error ?? 'Unable to update sub-topic.')
    );
  };

  const handleToggleSubTopicVisibility = async () => {
    if (!subTopic) {
      return;
    }

    const result = await updateSubTopicSettings({
      subTopicId: subTopic.id,
      title: subTopic.title,
      description: subTopic.description,
      status: subTopic.status,
      visibility: subTopic.visibility === 'hidden' ? 'visible' : 'hidden',
      isPinned: subTopic.isPinned,
      isSolved: subTopic.isSolved,
      access: subTopic.access,
      allowedAddresses: subTopic.allowedAddresses,
    });

    setModerationFeedback(
      result.ok
        ? 'Sub-topic visibility updated.'
        : (result.error ?? 'Unable to update sub-topic.')
    );
  };

  const handleToggleSubTopicPin = async () => {
    if (!subTopic) {
      return;
    }

    const result = await updateSubTopicSettings({
      subTopicId: subTopic.id,
      title: subTopic.title,
      description: subTopic.description,
      status: subTopic.status,
      visibility: subTopic.visibility,
      isPinned: !subTopic.isPinned,
      isSolved: subTopic.isSolved,
      access: subTopic.access,
      allowedAddresses: subTopic.allowedAddresses,
    });

    setModerationFeedback(
      result.ok
        ? subTopic.isPinned
          ? 'Sub-topic unpinned.'
          : 'Sub-topic pinned to the top.'
        : (result.error ?? 'Unable to update sub-topic.')
    );
  };

  const handleToggleSubTopicSolved = async () => {
    if (!subTopic) {
      return;
    }

    const result = await toggleSubTopicSolved({
      subTopicId: subTopic.id,
    });
    setModerationFeedback(
      result.ok
        ? subTopic.isSolved
          ? 'Solved status cleared.'
          : 'Thread marked as solved.'
        : (result.error ?? 'Unable to update solved status.')
    );
  };

  useEffect(() => {
    if (!id) {
      return;
    }

    setThreadSearchQuery('');
    onSearchQueryChange('');
  }, [id, onSearchQueryChange]);

  useEffect(() => {
    setHasInitialThreadLoadCompleted(false);
  }, [id]);

  useEffect(() => {
    if (!id || !subTopic) {
      return;
    }

    let active = true;
    void loadThreadPosts(id).then((result) => {
      if (!active) {
        return;
      }
      setHasInitialThreadLoadCompleted(true);
      setThreadLoadError(
        result.ok ? null : (result.error ?? 'Unable to load thread posts.')
      );
    });

    return () => {
      active = false;
    };
  }, [id, loadThreadPosts, subTopic]);

  const shouldShowThreadEmptyState =
    hasInitialThreadLoadCompleted &&
    !isThreadPostsLoading &&
    !threadLoadError &&
    displayPosts.length === 0 &&
    pinnedThreadPosts.length === 0;
  const isCreatingFirstPost =
    threadPosts.length === 0 && !replyTarget && isComposerOpen;
  const composerTitle = replyTarget
    ? 'Reply to Post'
    : isCreatingFirstPost
      ? 'Add First Post'
      : 'Add New Post';
  const composerPlaceholder = isCreatingFirstPost
    ? 'Write the first post for this new sub-topic...'
    : 'Share your thoughts with the community...';
  const composerSubmitLabel = isCreatingFirstPost
    ? 'Publish First Post'
    : replyTarget
      ? 'Publish Reply'
      : 'Publish Post';

  const openNewPostComposer = () => {
    resetComposer();
    setIsComposerOpen(true);
  };

  const openReplyComposer = (post: Post) => {
    handleReplyToPost(post);
    setIsComposerOpen(true);
  };

  const closeComposerModal = () => {
    resetComposer();
    setIsComposerOpen(false);
  };

  const openEditComposer = useCallback((post: Post) => {
    setEditingPost(post);
    setEditText(post.content);
    setEditAttachments(post.attachments);
  }, []);

  const closeEditComposer = useCallback(() => {
    setEditingPost(null);
    setEditText('');
    setEditAttachments([]);
  }, []);

  const submitPostEdit = useCallback(async () => {
    if (!editingPost) {
      return false;
    }

    const value = editText.trim();
    if (!value && editAttachments.length === 0) {
      setModerationFeedback('Post content or attachment is required.');
      return false;
    }

    return handleEditPost(editingPost.id, value, editAttachments);
  }, [editAttachments, editText, editingPost, handleEditPost]);

  const handleTogglePostPin = useCallback(
    async (post: Post) => {
      const result = await togglePostPin(post.id);
      if (!result.ok) {
        setModerationFeedback(result.error ?? 'Unable to update pinned post.');
        return;
      }

      setModerationFeedback(post.isPinned ? 'Post unpinned.' : 'Post pinned.');
      window.setTimeout(() => {
        setModerationFeedback((current) =>
          current === 'Post pinned.' || current === 'Post unpinned.'
            ? null
            : current
        );
      }, 2400);
    },
    [togglePostPin]
  );

  const handleVoteOnPoll = async (postId: string, optionIds: string[]) => {
    const result = await voteOnPoll({ postId, optionIds });
    if (!result.ok) {
      setModerationFeedback(result.error ?? 'Unable to submit vote.');
      return;
    }

    setModerationFeedback('Vote submitted.');
    window.setTimeout(() => {
      setModerationFeedback((current) =>
        current === 'Vote submitted.' ? null : current
      );
    }, 2400);
  };

  const handleClosePoll = async (postId: string) => {
    const result = await closePoll({ postId });
    if (!result.ok) {
      setModerationFeedback(result.error ?? 'Unable to close poll.');
      return;
    }

    setModerationFeedback('Poll closed.');
    window.setTimeout(() => {
      setModerationFeedback((current) =>
        current === 'Poll closed.' ? null : current
      );
    }, 2400);
  };

  useEffect(() => {
    setVisibleCount(THREAD_BATCH_SIZE);
    setVirtualFocusIndex(null);
  }, [filteredThreadPosts.length, id]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!shouldVirtualize) {
      setVirtualScrollTop(0);
      setViewportHeight(window.innerHeight);
      return;
    }

    let frameId = 0;
    const measurePostListTop = () => {
      const node = postListRef.current;
      postListTopRef.current = node
        ? node.getBoundingClientRect().top +
          (window.scrollY || window.pageYOffset || 0)
        : 0;
    };

    const updateViewportState = () => {
      const scrollTop = window.scrollY || window.pageYOffset || 0;
      measurePostListTop();
      setVirtualScrollTop(Math.max(0, scrollTop - postListTopRef.current));
      setViewportHeight(window.innerHeight);
    };

    const handleScroll = () => {
      if (frameId) {
        return;
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        updateViewportState();
      });
    };

    updateViewportState();
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', updateViewportState);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', updateViewportState);
    };
  }, [displayPosts.length, shouldVirtualize]);

  useEffect(() => {
    perfDebugLog('thread-render-window', {
      threadId: id ?? null,
      totalPosts: displayPosts.length,
      renderedPosts: renderWindowSize,
      shouldVirtualize,
      visibleCount,
      windowStart: virtualWindow.start,
      windowEnd: virtualWindow.end,
      searchActive: hasActiveSearch,
    });
  }, [
    displayPosts.length,
    hasActiveSearch,
    id,
    renderWindowSize,
    shouldVirtualize,
    virtualWindow.end,
    virtualWindow.start,
    visibleCount,
  ]);

  useEffect(() => {
    if (!shouldVirtualize || typeof window === 'undefined') {
      return;
    }

    let frameCount = 0;
    let lastTimestamp = performance.now();
    let rafId = 0;

    const sampleFps = (timestamp: number) => {
      frameCount += 1;
      const elapsed = timestamp - lastTimestamp;

      if (elapsed >= 2000) {
        const fps = (frameCount * 1000) / elapsed;
        perfDebugLog('thread-scroll-fps', {
          threadId: id ?? null,
          fps: Number(fps.toFixed(1)),
          renderedPosts: renderWindowSize,
          totalPosts: displayPosts.length,
        });
        frameCount = 0;
        lastTimestamp = timestamp;
      }

      rafId = window.requestAnimationFrame(sampleFps);
    };

    rafId = window.requestAnimationFrame(sampleFps);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [displayPosts.length, id, renderWindowSize, shouldVirtualize]);

  useEffect(() => {
    if (!sharedPostId) {
      setHighlightedPostId(null);
      setVirtualFocusIndex(null);
      return;
    }

    const targetIndex = orderedThreadPosts.findIndex(
      (post) => post.id === sharedPostId
    );
    if (targetIndex >= 0) {
      setVisibleCount((current) => Math.max(current, targetIndex + 1));
      setVirtualFocusIndex(targetIndex);
    }
  }, [orderedThreadPosts, sharedPostId]);

  useEffect(() => {
    if (
      !sharedPostId ||
      !displayPosts.some((post) => post.id === sharedPostId)
    ) {
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const frameId = window.requestAnimationFrame(() => {
      const element = document.getElementById(`post-${sharedPostId}`);
      if (!element) {
        return;
      }

      element.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
      setVirtualFocusIndex(null);
      setHighlightedPostId(sharedPostId);
      setReplyContextPostId(
        threadPostMap.get(sharedPostId)?.parentPostId ?? null
      );
      timeoutId = window.setTimeout(() => {
        setHighlightedPostId((current) =>
          current === sharedPostId ? null : current
        );
        setReplyContextPostId((current) =>
          current === threadPostMap.get(sharedPostId)?.parentPostId
            ? null
            : current
        );
      }, 3000);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [displayPosts, sharedPostId, threadPostMap]);

  const jumpToPost = (postId: string) => {
    const targetIndex = orderedThreadPosts.findIndex(
      (post) => post.id === postId
    );
    if (targetIndex >= 0) {
      setVisibleCount((current) => Math.max(current, targetIndex + 1));
      setVirtualFocusIndex(targetIndex);
    }

    window.requestAnimationFrame(() => {
      const element = document.getElementById(`post-${postId}`);
      if (!element) {
        return;
      }

      element.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
      setVirtualFocusIndex(null);
      setHighlightedPostId(postId);
      window.setTimeout(() => {
        setHighlightedPostId((current) =>
          current === postId ? null : current
        );
      }, 3000);
    });
  };

  const handleShareThread = async () => {
    if (!id || !subTopic || typeof window === 'undefined') {
      return;
    }

    const copied = await copyToClipboard(buildThreadShareLink(id));
    if (!copied) {
      setModerationFeedback('Unable to copy thread link to clipboard.');
      return;
    }

    setIsThreadShareCopied(true);
    setModerationFeedback('Thread link copied to clipboard.');
    window.setTimeout(() => {
      setIsThreadShareCopied(false);
      setModerationFeedback((current) =>
        current === 'Thread link copied to clipboard.' ? null : current
      );
    }, 2400);
  };

  useEffect(() => {
    if (!canLoadMore || !loadMoreRef.current) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting) {
          return;
        }

        setVisibleCount((current) =>
          Math.min(current + THREAD_BATCH_SIZE, regularThreadPosts.length)
        );
      },
      {
        root: null,
        rootMargin: '280px 0px',
        threshold: 0.1,
      }
    );

    observer.observe(loadMoreRef.current);
    return () => {
      observer.disconnect();
    };
  }, [canLoadMore, regularThreadPosts.length]);

  if (!isAuthReady && !subTopic && subTopics.length === 0) {
    return <ThreadSkeleton />;
  }

  if (!subTopic) {
    return (
      <div className="space-y-4">
        <h2 className="text-ui-strong text-lg font-semibold">
          Thread not found
        </h2>
        <Link to="/" className="forum-link text-sm font-medium">
          Back to topics
        </Link>
      </div>
    );
  }

  if (subTopic.visibility === 'hidden' && !canModerate) {
    return (
      <div className="space-y-4">
        <h2 className="text-ui-strong text-lg font-semibold">
          Thread not available
        </h2>
        <p className="text-ui-muted text-sm">This sub-topic is hidden.</p>
        <Link
          to={`/topic/${subTopic.topicId}`}
          className="forum-link text-sm font-medium"
        >
          Back to topics
        </Link>
      </div>
    );
  }

  if (!hasSubTopicAccess && !canModerate) {
    return (
      <div className="space-y-4">
        <h2 className="text-ui-strong text-lg font-semibold">
          Thread not available
        </h2>
        <p className="text-ui-muted text-sm">
          You do not have access to this sub-topic.
        </p>
        <Link
          to={`/topic/${subTopic.topicId}`}
          className="forum-link text-sm font-medium"
        >
          Back to topics
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-2 text-sm"
      >
        <Link to="/" className="forum-link text-sm font-semibold">
          Home
        </Link>
        {parentTopic ? (
          <>
            <span className="text-ui-muted">/</span>
            <Link
              to={`/topic/${parentTopic.id}`}
              className="forum-link text-sm font-semibold"
            >
              {parentTopic.title}
            </Link>
          </>
        ) : null}
        <span className="text-ui-muted">/</span>
        <span className="text-ui-strong font-semibold">{subTopic.title}</span>
      </nav>

      <section className="forum-card-primary p-5">
        <h2 className="text-ui-strong text-2xl font-semibold">
          {subTopic.isPinned ? (
            <span className="bg-brand-accent-soft text-brand-accent-strong border-brand-accent mr-3 inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold align-middle">
              Pinned
            </span>
          ) : null}
          {subTopic.isPoll ? (
            <span className="mr-3 inline-flex items-center rounded-md border border-cyan-300 bg-cyan-50 px-2.5 py-1 text-xs font-semibold text-cyan-800 align-middle">
              Poll / Voting
            </span>
          ) : null}
          {subTopic.title}
        </h2>
        <p className="text-ui-muted mt-1 text-sm">{subTopic.description}</p>
        <p className="text-ui-muted mt-2 text-xs">
          {hasActiveSearch
            ? `${filteredThreadPosts.length} matching posts in this thread`
            : `${threadPosts.length} posts in this thread`}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="bg-brand-primary-soft text-brand-primary-strong border-brand-primary rounded-md border px-2 py-1 text-xs font-semibold">
            {subTopic.status === 'locked' ? 'Locked' : 'Open'}
          </span>
          {subTopic.isPinned ? (
            <span className="bg-brand-primary-soft text-brand-primary-strong border-brand-primary rounded-md border px-2 py-1 text-xs font-semibold">
              Pinned
            </span>
          ) : null}
          {subTopic.isPoll ? (
            <span className="rounded-md border border-cyan-300 bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-800">
              Poll / Voting
            </span>
          ) : null}
          {subTopic.isSolved ? (
            <span className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
              Solved
            </span>
          ) : null}
          {subTopic.access !== 'everyone' ? (
            <span className="bg-brand-accent-soft text-brand-accent-strong border-brand-accent rounded-md border px-2 py-1 text-xs font-semibold">
              Access: {resolveAccessLabel(subTopic.access)}
            </span>
          ) : null}
          {subTopic.visibility === 'hidden' ? (
            <span className="bg-brand-accent-soft text-brand-accent-strong border-brand-accent rounded-md border px-2 py-1 text-xs font-semibold">
              Hidden
            </span>
          ) : null}
          {canManageSubTopicAdvanced ? (
            <>
              <button
                type="button"
                onClick={handleToggleSubTopicPin}
                className="bg-surface-card text-ui-strong rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold"
              >
                {subTopic.isPinned ? 'Unpin Sub-Topic' : 'Pin Sub-Topic'}
              </button>
              <button
                type="button"
                onClick={handleToggleSubTopicVisibility}
                className="bg-surface-card text-ui-strong rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold"
              >
                {subTopic.visibility === 'hidden'
                  ? 'Show Sub-Topic'
                  : 'Hide Sub-Topic'}
              </button>
            </>
          ) : null}
          {isAuthenticated && canLockSubTopic ? (
            <button
              type="button"
              onClick={handleToggleSubTopicStatus}
              className="bg-surface-card text-ui-strong rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold"
            >
              {subTopic.status === 'locked'
                ? 'Unlock Sub-Topic'
                : 'Lock Sub-Topic'}
            </button>
          ) : null}
          {isAuthenticated && canLockSubTopic ? (
            <button
              type="button"
              onClick={handleToggleSubTopicSolved}
              className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700"
            >
              {subTopic.isSolved ? 'Clear Solved' : 'Mark as Solved'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void handleShareThread()}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 transition active:scale-95"
          >
            <ShareIcon />
            <span>{isThreadShareCopied ? 'Copied' : 'Share Thread'}</span>
          </button>
          <button
            type="button"
            onClick={() =>
              setPostSortMode((current) =>
                current === 'oldest' ? 'newest' : 'oldest'
              )
            }
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
          >
            {postSortMode === 'oldest'
              ? 'Show Newest First'
              : 'Show Oldest First'}
          </button>
          <button
            type="button"
            onClick={openNewPostComposer}
            disabled={isComposerDisabled}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add New Post
          </button>
        </div>
        {subTopic.lastModerationReason ? (
          <p className="text-ui-muted mt-2 text-xs">
            Moderation note: {subTopic.lastModerationReason}
          </p>
        ) : null}
      </section>

      {feedback ? (
        <p
          className={
            feedback.toLowerCase().includes('copied')
              ? 'fixed right-4 top-24 z-50 inline-flex items-center rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-lg'
              : 'text-ui-muted text-xs'
          }
        >
          {feedback}
        </p>
      ) : null}
      {moderationFeedback ? (
        <p
          className={
            moderationFeedback.toLowerCase().includes('copied')
              ? 'fixed right-4 top-24 z-50 inline-flex items-center rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-lg'
              : 'text-ui-muted text-xs'
          }
        >
          {moderationFeedback}
        </p>
      ) : null}
      {threadLoadError ? (
        <p className="text-ui-muted text-xs">{threadLoadError}</p>
      ) : null}
      <QortTipModal
        isOpen={isTipModalOpen}
        isSending={isSendingTip}
        isResolvingRecipient={isResolvingTipRecipient}
        isBalanceLoading={isTipBalanceLoading}
        amount={tipAmount}
        formattedBalance={formattedTipBalance}
        recipientName={tipRecipientName}
        recipientAddress={tipRecipientAddress}
        resolveError={tipResolveError}
        onClose={closeTipModal}
        onAmountChange={setTipAmount}
        onSend={() => void submitTip()}
      />
      {isThreadPostsLoading ? (
        <p className="text-ui-muted text-xs">Loading thread data from QDN...</p>
      ) : null}

      <section className="forum-card p-4">
        <label
          htmlFor="thread-local-search"
          className="text-ui-strong text-sm font-semibold"
        >
          Search This Thread
        </label>
        <p className="text-ui-muted mt-1 text-xs">
          Filters posts in this thread only. Matching words are highlighted.
        </p>
        <input
          id="thread-local-search"
          type="search"
          value={threadSearchQuery}
          onChange={(event) => setThreadSearchQuery(event.target.value)}
          placeholder="Search posts in this thread"
          className="bg-surface-card text-ui-strong placeholder:text-ui-muted mt-3 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
        />
      </section>

      {pinnedThreadPosts.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h3 className="text-ui-strong text-sm font-semibold">
              Pinned Posts
            </h3>
            <p className="text-ui-muted mt-1 text-xs">
              Highlighted posts from this thread.
            </p>
          </div>
          {pinnedThreadPosts.map((post) => (
            <ThreadPostCard
              key={`pinned-${post.id}`}
              post={post}
              searchQuery={deferredSearchQuery}
              author={userMap.get(post.authorUserId)}
              authorRole={authorRolesByUserId[post.authorUserId] ?? 'Member'}
              repliedPost={
                post.parentPostId
                  ? (threadPostMap.get(post.parentPostId) ?? null)
                  : null
              }
              repliedAuthorName={
                post.parentPostId
                  ? resolveAuthorDisplayName(
                      threadPostMap.get(post.parentPostId)?.authorUserId ?? ''
                    )
                  : null
              }
              highlighted={highlightedPostId === post.id}
              replyContextHighlighted={replyContextPostId === post.parentPostId}
              isOwner={post.authorUserId === currentUser.id}
              canModerate={canDeletePosts}
              hasLiked={
                likeActorId
                  ? post.likedByAddresses.includes(likeActorId)
                  : false
              }
              tipCount={post.tips}
              pollVoterId={pollVoterId}
              canClosePoll={canModerate}
              onLike={likePost}
              onVoteOnPoll={handleVoteOnPoll}
              onClosePoll={handleClosePoll}
              onReply={openReplyComposer}
              onShare={handleSharePost}
              onSendTip={handleSendTip}
              onJumpToPost={jumpToPost}
              onEdit={openEditComposer}
              onDelete={handleDeletePost}
              onTogglePin={handleTogglePostPin}
            />
          ))}
        </section>
      ) : null}

      <section ref={postListRef} className="space-y-3">
        {topSpacerHeight > 0 ? (
          <div style={{ height: topSpacerHeight }} aria-hidden="true" />
        ) : null}
        {renderedPosts.map((post) => (
          <ThreadPostCard
            key={post.id}
            post={post}
            searchQuery={deferredSearchQuery}
            author={userMap.get(post.authorUserId)}
            authorRole={authorRolesByUserId[post.authorUserId] ?? 'Member'}
            repliedPost={
              post.parentPostId
                ? (threadPostMap.get(post.parentPostId) ?? null)
                : null
            }
            repliedAuthorName={
              post.parentPostId
                ? resolveAuthorDisplayName(
                    threadPostMap.get(post.parentPostId)?.authorUserId ?? ''
                  )
                : null
            }
            highlighted={highlightedPostId === post.id}
            replyContextHighlighted={replyContextPostId === post.parentPostId}
            isOwner={post.authorUserId === currentUser.id}
            canModerate={canDeletePosts}
            hasLiked={
              likeActorId ? post.likedByAddresses.includes(likeActorId) : false
            }
            tipCount={post.tips}
            pollVoterId={pollVoterId}
            canClosePoll={canModerate}
            onLike={likePost}
            onVoteOnPoll={handleVoteOnPoll}
            onClosePoll={handleClosePoll}
            onReply={openReplyComposer}
            onShare={handleSharePost}
            onSendTip={handleSendTip}
            onJumpToPost={jumpToPost}
            onEdit={openEditComposer}
            onDelete={handleDeletePost}
            onTogglePin={handleTogglePostPin}
          />
        ))}
        {bottomSpacerHeight > 0 ? (
          <div style={{ height: bottomSpacerHeight }} aria-hidden="true" />
        ) : null}
        {canLoadMore ? (
          <div ref={loadMoreRef} className="h-6 w-full" aria-hidden="true" />
        ) : null}
        {shouldShowThreadEmptyState ? (
          <div className="forum-card p-5">
            <p className="text-ui-strong text-sm font-semibold">
              {hasActiveThreadSearch ? 'No matching posts' : 'No posts yet'}
            </p>
            <p className="text-ui-muted mt-1 text-sm">
              {hasActiveThreadSearch
                ? 'Adjust the forum search field to search this thread differently.'
                : 'This thread does not have any published posts yet.'}
            </p>
          </div>
        ) : null}
      </section>

      <PostComposerModal
        isOpen={isComposerOpen}
        title={composerTitle}
        placeholder={composerPlaceholder}
        submitLabel={composerSubmitLabel}
        replyText={replyText}
        replyAttachments={replyAttachments}
        pollDraft={pollDraft}
        canAddPoll={Boolean(subTopic?.isPoll && !replyTarget)}
        replyTargetAuthorName={
          replyTarget
            ? resolveAuthorDisplayName(replyTarget.authorUserId)
            : null
        }
        replyTargetContent={replyTarget?.content ?? null}
        onReplyTextChange={setReplyText}
        onReplyAttachmentsChange={setReplyAttachments}
        onPollDraftChange={setPollDraft}
        onSubmit={handleSubmitReply}
        onUploadImage={uploadImageForReply}
        onUploadAttachment={uploadAttachmentForReply}
        onUploadVideo={uploadVideoForReply}
        onCancelReplyTarget={handleCancelReplyTarget}
        onClose={closeComposerModal}
        disabled={isComposerDisabled}
        helperText={composerHelperText}
      />
      <PostEditModal
        isOpen={Boolean(editingPost)}
        editText={editText}
        editAttachments={editAttachments}
        onEditTextChange={setEditText}
        onEditAttachmentsChange={setEditAttachments}
        onSubmit={submitPostEdit}
        onUploadImage={uploadImageForReply}
        onUploadAttachment={uploadAttachmentForReply}
        onUploadVideo={uploadVideoForReply}
        onClose={closeEditComposer}
      />
    </div>
  );
};

export default ThreadPage;
