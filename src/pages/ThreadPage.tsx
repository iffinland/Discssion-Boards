import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import ShareIcon from '../components/common/ShareIcon';
import AccessDisclosureNotice from '../components/forum/AccessDisclosureNotice';
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
  getPollSearchParts,
  searchThreadPosts,
  tokenizeSearchQuery,
} from '../services/forum/forumSearch';
import {
  canAccessSubTopic,
  HIDDEN_CONTENT_NOTICE,
  resolveAccessLabel,
} from '../services/forum/forumAccess';
import { resolveRoleForAddress } from '../services/qdn/forumRolesService';
import {
  buildThreadShareLink,
  copyToClipboard,
} from '../services/qortium/share';
import { resolveNameWalletAddress } from '../services/qortium/walletService';
import { perfDebugLog, perfDebugTimeStart } from '../services/perf/perfDebug';
import { isNativePostPoll } from '../services/architectureV2/polls.js';
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
  const { t } = useTranslation();
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
    resolvePostTipRecipient,
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
    isTipRecoveryPending,
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
    resolvePostTipRecipient,
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
                ...getPollSearchParts(post.poll),
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
  const incompleteThreadData = threadPosts.some(
    (post) =>
      post.dataAvailability === 'partial' ||
      post.dataAvailability === 'cached-last-known-good' ||
      post.dataAvailability === 'index-only'
  );
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
    ? t('access.cannotPost')
    : subTopic?.visibility === 'hidden'
      ? t('thread.hiddenNotice')
      : subTopic?.status === 'locked'
        ? t('access.threadLocked')
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
        ? t('thread.statusUpdated')
        : (result.error ?? t('thread.updateFailed'))
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
        ? t('thread.visibilityUpdated')
        : (result.error ?? t('thread.updateFailed'))
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
          ? t('thread.unpinned')
          : t('thread.pinnedTop')
        : (result.error ?? t('thread.updateFailed'))
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
          ? t('thread.solvedCleared')
          : t('thread.markedSolved')
        : (result.error ?? t('thread.solvedFailed'))
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

    if (
      !canModerate &&
      (!hasSubTopicAccess || subTopic.visibility === 'hidden')
    ) {
      setHasInitialThreadLoadCompleted(true);
      setThreadLoadError(null);
      return;
    }

    let active = true;
    void loadThreadPosts(id).then((result) => {
      if (!active) {
        return;
      }
      setHasInitialThreadLoadCompleted(true);
      setThreadLoadError(
        result.ok ? null : (result.error ?? t('thread.postsLoadFailed'))
      );
    });

    return () => {
      active = false;
    };
  }, [canModerate, hasSubTopicAccess, id, loadThreadPosts, subTopic, t]);

  const shouldShowThreadEmptyState =
    hasInitialThreadLoadCompleted &&
    !isThreadPostsLoading &&
    !threadLoadError &&
    displayPosts.length === 0 &&
    pinnedThreadPosts.length === 0;
  const isCreatingFirstPost =
    threadPosts.length === 0 && !replyTarget && isComposerOpen;
  const composerTitle = replyTarget
    ? t('post.reply')
    : isCreatingFirstPost
      ? t('post.addFirst')
      : t('post.add');
  const composerPlaceholder = isCreatingFirstPost
    ? t('post.firstPlaceholder')
    : t('post.placeholder');
  const composerSubmitLabel = isCreatingFirstPost
    ? t('post.publishFirst')
    : replyTarget
      ? t('post.publishReply')
      : t('post.publish');

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
      setModerationFeedback(t('post.contentRequired'));
      return false;
    }

    return handleEditPost(editingPost.id, value, editAttachments);
  }, [editAttachments, editText, editingPost, handleEditPost, t]);

  const handleTogglePostPin = useCallback(
    async (post: Post) => {
      const result = await togglePostPin(post.id);
      if (!result.ok) {
        setModerationFeedback(result.error ?? t('post.pinUpdateFailed'));
        return;
      }

      setModerationFeedback(
        post.isPinned ? t('post.unpinned') : t('post.pinned')
      );
      window.setTimeout(() => {
        setModerationFeedback((current) =>
          current === t('post.pinned') || current === t('post.unpinned')
            ? null
            : current
        );
      }, 2400);
    },
    [t, togglePostPin]
  );

  const handleVoteOnPoll = async (postId: string, optionIds: string[]) => {
    const result = await voteOnPoll({ postId, optionIds });
    if (!result.ok) {
      setModerationFeedback(result.error ?? t('poll.voteFailed'));
      return;
    }

    setModerationFeedback(t('poll.voteSubmitted'));
    window.setTimeout(() => {
      setModerationFeedback((current) =>
        current === t('poll.voteSubmitted') ? null : current
      );
    }, 2400);
  };

  const handleClosePoll = async (postId: string) => {
    const result = await closePoll({ postId });
    if (!result.ok) {
      setModerationFeedback(result.error ?? t('poll.closeFailed'));
      return;
    }

    setModerationFeedback(t('poll.closureScheduled'));
    window.setTimeout(() => {
      setModerationFeedback((current) =>
        current === t('poll.closureScheduled') ? null : current
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
      setModerationFeedback(t('thread.linkCopyFailed'));
      return;
    }

    setIsThreadShareCopied(true);
    setModerationFeedback(t('thread.linkCopied'));
    window.setTimeout(() => {
      setIsThreadShareCopied(false);
      setModerationFeedback((current) =>
        current === t('thread.linkCopied') ? null : current
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
          {t('thread.notFound')}
        </h2>
        <Link to="/" className="forum-link text-sm font-medium">
          {t('thread.backTopics')}
        </Link>
      </div>
    );
  }

  if (subTopic.visibility === 'hidden' && !canModerate) {
    return (
      <div className="space-y-4">
        <h2 className="text-ui-strong text-lg font-semibold">
          {t('thread.unavailable')}
        </h2>
        <p className="text-ui-muted text-sm">{t('thread.hiddenNotice')}</p>
        <AccessDisclosureNotice kind="hidden" />
        <Link
          to={`/topic/${subTopic.topicId}`}
          className="forum-link text-sm font-medium"
        >
          {t('thread.backTopics')}
        </Link>
      </div>
    );
  }

  if (!hasSubTopicAccess && !canModerate) {
    return (
      <div className="space-y-4">
        <h2 className="text-ui-strong text-lg font-semibold">
          {t('thread.unavailable')}
        </h2>
        <p className="text-ui-muted text-sm">{t('thread.restrictedNotice')}</p>
        <Link
          to={`/topic/${subTopic.topicId}`}
          className="forum-link text-sm font-medium"
        >
          {t('thread.backTopics')}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AccessDisclosureNotice kind="restricted" access={subTopic.access} />
      {subTopic.visibility === 'hidden' ? (
        <AccessDisclosureNotice kind="hidden" />
      ) : null}
      {incompleteThreadData ? (
        <div
          role="status"
          className="forum-card border-amber-300 bg-amber-50/70 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-200"
        >
          {t('thread.partialData')}
        </div>
      ) : null}
      <nav
        aria-label={t('navigation.breadcrumb')}
        className="flex flex-wrap items-center gap-2 text-sm"
      >
        <Link to="/" className="forum-link text-sm font-semibold">
          {t('navigation.home')}
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
              {t('thread.pinned')}
            </span>
          ) : null}
          {subTopic.isPoll ? (
            <span className="mr-3 inline-flex items-center rounded-md border border-cyan-300 bg-cyan-50 px-2.5 py-1 text-xs font-semibold text-cyan-800 align-middle">
              {t('thread.poll')}
            </span>
          ) : null}
          {subTopic.title}
        </h2>
        <p className="text-ui-muted mt-1 text-sm">{subTopic.description}</p>
        <p className="text-ui-muted mt-2 text-xs">
          {hasActiveSearch
            ? t('thread.matchingPosts', { count: filteredThreadPosts.length })
            : t('thread.postCount', { count: threadPosts.length })}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="bg-brand-primary-soft text-brand-primary-strong border-brand-primary rounded-md border px-2 py-1 text-xs font-semibold">
            {subTopic.status === 'locked'
              ? t('common.locked')
              : t('common.open')}
          </span>
          {subTopic.isPinned ? (
            <span className="bg-brand-primary-soft text-brand-primary-strong border-brand-primary rounded-md border px-2 py-1 text-xs font-semibold">
              {t('thread.pinned')}
            </span>
          ) : null}
          {subTopic.isPoll ? (
            <span className="rounded-md border border-cyan-300 bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-800">
              {t('thread.poll')}
            </span>
          ) : null}
          {subTopic.isSolved ? (
            <span className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
              {t('thread.solved')}
            </span>
          ) : null}
          {subTopic.access !== 'everyone' ? (
            <span className="bg-brand-accent-soft text-brand-accent-strong border-brand-accent rounded-md border px-2 py-1 text-xs font-semibold">
              {t('thread.access', {
                access: resolveAccessLabel(subTopic.access),
              })}
            </span>
          ) : null}
          {subTopic.visibility === 'hidden' ? (
            <span className="bg-brand-accent-soft text-brand-accent-strong border-brand-accent rounded-md border px-2 py-1 text-xs font-semibold">
              {t('common.hidden')}
            </span>
          ) : null}
          {canManageSubTopicAdvanced ? (
            <>
              <button
                type="button"
                onClick={handleToggleSubTopicPin}
                className="bg-surface-card text-ui-strong rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold"
              >
                {subTopic.isPinned
                  ? t('thread.unpinSubTopic')
                  : t('thread.pinSubTopic')}
              </button>
              <button
                type="button"
                onClick={handleToggleSubTopicVisibility}
                title={HIDDEN_CONTENT_NOTICE}
                className="bg-surface-card text-ui-strong rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold"
              >
                {subTopic.visibility === 'hidden'
                  ? t('thread.showSubTopic')
                  : t('thread.hideSubTopic')}
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
                ? t('thread.unlockSubTopic')
                : t('thread.lockSubTopic')}
            </button>
          ) : null}
          {isAuthenticated && canLockSubTopic ? (
            <button
              type="button"
              onClick={handleToggleSubTopicSolved}
              className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700"
            >
              {subTopic.isSolved
                ? t('thread.clearSolved')
                : t('thread.markSolved')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void handleShareThread()}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 transition active:scale-95"
          >
            <ShareIcon />
            <span>
              {isThreadShareCopied ? t('common.copied') : t('thread.share')}
            </span>
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
              ? t('thread.newestFirst')
              : t('thread.oldestFirst')}
          </button>
          <button
            type="button"
            onClick={openNewPostComposer}
            disabled={isComposerDisabled}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('post.add')}
          </button>
        </div>
        {subTopic.lastModerationReason ? (
          <p className="text-ui-muted mt-2 text-xs">
            {t('thread.moderationNote', {
              reason: subTopic.lastModerationReason,
            })}
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
        isRecoveryPending={isTipRecoveryPending}
        onClose={closeTipModal}
        onAmountChange={setTipAmount}
        onSend={() => void submitTip()}
      />
      {isThreadPostsLoading ? (
        <p className="text-ui-muted text-xs">{t('thread.loadingQdn')}</p>
      ) : null}

      <section className="forum-card p-4">
        <label
          htmlFor="thread-local-search"
          className="text-ui-strong text-sm font-semibold"
        >
          {t('search.threadLabel')}
        </label>
        <p className="text-ui-muted mt-1 text-xs">{t('search.threadHelp')}</p>
        <input
          id="thread-local-search"
          type="search"
          value={threadSearchQuery}
          onChange={(event) => setThreadSearchQuery(event.target.value)}
          placeholder={t('search.threadPlaceholder')}
          className="bg-surface-card text-ui-strong placeholder:text-ui-muted mt-3 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
        />
      </section>

      {pinnedThreadPosts.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h3 className="text-ui-strong text-sm font-semibold">
              {t('thread.pinnedPosts')}
            </h3>
            <p className="text-ui-muted mt-1 text-xs">
              {t('thread.pinnedPostsHelp')}
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
              pollVoterId={pollVoterId}
              canClosePoll={Boolean(
                isNativePostPoll(post.poll) &&
                  authenticatedAddress &&
                  post.poll.creatorAddress === authenticatedAddress
              )}
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
            pollVoterId={pollVoterId}
            canClosePoll={Boolean(
              isNativePostPoll(post.poll) &&
                authenticatedAddress &&
                post.poll.creatorAddress === authenticatedAddress
            )}
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
              {hasActiveThreadSearch
                ? t('thread.noMatchingPosts')
                : t('thread.noPosts')}
            </p>
            <p className="text-ui-muted mt-1 text-sm">
              {hasActiveThreadSearch
                ? t('thread.adjustSearch')
                : t('thread.noPostsHelp')}
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
