import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import AccessDisclosureNotice from '../components/forum/AccessDisclosureNotice';
import SubTopicList from '../components/forum/SubTopicList';
import { useForumActions, useForumData } from '../hooks/useForumData';
import {
  canAccessSubTopic,
  resolveAccessLabel,
} from '../services/forum/forumAccess';
import {
  clearThreadQuarantine,
  isThreadQuarantined,
} from '../services/forum/threadLoadQuarantine';
import { forumSearchIndexService } from '../services/qdn/forumSearchIndexService';
import {
  loadThreadIndexCached,
  readThreadIndexCache,
} from '../services/qdn/threadIndexCache';
import {
  buildTopicShareLink,
  copyToClipboard,
} from '../services/qortium/share';
import { getAccountNames } from '../services/qortium/walletService';
import { perfDebugTimeStart } from '../services/perf/perfDebug';
import { getPollSearchParts } from '../services/forum/forumSearch';
import type { SubTopic, TopicAccess } from '../types';

type TopicPageProps = {
  onSearchQueryChange: (value: string) => void;
};

const TOPIC_DESCRIPTION_MAX_LENGTH = 250;
const INITIAL_POST_COUNT_BATCH_SIZE = 8;
const POST_COUNT_BATCH_SIZE = 6;
const INITIAL_ADDRESS_BATCH_SIZE = 8;
const ADDRESS_BATCH_SIZE = 6;

const reorderList = <T,>(items: T[], fromIndex: number, toIndex: number) => {
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
};

const sortSubTopics = (items: SubTopic[]) =>
  [...items].sort((a, b) => {
    if (a.isPinned !== b.isPinned) {
      return a.isPinned ? -1 : 1;
    }

    if (a.isPinned && b.isPinned) {
      if (
        typeof a.moderationOrder === 'number' ||
        typeof b.moderationOrder === 'number'
      ) {
        return (
          (a.moderationOrder ?? Number.MAX_SAFE_INTEGER) -
          (b.moderationOrder ?? Number.MAX_SAFE_INTEGER)
        );
      }
      const aPinnedAt = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
      const bPinnedAt = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;
      if (aPinnedAt !== bPinnedAt) {
        return aPinnedAt - bPinnedAt;
      }
    }

    return new Date(b.lastPostAt).getTime() - new Date(a.lastPostAt).getTime();
  });

const canCreateSubTopicForTopic = (
  topicAccess: TopicAccess,
  topicStatus: SubTopic['status'] | 'open' | 'locked',
  role: 'SysOp' | 'SuperAdmin' | 'Admin' | 'Moderator' | 'Member',
  address: string | null,
  allowedAddresses: string[]
) => {
  if (role === 'SysOp' || role === 'SuperAdmin' || role === 'Admin') {
    return true;
  }

  if (topicStatus === 'locked') {
    return false;
  }

  switch (topicAccess) {
    case 'everyone':
      return true;
    case 'moderators':
      return role === 'Moderator';
    case 'admins':
      return false;
    case 'custom':
      return Boolean(address && allowedAddresses.includes(address));
    default:
      return false;
  }
};

const TopicPage = ({ onSearchQueryChange }: TopicPageProps) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    users,
    currentUser,
    authenticatedAddress,
    topics,
    subTopics,
    posts,
    threadSearchIndexes,
  } = useForumData();
  const { createSubTopic, updateSubTopicSettings, reorderPinnedSubTopics } =
    useForumActions();
  const [walletNamesByAddress, setWalletNamesByAddress] = useState<
    Record<string, string>
  >({});
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createFeedback, setCreateFeedback] = useState<string | null>(null);
  const [subTopicTitle, setSubTopicTitle] = useState('');
  const [subTopicDescription, setSubTopicDescription] = useState('');
  const [subTopicIsPoll, setSubTopicIsPoll] = useState(false);
  const [managementFeedback, setManagementFeedback] = useState<string | null>(
    null
  );
  const [isTopicShareCopied, setIsTopicShareCopied] = useState(false);
  const [managedSubTopicId, setManagedSubTopicId] = useState<string | null>(
    null
  );
  const [managedSubTopicTopicId, setManagedSubTopicTopicId] = useState('');
  const [managedSubTopicTitle, setManagedSubTopicTitle] = useState('');
  const [managedSubTopicDescription, setManagedSubTopicDescription] =
    useState('');
  const [managedSubTopicStatus, setManagedSubTopicStatus] = useState<
    'open' | 'locked'
  >('open');
  const [managedSubTopicVisibility, setManagedSubTopicVisibility] = useState<
    'visible' | 'hidden'
  >('visible');
  const [managedSubTopicAccess, setManagedSubTopicAccess] =
    useState<TopicAccess>('everyone');
  const [managedSubTopicIsPoll, setManagedSubTopicIsPoll] = useState(false);
  const [managedSubTopicAllowedAddresses, setManagedSubTopicAllowedAddresses] =
    useState('');
  const [topicSearchQuery, setTopicSearchQuery] = useState('');
  const [draggedPinnedSubTopicId, setDraggedPinnedSubTopicId] = useState<
    string | null
  >(null);
  const [dragOverPinnedSubTopicId, setDragOverPinnedSubTopicId] = useState<
    string | null
  >(null);
  const [fetchedPostCountsBySubTopicId, setFetchedPostCountsBySubTopicId] =
    useState<Record<string, number>>({});
  const requestedWalletAddressesRef = useRef<Set<string>>(new Set());
  const requestedPostCountsRef = useRef<Set<string>>(new Set());

  const topic = useMemo(
    () => topics.find((item) => item.id === id),
    [id, topics]
  );
  const topicId = topic?.id ?? null;
  const canModerate = currentUser.role !== 'Member';
  const canManageSubTopics =
    currentUser.role === 'SysOp' ||
    currentUser.role === 'SuperAdmin' ||
    currentUser.role === 'Admin';
  const canReorderPinnedSubTopics =
    (currentUser.role === 'SysOp' ||
      currentUser.role === 'SuperAdmin' ||
      currentUser.role === 'Admin') &&
    topicSearchQuery.trim().length === 0;
  const canCreateHere = topic
    ? canCreateSubTopicForTopic(
        topic.subTopicAccess,
        topic.status,
        currentUser.role,
        authenticatedAddress,
        topic.allowedAddresses
      )
    : false;

  const visibleSubTopics = useMemo(() => {
    if (!topic || (!canModerate && topic.visibility === 'hidden')) {
      return [];
    }

    const normalizedSearch = topicSearchQuery.trim().toLowerCase();
    const byTopic = subTopics.filter(
      (subTopic) => subTopic.topicId === topic.id
    );
    const allowed = byTopic.filter(
      (subTopic) =>
        (canModerate ||
          canAccessSubTopic(subTopic, currentUser, authenticatedAddress)) &&
        (canModerate || subTopic.visibility !== 'hidden')
    );

    if (!normalizedSearch) {
      return sortSubTopics(allowed);
    }

    return sortSubTopics(
      allowed.filter((subTopic) => {
        const authorName =
          users.find((user) => user.id === subTopic.authorUserId)
            ?.displayName ?? '';
        const indexedPostText =
          threadSearchIndexes[subTopic.id]?.posts
            .map((post) =>
              [post.content, ...getPollSearchParts(post.poll)].join(' ')
            )
            .join(' ') ?? '';
        const localPostText = posts
          .filter((post) => post.subTopicId === subTopic.id)
          .map((post) =>
            [post.content, ...getPollSearchParts(post.poll)].join(' ')
          )
          .join(' ');
        const haystack =
          `${subTopic.title} ${subTopic.description} ${authorName} ${indexedPostText} ${localPostText}`.toLowerCase();
        return haystack.includes(normalizedSearch);
      })
    );
  }, [
    topic,
    topicSearchQuery,
    subTopics,
    canModerate,
    currentUser,
    authenticatedAddress,
    users,
    posts,
    threadSearchIndexes,
  ]);
  const pinnedSubTopicIds = useMemo(
    () =>
      visibleSubTopics
        .filter((subTopic) => subTopic.isPinned)
        .map((subTopic) => subTopic.id),
    [visibleSubTopics]
  );
  const visibleWalletAddresses = useMemo(() => {
    const seen = new Set<string>();
    const next: string[] = [];

    const pushAddress = (value: string | null | undefined) => {
      const normalized = value?.trim();
      if (!normalized || seen.has(normalized)) {
        return;
      }

      seen.add(normalized);
      next.push(normalized);
    };

    topic?.allowedAddresses.forEach(pushAddress);
    visibleSubTopics.forEach((subTopic) => {
      subTopic.allowedAddresses.slice(0, 3).forEach(pushAddress);
    });

    return next;
  }, [topic, visibleSubTopics]);
  const localPostCountsBySubTopicId = useMemo(() => {
    const countsBySubTopicId: Record<string, number> = {};

    posts.forEach((post) => {
      countsBySubTopicId[post.subTopicId] =
        (countsBySubTopicId[post.subTopicId] ?? 0) + 1;
    });

    Object.entries(threadSearchIndexes).forEach(([subTopicId, snapshot]) => {
      const indexedCount = snapshot.posts.length;
      const currentCount = countsBySubTopicId[subTopicId] ?? 0;
      countsBySubTopicId[subTopicId] = Math.max(currentCount, indexedCount);
    });

    return countsBySubTopicId;
  }, [posts, threadSearchIndexes]);
  const postCountsBySubTopicId = useMemo(() => {
    const merged: Record<string, number> = { ...fetchedPostCountsBySubTopicId };
    Object.entries(localPostCountsBySubTopicId).forEach(
      ([subTopicId, count]) => {
        merged[subTopicId] = Math.max(merged[subTopicId] ?? 0, count);
      }
    );
    return merged;
  }, [fetchedPostCountsBySubTopicId, localPostCountsBySubTopicId]);
  const quarantinedSubTopicIds = useMemo(
    () =>
      Object.fromEntries(
        visibleSubTopics
          .filter((subTopic) => isThreadQuarantined(subTopic.id))
          .map((subTopic) => [subTopic.id, true] as const)
      ),
    [visibleSubTopics]
  );

  useEffect(() => {
    if (!topic) {
      return;
    }

    let active = true;
    const missingAddresses = visibleWalletAddresses.filter(
      (address) =>
        !walletNamesByAddress[address] &&
        !requestedWalletAddressesRef.current.has(address)
    );

    if (missingAddresses.length === 0) {
      return () => {
        active = false;
      };
    }

    missingAddresses.forEach((address) => {
      requestedWalletAddressesRef.current.add(address);
    });

    const maybeWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    const resolveAddressBatch = async (batch: string[]) => {
      const resolvedEntries = await Promise.all(
        batch.map(async (address) => {
          try {
            const names = await getAccountNames(address);
            const primary = names.find((entry) => entry.trim())?.trim();
            return [address, primary ?? ''] as const;
          } catch {
            return [address, ''] as const;
          }
        })
      );

      if (!active) {
        return;
      }

      const nextResolved = Object.fromEntries(
        resolvedEntries.filter((entry) => Boolean(entry[1].trim()))
      );
      if (Object.keys(nextResolved).length === 0) {
        return;
      }

      setWalletNamesByAddress((current) => ({
        ...current,
        ...nextResolved,
      }));
    };

    const loadMissingNames = async () => {
      const endTiming = perfDebugTimeStart('topic-page-wallet-name-load', {
        topicId: topic.id,
        addressCount: missingAddresses.length,
      });
      const firstBatch = missingAddresses.slice(0, INITIAL_ADDRESS_BATCH_SIZE);
      await resolveAddressBatch(firstBatch);

      for (
        let startIndex = INITIAL_ADDRESS_BATCH_SIZE;
        startIndex < missingAddresses.length && active;
        startIndex += ADDRESS_BATCH_SIZE
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

        await resolveAddressBatch(
          missingAddresses.slice(startIndex, startIndex + ADDRESS_BATCH_SIZE)
        );
      }

      endTiming({
        topicId: topic.id,
        resolvedAddressCount: missingAddresses.length,
      });
    };

    void loadMissingNames();

    return () => {
      active = false;
    };
  }, [topic, visibleWalletAddresses, walletNamesByAddress]);

  useEffect(() => {
    let active = true;
    const nextCachedCounts: Record<string, number> = {};
    const missingSubTopicIds = visibleSubTopics
      .map((subTopic) => subTopic.id)
      .filter((subTopicId) => {
        if (isThreadQuarantined(subTopicId)) {
          nextCachedCounts[subTopicId] =
            localPostCountsBySubTopicId[subTopicId] ?? 0;
          return false;
        }

        if (postCountsBySubTopicId[subTopicId] !== undefined) {
          return false;
        }

        const cachedThreadIndex = readThreadIndexCache(subTopicId);
        if (cachedThreadIndex) {
          nextCachedCounts[subTopicId] = Math.max(
            cachedThreadIndex.posts.length,
            localPostCountsBySubTopicId[subTopicId] ?? 0
          );
          return false;
        }

        return !requestedPostCountsRef.current.has(subTopicId);
      });

    if (Object.keys(nextCachedCounts).length > 0) {
      setFetchedPostCountsBySubTopicId((current) => ({
        ...current,
        ...nextCachedCounts,
      }));
    }

    if (missingSubTopicIds.length === 0) {
      return () => {
        active = false;
      };
    }

    missingSubTopicIds.forEach((subTopicId) => {
      requestedPostCountsRef.current.add(subTopicId);
    });

    const maybeWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    const resolveCountBatch = async (batch: string[]) => {
      const resolvedEntries = await Promise.all(
        batch.map(async (subTopicId) => {
          try {
            const threadIndex = await loadThreadIndexCached(
              subTopicId,
              forumSearchIndexService.loadThreadIndex
            );
            const indexCount = threadIndex?.posts.length ?? 0;
            const localCount = localPostCountsBySubTopicId[subTopicId] ?? 0;
            return [subTopicId, Math.max(indexCount, localCount)] as const;
          } catch {
            return [
              subTopicId,
              localPostCountsBySubTopicId[subTopicId] ?? 0,
            ] as const;
          }
        })
      );

      if (!active) {
        return;
      }

      setFetchedPostCountsBySubTopicId((current) => ({
        ...current,
        ...Object.fromEntries(resolvedEntries),
      }));
    };

    const loadMissingPostCounts = async () => {
      const endTiming = perfDebugTimeStart('topic-page-post-count-load', {
        topicId: topic?.id ?? null,
        subTopicCount: missingSubTopicIds.length,
      });
      await resolveCountBatch(
        missingSubTopicIds.slice(0, INITIAL_POST_COUNT_BATCH_SIZE)
      );

      for (
        let startIndex = INITIAL_POST_COUNT_BATCH_SIZE;
        startIndex < missingSubTopicIds.length && active;
        startIndex += POST_COUNT_BATCH_SIZE
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

        await resolveCountBatch(
          missingSubTopicIds.slice(
            startIndex,
            startIndex + POST_COUNT_BATCH_SIZE
          )
        );
      }

      endTiming({
        topicId: topic?.id ?? null,
        resolvedSubTopicCount: missingSubTopicIds.length,
      });
    };

    void loadMissingPostCounts();

    return () => {
      active = false;
    };
  }, [
    localPostCountsBySubTopicId,
    postCountsBySubTopicId,
    topic?.id,
    visibleSubTopics,
  ]);

  useEffect(() => {
    if (!topicId) {
      return;
    }

    setTopicSearchQuery('');
    onSearchQueryChange('');
  }, [onSearchQueryChange, topicId]);

  const handleOpenThread = (subTopicId: string) => {
    navigate(`/thread/${subTopicId}`);
  };

  const handlePinnedDragStart = (subTopicId: string) => {
    if (!canReorderPinnedSubTopics) {
      return;
    }

    if (!pinnedSubTopicIds.includes(subTopicId)) {
      return;
    }

    setDraggedPinnedSubTopicId(subTopicId);
    setDragOverPinnedSubTopicId(subTopicId);
  };

  const handlePinnedDragOver = (
    subTopicId: string,
    event: DragEvent<HTMLLIElement>
  ) => {
    if (!canReorderPinnedSubTopics) {
      return;
    }

    if (!pinnedSubTopicIds.includes(subTopicId)) {
      return;
    }

    event.preventDefault();
    setDragOverPinnedSubTopicId(subTopicId);
  };

  const handlePinnedDragEnd = () => {
    setDraggedPinnedSubTopicId(null);
    setDragOverPinnedSubTopicId(null);
  };

  const handlePinnedDrop = async (targetSubTopicId: string) => {
    if (
      !topic ||
      !canReorderPinnedSubTopics ||
      !draggedPinnedSubTopicId ||
      !pinnedSubTopicIds.includes(targetSubTopicId)
    ) {
      handlePinnedDragEnd();
      return;
    }

    if (draggedPinnedSubTopicId === targetSubTopicId) {
      handlePinnedDragEnd();
      return;
    }

    const fromIndex = pinnedSubTopicIds.findIndex(
      (subTopicId) => subTopicId === draggedPinnedSubTopicId
    );
    const toIndex = pinnedSubTopicIds.findIndex(
      (subTopicId) => subTopicId === targetSubTopicId
    );
    if (fromIndex < 0 || toIndex < 0) {
      handlePinnedDragEnd();
      return;
    }

    const reorderedPinnedSubTopicIds = reorderList(
      pinnedSubTopicIds,
      fromIndex,
      toIndex
    );
    const result = await reorderPinnedSubTopics({
      topicId: topic.id,
      orderedPinnedSubTopicIds: reorderedPinnedSubTopicIds,
    });
    setManagementFeedback(
      result.ok
        ? 'Pinned sub-topics order updated.'
        : (result.error ?? 'Unable to reorder pinned sub-topics.')
    );
    handlePinnedDragEnd();
  };

  const handleShareTopic = async () => {
    if (!topic) {
      return;
    }

    const copied = await copyToClipboard(buildTopicShareLink(topic.id));
    if (!copied) {
      setManagementFeedback('Unable to copy main topic link to clipboard.');
      return;
    }

    setIsTopicShareCopied(true);
    setManagementFeedback('Main topic link copied to clipboard.');
    window.setTimeout(() => {
      setIsTopicShareCopied(false);
      setManagementFeedback((current) =>
        current === 'Main topic link copied to clipboard.' ? null : current
      );
    }, 2400);
  };

  const handleCreateSubTopic = async () => {
    if (!topic) {
      return;
    }

    const title = subTopicTitle.trim();
    const description = subTopicDescription.trim();
    if (!title || !description) {
      setCreateFeedback('Sub-topic title and description are required.');
      return;
    }

    const createResult = await createSubTopic({
      topicId: topic.id,
      title,
      description,
      access: 'everyone',
      allowedAddresses: [],
      isPoll: subTopicIsPoll,
    });

    if (!createResult.ok || !createResult.subTopicId) {
      setCreateFeedback(createResult.error ?? 'Unable to create sub-topic.');
      return;
    }

    setSubTopicTitle('');
    setSubTopicDescription('');
    setSubTopicIsPoll(false);
    setCreateFeedback(null);
    setIsCreateOpen(false);
    onSearchQueryChange('');
    navigate(`/thread/${createResult.subTopicId}?compose=1&firstPost=1`);
  };

  const handleToggleSubTopicStatus = async (subTopic: SubTopic) => {
    const result = await updateSubTopicSettings({
      subTopicId: subTopic.id,
      topicId: subTopic.topicId,
      title: subTopic.title,
      description: subTopic.description,
      status: subTopic.status === 'locked' ? 'open' : 'locked',
      visibility: subTopic.visibility,
      isPinned: subTopic.isPinned,
      isSolved: subTopic.isSolved,
      access: subTopic.access,
      allowedAddresses: subTopic.allowedAddresses,
    });

    setManagementFeedback(
      result.ok
        ? 'Sub-topic status updated.'
        : (result.error ?? 'Unable to update sub-topic.')
    );
  };

  const handleToggleSubTopicVisibility = async (subTopic: SubTopic) => {
    const result = await updateSubTopicSettings({
      subTopicId: subTopic.id,
      topicId: subTopic.topicId,
      title: subTopic.title,
      description: subTopic.description,
      status: subTopic.status,
      visibility: subTopic.visibility === 'hidden' ? 'visible' : 'hidden',
      isPinned: subTopic.isPinned,
      isSolved: subTopic.isSolved,
      access: subTopic.access,
      allowedAddresses: subTopic.allowedAddresses,
    });

    setManagementFeedback(
      result.ok
        ? 'Sub-topic visibility updated.'
        : (result.error ?? 'Unable to update sub-topic.')
    );
  };

  const handleHideBrokenSubTopic = async (subTopic: SubTopic) => {
    const result = await updateSubTopicSettings({
      subTopicId: subTopic.id,
      topicId: subTopic.topicId,
      title: subTopic.title,
      description: subTopic.description,
      status: subTopic.status,
      visibility: 'hidden',
      isPinned: subTopic.isPinned,
      isSolved: subTopic.isSolved,
      access: subTopic.access,
      allowedAddresses: subTopic.allowedAddresses,
      moderationReason: 'Broken QDN thread resource',
    });

    if (result.ok) {
      clearThreadQuarantine(subTopic.id);
    }

    setManagementFeedback(
      result.ok
        ? 'Broken sub-topic hidden from public lists.'
        : (result.error ?? 'Unable to hide broken sub-topic.')
    );
  };

  const handleToggleSubTopicPin = async (subTopic: SubTopic) => {
    const result = await updateSubTopicSettings({
      subTopicId: subTopic.id,
      topicId: subTopic.topicId,
      title: subTopic.title,
      description: subTopic.description,
      status: subTopic.status,
      visibility: subTopic.visibility,
      isPinned: !subTopic.isPinned,
      isSolved: subTopic.isSolved,
      access: subTopic.access,
      allowedAddresses: subTopic.allowedAddresses,
    });

    setManagementFeedback(
      result.ok
        ? subTopic.isPinned
          ? 'Sub-topic unpinned.'
          : 'Sub-topic pinned to the top.'
        : (result.error ?? 'Unable to update sub-topic pin.')
    );
  };

  const handleOpenSubTopicManager = (subTopic: SubTopic) => {
    setManagedSubTopicId((current) =>
      current === subTopic.id ? null : subTopic.id
    );
    setManagedSubTopicTopicId(subTopic.topicId);
    setManagedSubTopicTitle(subTopic.title);
    setManagedSubTopicDescription(subTopic.description);
    setManagedSubTopicStatus(subTopic.status);
    setManagedSubTopicVisibility(subTopic.visibility);
    setManagedSubTopicAccess(subTopic.access);
    setManagedSubTopicIsPoll(subTopic.isPoll);
    setManagedSubTopicAllowedAddresses(subTopic.allowedAddresses.join(', '));
    setManagementFeedback(null);
  };

  const handleSaveSubTopicManager = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    if (!managedSubTopicId) {
      return;
    }

    const existingSubTopic = subTopics.find(
      (subTopic) => subTopic.id === managedSubTopicId
    );
    if (!existingSubTopic) {
      return;
    }

    const result = await updateSubTopicSettings({
      subTopicId: managedSubTopicId,
      topicId: managedSubTopicTopicId,
      title: managedSubTopicTitle,
      description: managedSubTopicDescription,
      status: managedSubTopicStatus,
      visibility: managedSubTopicVisibility,
      isPinned: existingSubTopic.isPinned,
      isSolved: existingSubTopic.isSolved,
      isPoll: managedSubTopicIsPoll,
      access: managedSubTopicAccess,
      allowedAddresses: managedSubTopicAllowedAddresses
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    });

    setManagementFeedback(
      result.ok
        ? 'Sub-topic settings updated.'
        : (result.error ?? 'Unable to update sub-topic.')
    );
  };

  if (!topic) {
    return (
      <div className="space-y-4">
        <h2 className="text-ui-strong text-lg font-semibold">
          Main topic not found
        </h2>
        <Link to="/" className="forum-link text-sm font-medium">
          Back to home
        </Link>
      </div>
    );
  }

  if (topic.visibility === 'hidden' && !canModerate) {
    return (
      <div className="space-y-4">
        <h2 className="text-ui-strong text-lg font-semibold">
          Main topic not available
        </h2>
        <AccessDisclosureNotice kind="hidden" />
        <Link to="/" className="forum-link text-sm font-medium">
          Back to home
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
        <span className="text-ui-muted">/</span>
        <span className="text-ui-strong font-semibold">{topic.title}</span>
      </nav>

      <section className="forum-card-primary p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-ui-strong text-2xl font-semibold">
              {topic.title}
            </h2>
            <p className="text-ui-muted mt-1 text-sm">{topic.description}</p>
            <p className="text-ui-muted mt-2 text-xs">
              {visibleSubTopics.length} sub-topics
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setIsCreateOpen((current) => !current)}
              className="bg-brand-primary-solid rounded-md px-3 py-2 text-xs font-semibold text-white"
            >
              Create New Topic
            </button>
            <button
              type="button"
              onClick={() => void handleShareTopic()}
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition active:scale-95"
            >
              {isTopicShareCopied ? 'Copied' : 'Share Main Topic'}
            </button>
          </div>
        </div>
      </section>

      {isCreateOpen ? (
        <section className="forum-card p-4 space-y-3">
          <h3 className="text-ui-strong text-sm font-semibold">
            Create New Topic in {topic.title}
          </h3>
          {canCreateHere ? (
            <>
              <input
                value={subTopicTitle}
                onChange={(event) => setSubTopicTitle(event.target.value)}
                placeholder="Sub-topic title"
                className="bg-surface-card text-ui-strong w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
              <textarea
                value={subTopicDescription}
                onChange={(event) => setSubTopicDescription(event.target.value)}
                placeholder="Sub-topic description"
                maxLength={TOPIC_DESCRIPTION_MAX_LENGTH}
                className="bg-surface-card text-ui-strong min-h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
              <p className="text-ui-muted text-xs">
                {subTopicDescription.length}/{TOPIC_DESCRIPTION_MAX_LENGTH}
              </p>
              <AccessDisclosureNotice kind="public-storage" />
              <label className="flex items-center gap-2 rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={subTopicIsPoll}
                  onChange={(event) => setSubTopicIsPoll(event.target.checked)}
                />
                Mark this topic as Poll / Voting
              </label>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                After the sub-topic is created, you will be taken to the new
                thread to publish the first post.
              </div>
              <button
                type="button"
                onClick={handleCreateSubTopic}
                className="bg-brand-primary-solid rounded-md px-4 py-2 text-sm font-semibold text-white"
              >
                Create Sub-Topic
              </button>
            </>
          ) : (
            <p className="text-ui-muted text-sm">
              You do not have permission to create sub-topics under this main
              topic.
            </p>
          )}
          {createFeedback ? (
            <p className="text-ui-muted text-xs">{createFeedback}</p>
          ) : null}
        </section>
      ) : null}

      {managementFeedback ? (
        <p
          className={
            managementFeedback.toLowerCase().includes('copied')
              ? 'fixed right-4 top-24 z-50 inline-flex items-center rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-lg'
              : 'text-ui-muted text-xs'
          }
        >
          {managementFeedback}
        </p>
      ) : null}

      <section className="space-y-3">
        <div>
          <h3 className="text-brand-primary text-base font-semibold">
            Sub-Topics
          </h3>
          <p className="text-ui-muted mt-1 text-xs">
            Search within this main topic only. Use the header search for the
            whole forum.
          </p>
          <input
            type="search"
            value={topicSearchQuery}
            onChange={(event) => setTopicSearchQuery(event.target.value)}
            placeholder="Search sub-topics and loaded/indexed posts"
            className="bg-surface-card text-ui-strong placeholder:text-ui-muted mt-3 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
        {canReorderPinnedSubTopics && pinnedSubTopicIds.length > 1 ? (
          <p className="text-ui-muted text-xs">
            Drag pinned sub-topics to reorder how they appear at the top.
          </p>
        ) : null}
        {visibleSubTopics.length > 0 ? (
          <SubTopicList
            subTopics={visibleSubTopics}
            users={users}
            postCountsBySubTopicId={postCountsBySubTopicId}
            walletNamesByAddress={walletNamesByAddress}
            quarantinedSubTopicIds={quarantinedSubTopicIds}
            onOpenThread={handleOpenThread}
            canManageSubTopics={canManageSubTopics}
            onManageSubTopic={handleOpenSubTopicManager}
            onToggleSubTopicPin={handleToggleSubTopicPin}
            onToggleSubTopicStatus={handleToggleSubTopicStatus}
            onToggleSubTopicVisibility={handleToggleSubTopicVisibility}
            onHideBrokenSubTopic={handleHideBrokenSubTopic}
            canReorderPinnedSubTopics={
              canReorderPinnedSubTopics && pinnedSubTopicIds.length > 1
            }
            draggedPinnedSubTopicId={draggedPinnedSubTopicId}
            dragOverPinnedSubTopicId={dragOverPinnedSubTopicId}
            onPinnedDragStart={handlePinnedDragStart}
            onPinnedDragOver={handlePinnedDragOver}
            onPinnedDrop={handlePinnedDrop}
            onPinnedDragEnd={handlePinnedDragEnd}
            highlightQuery={topicSearchQuery}
          />
        ) : (
          <div className="forum-card p-5">
            <p className="text-ui-strong text-sm font-semibold">
              No sub-topics found
            </p>
            <p className="text-ui-muted mt-1 text-sm">
              Create the first sub-topic for this main topic.
            </p>
          </div>
        )}
      </section>

      {managedSubTopicId ? (
        <form
          className="forum-card p-4 space-y-2"
          onSubmit={handleSaveSubTopicManager}
        >
          <h3 className="text-ui-strong text-sm font-semibold">
            Manage Sub-Topic
          </h3>
          <select
            value={managedSubTopicTopicId}
            onChange={(event) => setManagedSubTopicTopicId(event.target.value)}
            className="bg-surface-card text-ui-strong w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
          >
            {topics.map((item) => (
              <option key={item.id} value={item.id}>
                Move to Main Topic: {item.title}
              </option>
            ))}
          </select>
          <input
            value={managedSubTopicTitle}
            onChange={(event) => setManagedSubTopicTitle(event.target.value)}
            placeholder="Sub-topic title"
            className="bg-surface-card text-ui-strong w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <textarea
            value={managedSubTopicDescription}
            onChange={(event) =>
              setManagedSubTopicDescription(event.target.value)
            }
            placeholder="Sub-topic description"
            maxLength={TOPIC_DESCRIPTION_MAX_LENGTH}
            className="bg-surface-card text-ui-strong min-h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <p className="text-ui-muted text-xs">
            {managedSubTopicDescription.length}/{TOPIC_DESCRIPTION_MAX_LENGTH}
          </p>
          <select
            value={managedSubTopicStatus}
            onChange={(event) =>
              setManagedSubTopicStatus(event.target.value as 'open' | 'locked')
            }
            className="bg-surface-card text-ui-strong w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="open">Open</option>
            <option value="locked">Locked</option>
          </select>
          <select
            value={managedSubTopicVisibility}
            onChange={(event) =>
              setManagedSubTopicVisibility(
                event.target.value as 'visible' | 'hidden'
              )
            }
            className="bg-surface-card text-ui-strong w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="visible">Visible</option>
            <option value="hidden">Hidden</option>
          </select>
          <select
            value={managedSubTopicAccess}
            onChange={(event) =>
              setManagedSubTopicAccess(event.target.value as TopicAccess)
            }
            className="bg-surface-card text-ui-strong w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="everyone">Public in this app</option>
            <option value="moderators">Restricted in this app: staff</option>
            <option value="admins">
              Restricted in this app: admins (staff review applies)
            </option>
            <option value="custom">
              Restricted in this app: listed wallets (staff review applies)
            </option>
          </select>
          <label className="flex items-center gap-2 rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-semibold text-slate-800">
            <input
              type="checkbox"
              checked={managedSubTopicIsPoll}
              onChange={(event) =>
                setManagedSubTopicIsPoll(event.target.checked)
              }
            />
            Poll / Voting topic
          </label>
          <p className="text-ui-muted text-xs">
            Access: {resolveAccessLabel(managedSubTopicAccess)}
          </p>
          <AccessDisclosureNotice
            kind="restricted"
            access={managedSubTopicAccess}
          />
          {managedSubTopicVisibility === 'hidden' ? (
            <AccessDisclosureNotice kind="hidden" />
          ) : null}
          {managedSubTopicAccess === 'custom' ? (
            <textarea
              value={managedSubTopicAllowedAddresses}
              onChange={(event) =>
                setManagedSubTopicAllowedAddresses(event.target.value)
              }
              placeholder="Comma-separated wallet addresses"
              className="bg-surface-card text-ui-strong min-h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
          ) : null}
          <div className="flex gap-2">
            <button
              type="submit"
              className="bg-brand-primary-solid rounded-md px-3 py-2 text-xs font-semibold text-white"
            >
              Save Sub-Topic Settings
            </button>
            <button
              type="button"
              onClick={() => setManagedSubTopicId(null)}
              className="bg-surface-card text-ui-muted rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold"
            >
              Close
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
};

export default TopicPage;
