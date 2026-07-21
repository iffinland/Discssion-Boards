import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import HighlightedText from '../components/common/HighlightedText';
import AccessDisclosureNotice from '../components/forum/AccessDisclosureNotice';
import { useForumActions, useForumData } from '../hooks/useForumData';
import { canAccessSubTopic } from '../services/forum/forumAccess';
import {
  buildForumStructureSearchIndex,
  createSearchHaystack,
  searchForumStructure,
  tokenizeSearchQuery,
} from '../services/forum/forumSearch';
import { forumSearchIndexService } from '../services/qdn/forumSearchIndexService';
import {
  buildTopicShareLink,
  copyToClipboard,
} from '../services/qortium/share';
import { getAccountNames } from '../services/qortium/walletService';
import type { ValidatedV2IndexEntry } from '../services/architectureV2/indexes';
import { forumQdnService } from '../services/qdn/forumQdnService';
import type { SubTopic, Topic, TopicAccess } from '../types';

const parseAddressInput = (value: string) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

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

const topicAccessOptions: Array<{
  value: TopicAccess;
  labelKey: string;
  helperKey: string;
}> = [
  {
    value: 'everyone',
    labelKey: 'moderation.accessAnyone',
    helperKey: 'moderation.accessAnyoneHelp',
  },
  {
    value: 'moderators',
    labelKey: 'moderation.accessModerators',
    helperKey: 'moderation.accessModeratorsHelp',
  },
  {
    value: 'admins',
    labelKey: 'moderation.accessAdmins',
    helperKey: 'moderation.accessAdminsHelp',
  },
  {
    value: 'custom',
    labelKey: 'moderation.accessCustom',
    helperKey: 'moderation.accessCustomHelp',
  },
];

type HomeProps = {
  searchQuery: string;
};

type DisplayTopic = Topic & {
  subTopicCount: number;
  matchedSubTopics: SubTopic[];
  matchedPostCount: number;
};

const TOPIC_DESCRIPTION_MAX_LENGTH = 250;
const ACTIVE_SUBTOPIC_LIMIT = 5;
const ROLE_NAME_BATCH_SIZE = 6;
const roleLabelKeyByType: Record<'SuperAdmin' | 'Admin' | 'Moderator', string> =
  {
    SuperAdmin: 'moderation.superAdmin',
    Admin: 'moderation.admin',
    Moderator: 'moderation.moderator',
  };
const MINUTE_IN_MS = 60 * 1000;
const HOUR_IN_MS = 60 * MINUTE_IN_MS;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const V2_SEARCH_MODERATION_CACHE_TTL_MS = 30 * 1000;

const formatActiveTopicTime = (
  value: string,
  nowMs: number,
  locale: string
) => {
  const parsedMs = new Date(value).getTime();
  if (!Number.isFinite(parsedMs)) {
    return '—';
  }

  const elapsedMs = Math.max(0, nowMs - parsedMs);
  if (elapsedMs < MINUTE_IN_MS) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
      0,
      'second'
    );
  }

  if (elapsedMs < HOUR_IN_MS) {
    const minutes = Math.floor(elapsedMs / MINUTE_IN_MS);
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
      -minutes,
      'minute'
    );
  }

  if (elapsedMs < DAY_IN_MS) {
    const hours = Math.floor(elapsedMs / HOUR_IN_MS);
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
      -hours,
      'hour'
    );
  }

  const days = Math.floor(elapsedMs / DAY_IN_MS);
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
    -days,
    'day'
  );
};

const Home = ({ searchQuery }: HomeProps) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    currentUser,
    authenticatedAddress,
    roleRegistry,
    users,
    topics,
    subTopics,
    posts,
    threadSearchIndexes,
    isAuthReady,
    loadError,
    isRetrying,
    loadingStage,
    loadStatus,
  } = useForumData();
  const {
    createTopic,
    reorderTopics,
    updateTopicSettings,
    upsertRoleAssignment,
    removeRoleAssignment,
    retryLoadData,
  } = useForumActions();
  const [openCreatePanel, setOpenCreatePanel] = useState(false);
  const [topicTitle, setTopicTitle] = useState('');
  const [topicDescription, setTopicDescription] = useState('');
  const [topicStatus, setTopicStatus] = useState<'open' | 'locked'>('open');
  const [topicAccess, setTopicAccess] = useState<TopicAccess>('everyone');
  const [topicAllowedAddresses, setTopicAllowedAddresses] = useState('');
  const [topicFeedback, setTopicFeedback] = useState<string | null>(null);
  const [managementFeedback, setManagementFeedback] = useState<string | null>(
    null
  );
  const [copiedTopicId, setCopiedTopicId] = useState<string | null>(null);
  const [managedTopicId, setManagedTopicId] = useState<string | null>(null);
  const [managedTopicTitle, setManagedTopicTitle] = useState('');
  const [managedTopicDescription, setManagedTopicDescription] = useState('');
  const [managedTopicStatus, setManagedTopicStatus] = useState<
    'open' | 'locked'
  >('open');
  const [managedTopicVisibility, setManagedTopicVisibility] = useState<
    'visible' | 'hidden'
  >('visible');
  const [managedTopicAccess, setManagedTopicAccess] =
    useState<TopicAccess>('everyone');
  const [managedTopicAllowedAddresses, setManagedTopicAllowedAddresses] =
    useState('');
  const [roleAddress, setRoleAddress] = useState('');
  const [roleType, setRoleType] = useState<
    'SuperAdmin' | 'Admin' | 'Moderator'
  >('Admin');
  const [roleFeedback, setRoleFeedback] = useState<string | null>(null);
  const [roleNamesByAddress, setRoleNamesByAddress] = useState<
    Record<string, string>
  >({});
  const [draggedTopicId, setDraggedTopicId] = useState<string | null>(null);
  const [dragOverTopicId, setDragOverTopicId] = useState<string | null>(null);
  const [activeTopicsNowMs, setActiveTopicsNowMs] = useState<number>(() =>
    Date.now()
  );
  const [v2SearchEntries, setV2SearchEntries] = useState<
    ValidatedV2IndexEntry[]
  >([]);
  const [v2SearchAvailability, setV2SearchAvailability] = useState<
    'current' | 'partial' | 'cached'
  >('current');
  const requestedRoleNameAddressesRef = useRef<Set<string>>(new Set());
  const v2SearchModerationCacheRef = useRef<{
    authority: object;
    targets: Record<string, { removed?: boolean; hidden?: boolean }>;
    cachedAt: number;
  } | null>(null);

  const isAdmin =
    currentUser.role === 'Admin' ||
    currentUser.role === 'SuperAdmin' ||
    currentUser.role === 'SysOp';
  const isSysOp = currentUser.role === 'SysOp';
  const isSuperAdmin = currentUser.role === 'SuperAdmin';
  const canManageRoles =
    currentUser.role === 'SysOp' ||
    currentUser.role === 'SuperAdmin' ||
    currentUser.role === 'Admin';
  const canCreateMainTopics = isAdmin;
  const assignableRoleOptions = useMemo(() => {
    if (isSysOp) {
      return [
        { value: 'SuperAdmin' as const, label: t('moderation.superAdmin') },
        { value: 'Admin' as const, label: t('moderation.admin') },
        { value: 'Moderator' as const, label: t('moderation.moderator') },
      ];
    }

    if (isSuperAdmin) {
      return [
        { value: 'Admin' as const, label: t('moderation.admin') },
        { value: 'Moderator' as const, label: t('moderation.moderator') },
      ];
    }

    return [{ value: 'Moderator' as const, label: t('moderation.moderator') }];
  }, [isSuperAdmin, isSysOp, t]);
  const canModerate = currentUser.role !== 'Member';
  const normalizedSearchQuery = searchQuery.trim();
  const hasActiveSearch = normalizedSearchQuery.length > 0;
  const canReorderTopicsByDrag =
    (isSysOp || isSuperAdmin || currentUser.role === 'Admin') &&
    !hasActiveSearch;
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const normalizedDeferredSearchQuery = deferredSearchQuery.trim();
  const hasDeferredActiveSearch = normalizedDeferredSearchQuery.length > 0;

  const topicQueryParam = searchParams.get('topic');
  useEffect(() => {
    if (!topicQueryParam) {
      return;
    }

    const topicExists = topics.some((topic) => topic.id === topicQueryParam);
    if (!topicExists) {
      return;
    }

    navigate(`/topic/${topicQueryParam}`, { replace: true });
  }, [navigate, topicQueryParam, topics]);

  const visibleTopics = useMemo(
    () =>
      [...topics]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .filter((topic) => canModerate || topic.visibility !== 'hidden'),
    [canModerate, topics]
  );
  const visibleTopicIds = useMemo(
    () => new Set(visibleTopics.map((topic) => topic.id)),
    [visibleTopics]
  );
  const visibleSubTopics = useMemo(
    () =>
      subTopics.filter(
        (subTopic) =>
          visibleTopicIds.has(subTopic.topicId) &&
          (canModerate || subTopic.visibility !== 'hidden') &&
          (canModerate ||
            canAccessSubTopic(subTopic, currentUser, authenticatedAddress))
      ),
    [authenticatedAddress, canModerate, currentUser, subTopics, visibleTopicIds]
  );
  const accessibleThreadIds = useMemo(
    () => new Set(visibleSubTopics.map((subTopic) => subTopic.id)),
    [visibleSubTopics]
  );
  const subTopicsByTopicId = useMemo(() => {
    const grouped = new Map<string, SubTopic[]>();

    visibleSubTopics.forEach((subTopic) => {
      const current = grouped.get(subTopic.topicId) ?? [];
      current.push(subTopic);
      grouped.set(subTopic.topicId, current);
    });

    grouped.forEach((items, topicId) => {
      grouped.set(topicId, sortSubTopics(items));
    });

    return grouped;
  }, [visibleSubTopics]);

  const structureTopics = useMemo(
    () =>
      visibleTopics.map((topic) => ({
        ...topic,
        subTopics: subTopicsByTopicId.get(topic.id) ?? [],
      })),
    [subTopicsByTopicId, visibleTopics]
  );
  const structureSearchIndex = useMemo(
    () =>
      buildForumStructureSearchIndex(visibleTopics, visibleSubTopics, users),
    [users, visibleSubTopics, visibleTopics]
  );
  const structureSearchResult = useMemo(
    () =>
      searchForumStructure(structureSearchIndex, structureTopics, searchQuery),
    [searchQuery, structureSearchIndex, structureTopics]
  );
  useEffect(() => {
    if (!hasDeferredActiveSearch) {
      setV2SearchEntries([]);
      setV2SearchAvailability('current');
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const authority = await forumQdnService.loadV2AuthorityState();
        const cachedModeration = v2SearchModerationCacheRef.current;
        const useCachedModeration = Boolean(
          cachedModeration &&
            cachedModeration.authority === authority.authoritative &&
            Date.now() - cachedModeration.cachedAt <=
              V2_SEARCH_MODERATION_CACHE_TTL_MS
        );
        const moderationTargets = useCachedModeration
          ? (cachedModeration?.targets ?? {})
          : (await forumQdnService.loadV2ModerationState({ authority }))
              .targets;
        if (!useCachedModeration)
          v2SearchModerationCacheRef.current = {
            authority: authority.authoritative,
            targets: moderationTargets,
            cachedAt: Date.now(),
          };
        const unavailableTargets = Object.fromEntries(
          Object.entries(moderationTargets)
            .filter(
              ([, state]) =>
                state.removed === true ||
                (!canModerate && state.hidden === true)
            )
            .map(([targetId]) => [targetId, 'tombstoned' as const])
        );
        const result = await forumSearchIndexService.searchV2Index(
          normalizedDeferredSearchQuery,
          authority,
          unavailableTargets,
          { accessibleThreadIds }
        );
        if (!active) return;
        setV2SearchEntries(result.entries);
        setV2SearchAvailability(
          result.discovery.completeness !== 'complete'
            ? 'partial'
            : result.discovery.source !== 'network' ||
                authority.discovery.source !== 'network' ||
                useCachedModeration
              ? 'cached'
              : 'current'
        );
      } catch {
        if (!active) return;
        setV2SearchEntries([]);
        setV2SearchAvailability('partial');
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [
    accessibleThreadIds,
    canModerate,
    hasDeferredActiveSearch,
    normalizedDeferredSearchQuery,
  ]);
  const postMatchCountBySubTopicId = useMemo(() => {
    if (!hasActiveSearch) {
      return {} as Record<string, number>;
    }

    const tokens = tokenizeSearchQuery(searchQuery);
    if (tokens.length === 0) {
      return {} as Record<string, number>;
    }

    const userMap = new Map(users.map((user) => [user.id, user.displayName]));
    const matches = (content: string, authorUserId: string) => {
      const haystack = createSearchHaystack([
        content,
        userMap.get(authorUserId) ?? authorUserId,
        authorUserId,
      ]);
      return tokens.every((token) => haystack.includes(token));
    };

    const counts: Record<string, number> = {};
    const seenPostIds = new Set<string>();

    posts.forEach((post) => {
      if (!accessibleThreadIds.has(post.subTopicId)) {
        return;
      }
      if (!matches(post.content, post.authorUserId)) {
        return;
      }

      counts[post.subTopicId] = (counts[post.subTopicId] ?? 0) + 1;
      seenPostIds.add(post.id);
    });

    v2SearchEntries.forEach(({ entity }) => {
      if (entity.entityType !== 'post' || seenPostIds.has(entity.entityId))
        return;
      counts[entity.parentThreadId] = (counts[entity.parentThreadId] ?? 0) + 1;
      seenPostIds.add(entity.entityId);
    });

    return counts;
  }, [
    accessibleThreadIds,
    hasActiveSearch,
    posts,
    searchQuery,
    users,
    v2SearchEntries,
  ]);

  const filteredTopics = useMemo<DisplayTopic[]>(() => {
    if (!hasActiveSearch) {
      return visibleTopics.map((topic) => ({
        ...topic,
        subTopicCount: subTopicsByTopicId.get(topic.id)?.length ?? 0,
        matchedSubTopics: [],
        matchedPostCount: 0,
      }));
    }

    const structureTopicMap = new Map(
      structureSearchResult.topics.map((topic) => [topic.id, topic])
    );
    const postMatchedSubTopicIds = new Set(
      Object.entries(postMatchCountBySubTopicId)
        .filter(([, count]) => count > 0)
        .map(([subTopicId]) => subTopicId)
    );
    const postMatchedTopicIds = new Set(
      visibleSubTopics
        .filter((subTopic) => postMatchedSubTopicIds.has(subTopic.id))
        .map((subTopic) => subTopic.topicId)
    );
    const topicIdsToInclude = new Set([
      ...structureTopicMap.keys(),
      ...postMatchedTopicIds,
    ]);

    return visibleTopics
      .filter((topic) => topicIdsToInclude.has(topic.id))
      .map((topic) => {
        const allTopicSubTopics = subTopicsByTopicId.get(topic.id) ?? [];
        const structureMatchedSubTopics =
          structureTopicMap.get(topic.id)?.subTopics ?? [];
        const matchedSubTopicsById = new Map(
          structureMatchedSubTopics.map((subTopic) => [subTopic.id, subTopic])
        );

        allTopicSubTopics.forEach((subTopic) => {
          if (!postMatchedSubTopicIds.has(subTopic.id)) {
            return;
          }
          matchedSubTopicsById.set(subTopic.id, subTopic);
        });

        const matchedSubTopics = sortSubTopics([
          ...matchedSubTopicsById.values(),
        ]);
        const matchedPostCount = matchedSubTopics.reduce(
          (count, subTopic) =>
            count + (postMatchCountBySubTopicId[subTopic.id] ?? 0),
          0
        );

        return {
          ...topic,
          subTopicCount: allTopicSubTopics.length,
          matchedSubTopics,
          matchedPostCount,
        };
      });
  }, [
    hasActiveSearch,
    postMatchCountBySubTopicId,
    structureSearchResult.topics,
    subTopicsByTopicId,
    visibleSubTopics,
    visibleTopics,
  ]);
  const matchedSubTopicCount = useMemo(
    () =>
      filteredTopics.reduce(
        (count, topic) => count + topic.matchedSubTopics.length,
        0
      ),
    [filteredTopics]
  );
  const matchedPostCount = useMemo(
    () =>
      filteredTopics.reduce(
        (count, topic) => count + topic.matchedPostCount,
        0
      ),
    [filteredTopics]
  );
  const effectiveSearchAvailability = useMemo(() => {
    if (!hasActiveSearch) return 'current' as const;
    if (
      v2SearchAvailability === 'partial' ||
      posts.some(
        (post) =>
          post.dataAvailability === 'partial' ||
          post.dataAvailability === 'unavailable'
      )
    )
      return 'partial' as const;
    if (
      v2SearchAvailability === 'cached' ||
      posts.some(
        (post) =>
          post.dataAvailability === 'cached-last-known-good' ||
          post.dataAvailability === 'index-only'
      )
    )
      return 'cached' as const;
    return 'current' as const;
  }, [hasActiveSearch, posts, v2SearchAvailability]);

  const activeSubTopics = useMemo(() => {
    const userMap = new Map(users.map((user) => [user.id, user.displayName]));
    const latestBySubTopicId = new Map<
      string,
      { authorUserId: string; createdAt: string }
    >();

    const trackLatest = (
      subTopicId: string,
      authorUserId: string,
      createdAt: string
    ) => {
      const nextMs = new Date(createdAt).getTime();
      if (!Number.isFinite(nextMs)) {
        return;
      }

      const current = latestBySubTopicId.get(subTopicId);
      const currentMs = current ? new Date(current.createdAt).getTime() : -1;
      if (!current || nextMs >= currentMs) {
        latestBySubTopicId.set(subTopicId, { authorUserId, createdAt });
      }
    };

    posts.forEach((post) => {
      trackLatest(post.subTopicId, post.authorUserId, post.createdAt);
    });
    Object.entries(threadSearchIndexes).forEach(([subTopicId, snapshot]) => {
      snapshot.posts.forEach((post) => {
        trackLatest(subTopicId, post.authorUserId, post.createdAt);
      });
    });

    const toTimestamp = (value: string) => {
      const timestamp = new Date(value).getTime();
      return Number.isFinite(timestamp) ? timestamp : 0;
    };

    return [...visibleSubTopics]
      .map((subTopic) => {
        const indexedLatest = latestBySubTopicId.get(subTopic.id);
        const subTopicLastMs = toTimestamp(subTopic.lastPostAt);
        const indexedLatestMs = indexedLatest
          ? toTimestamp(indexedLatest.createdAt)
          : 0;
        const useIndexedLatest = Boolean(
          indexedLatest && indexedLatestMs >= subTopicLastMs
        );
        const activityAt =
          useIndexedLatest && indexedLatest
            ? indexedLatest.createdAt
            : subTopic.lastPostAt;
        const activityAuthorUserId =
          useIndexedLatest && indexedLatest
            ? indexedLatest.authorUserId
            : subTopic.lastPostAuthorUserId;

        return {
          ...subTopic,
          activityAt,
          activityMs: Math.max(subTopicLastMs, indexedLatestMs),
          lastPostAuthorName:
            userMap.get(activityAuthorUserId) ??
            activityAuthorUserId ??
            t('common.unknownUser'),
          activeTimeLabel: formatActiveTopicTime(
            activityAt,
            activeTopicsNowMs,
            i18n.language
          ),
        };
      })
      .sort((a, b) => b.activityMs - a.activityMs)
      .slice(0, ACTIVE_SUBTOPIC_LIMIT);
  }, [
    activeTopicsNowMs,
    i18n.language,
    posts,
    t,
    threadSearchIndexes,
    users,
    visibleSubTopics,
  ]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setActiveTopicsNowMs(Date.now());
    }, MINUTE_IN_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    let active = true;

    const addresses = [
      roleRegistry.primarySysOpAddress,
      ...roleRegistry.sysOps,
      ...roleRegistry.admins,
      ...roleRegistry.moderators,
    ].filter(Boolean);
    const uniqueAddresses = [...new Set(addresses)];

    if (uniqueAddresses.length === 0) {
      setRoleNamesByAddress({});
      return () => {
        active = false;
      };
    }

    const missingAddresses = uniqueAddresses.filter(
      (address) =>
        !roleNamesByAddress[address] &&
        !requestedRoleNameAddressesRef.current.has(address)
    );

    if (missingAddresses.length === 0) {
      return () => {
        active = false;
      };
    }

    missingAddresses.forEach((address) => {
      requestedRoleNameAddressesRef.current.add(address);
    });

    const maybeWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    const resolveRoleNameBatch = async (batch: string[]) => {
      const resolvedEntries = await Promise.all(
        batch.map(async (address) => {
          try {
            const names = await getAccountNames(address);
            const primaryName = names.find((entry) => entry.trim())?.trim();
            return [address, primaryName ?? ''] as const;
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

      setRoleNamesByAddress((current) => ({
        ...current,
        ...nextResolved,
      }));
    };

    const resolveRoleNames = async () => {
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

      for (
        let startIndex = 0;
        startIndex < missingAddresses.length && active;
        startIndex += ROLE_NAME_BATCH_SIZE
      ) {
        await resolveRoleNameBatch(
          missingAddresses.slice(startIndex, startIndex + ROLE_NAME_BATCH_SIZE)
        );

        if (
          !active ||
          startIndex + ROLE_NAME_BATCH_SIZE >= missingAddresses.length
        ) {
          continue;
        }

        await new Promise<void>((resolve) => {
          if (typeof maybeWindow.requestIdleCallback === 'function') {
            maybeWindow.requestIdleCallback(() => resolve(), { timeout: 1200 });
            return;
          }

          window.setTimeout(resolve, 120);
        });
      }
    };

    void resolveRoleNames();

    return () => {
      active = false;
    };
  }, [roleNamesByAddress, roleRegistry]);

  const renderRoleIdentity = (address: string) => {
    const displayName = roleNamesByAddress[address];

    return (
      <span className="min-w-0">
        <span className="text-ui-strong block truncate text-sm font-semibold">
          {displayName || address}
        </span>
        {displayName ? (
          <span className="text-ui-muted block truncate text-[11px]">
            {address}
          </span>
        ) : null}
      </span>
    );
  };

  const handleOpenTopic = (topicId: string) => {
    navigate(`/topic/${topicId}`);
  };

  const handleTopicDragStart = (topicId: string) => {
    if (!canReorderTopicsByDrag) {
      return;
    }

    setDraggedTopicId(topicId);
    setDragOverTopicId(topicId);
  };

  const handleTopicDragOver = (
    event: DragEvent<HTMLDivElement>,
    topicId: string
  ) => {
    if (!canReorderTopicsByDrag) {
      return;
    }

    event.preventDefault();
    setDragOverTopicId(topicId);
  };

  const handleTopicDragEnd = () => {
    setDraggedTopicId(null);
    setDragOverTopicId(null);
  };

  const handleTopicDrop = async (targetTopicId: string) => {
    if (!canReorderTopicsByDrag || !draggedTopicId) {
      handleTopicDragEnd();
      return;
    }

    if (draggedTopicId === targetTopicId) {
      handleTopicDragEnd();
      return;
    }

    const fromIndex = filteredTopics.findIndex(
      (topic) => topic.id === draggedTopicId
    );
    const toIndex = filteredTopics.findIndex(
      (topic) => topic.id === targetTopicId
    );
    if (fromIndex < 0 || toIndex < 0) {
      handleTopicDragEnd();
      return;
    }

    const reorderedTopics = reorderList(filteredTopics, fromIndex, toIndex);
    const result = await reorderTopics(
      reorderedTopics.map((topic) => topic.id)
    );

    setManagementFeedback(
      result.ok
        ? t('topic.orderUpdated')
        : (result.error ?? t('topic.reorderFailed'))
    );
    handleTopicDragEnd();
  };

  const handleOpenThread = (subTopicId: string) => {
    navigate(`/thread/${subTopicId}`);
  };

  const handleShareTopic = async (topic: Topic) => {
    const copied = await copyToClipboard(buildTopicShareLink(topic.id));
    if (!copied) {
      setManagementFeedback(t('topic.linkCopyFailed'));
      return;
    }

    setCopiedTopicId(topic.id);
    setManagementFeedback(t('topic.linkCopied'));
    window.setTimeout(() => {
      setCopiedTopicId((current) => (current === topic.id ? null : current));
      setManagementFeedback((current) =>
        current === t('topic.linkCopied') ? null : current
      );
    }, 2400);
  };

  const handleCreateTopic = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const result = await createTopic({
      title: topicTitle,
      description: topicDescription,
      status: topicStatus,
      subTopicAccess: topicAccess,
      allowedAddresses: parseAddressInput(topicAllowedAddresses),
    });

    if (!result.ok) {
      setTopicFeedback(result.error ?? t('topic.createFailed'));
      return;
    }

    setTopicTitle('');
    setTopicDescription('');
    setTopicStatus('open');
    setTopicAccess('everyone');
    setTopicAllowedAddresses('');
    setTopicFeedback(t('topic.created'));
  };

  const handleOpenTopicManager = (topic: Topic) => {
    setManagedTopicId((current) => (current === topic.id ? null : topic.id));
    setManagedTopicTitle(topic.title);
    setManagedTopicDescription(topic.description);
    setManagedTopicStatus(topic.status);
    setManagedTopicVisibility(topic.visibility);
    setManagedTopicAccess(topic.subTopicAccess);
    setManagedTopicAllowedAddresses(topic.allowedAddresses.join(', '));
    setManagementFeedback(null);
  };

  const handleSaveTopicManager = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!managedTopicId) {
      return;
    }

    const result = await updateTopicSettings({
      topicId: managedTopicId,
      title: managedTopicTitle,
      description: managedTopicDescription,
      status: managedTopicStatus,
      visibility: managedTopicVisibility,
      subTopicAccess: managedTopicAccess,
      allowedAddresses: parseAddressInput(managedTopicAllowedAddresses),
    });

    setManagementFeedback(
      result.ok
        ? t('topic.settingsUpdated')
        : (result.error ?? t('topic.updateFailed'))
    );
  };

  const handleUpsertRole = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const result = await upsertRoleAssignment({
      address: roleAddress,
      role: roleType,
    });

    if (!result.ok) {
      setRoleFeedback(result.error ?? t('moderation.roleUpdateFailed'));
      return;
    }

    setRoleAddress('');
    setRoleFeedback(
      result.partial
        ? (result.error ?? t('moderation.rolePending'))
        : t('moderation.roleUpdated', { role: t(roleLabelKeyByType[roleType]) })
    );
  };

  const handleRemoveRole = async (address: string) => {
    const result = await removeRoleAssignment(address);
    setRoleFeedback(
      result.ok
        ? result.partial
          ? (result.error ?? t('moderation.rolePending'))
          : t('moderation.roleRemoved')
        : (result.error ?? t('moderation.roleRemoveFailed'))
    );
  };

  useEffect(() => {
    if (assignableRoleOptions.some((option) => option.value === roleType)) {
      return;
    }

    setRoleType(assignableRoleOptions[0]?.value ?? 'Moderator');
  }, [assignableRoleOptions, roleType]);

  if (!isAuthReady && topics.length === 0 && subTopics.length === 0) {
    return (
      <div className="space-y-4">
        <div className="forum-card p-5">
          <div className="flex items-center space-x-3">
            <div className="flex-shrink-0">
              <svg
                className="animate-spin h-5 w-5 text-brand-accent"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
            </div>
            <div>
              <p className="text-ui-strong text-sm font-medium">
                {loadingStage}
              </p>
              <p className="text-ui-muted text-xs mt-1">
                {t('status.waitForum')}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (
    isAuthReady &&
    topics.length === 0 &&
    subTopics.length === 0 &&
    loadStatus !== 'empty-confirmed' &&
    !loadError
  ) {
    return (
      <div className="space-y-4">
        <div className="forum-card p-5">
          <div className="flex items-center space-x-3">
            <div className="flex-shrink-0">
              <svg
                className="animate-spin h-5 w-5 text-brand-accent"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
            </div>
            <div>
              <p className="text-ui-strong text-sm font-medium">
                {t('status.checkingQdn')}
              </p>
              <p className="text-ui-muted text-xs mt-1">{loadingStage}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (
    isAuthReady &&
    topics.length === 0 &&
    subTopics.length === 0 &&
    loadError
  ) {
    return (
      <div className="space-y-4">
        <div className="forum-card p-6">
          <div className="text-center max-w-md mx-auto">
            <div className="mb-4 inline-flex items-center justify-center w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-900/20">
              <svg
                className="w-6 h-6 text-rose-600 dark:text-rose-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h3 className="text-ui-strong text-lg font-semibold mb-2">
              {t('status.forumLoadFailed')}
            </h3>
            <p className="text-ui-muted text-sm mb-4">
              {loadError || t('status.forumLoadFallback')}
            </p>
            <button
              type="button"
              onClick={retryLoadData}
              disabled={isRetrying}
              className="forum-button-primary inline-flex items-center px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRetrying ? (
                <>
                  <svg
                    className="animate-spin -ml-1 mr-2 h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  {t('status.retrying')}
                </>
              ) : (
                <>
                  <svg
                    className="-ml-1 mr-2 h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  {t('status.retryLoading')}
                </>
              )}
            </button>
            <p className="text-ui-muted text-xs mt-4">{t('status.syncHelp')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {loadStatus === 'partial' || loadStatus === 'cached' ? (
        <div
          role="status"
          className="forum-card border-amber-300 bg-amber-50/70 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-200"
        >
          {loadingStage}
          {loadStatus === 'cached'
            ? ` ${t('status.cacheReadOnly')}`
            : ` ${t('status.missingNotDeleted')}`}
        </div>
      ) : null}
      {hasActiveSearch && effectiveSearchAvailability !== 'current' ? (
        <div
          role="status"
          className="forum-card border-amber-300 bg-amber-50/70 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-200"
        >
          {effectiveSearchAvailability === 'cached'
            ? t('search.cached')
            : t('search.partial')}
        </div>
      ) : null}
      <section className="forum-card-accent p-5">
        <h2 className="text-brand-accent text-base font-semibold">
          {t('topic.active')}
        </h2>
        {activeSubTopics.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {activeSubTopics.map((subTopic) => (
              <li key={subTopic.id}>
                <button
                  type="button"
                  onClick={() => handleOpenThread(subTopic.id)}
                  className="forum-pill-accent w-full rounded-lg px-3 py-2 text-left transition hover:border-cyan-200 hover:bg-cyan-50/80"
                >
                  <p className="text-ui-strong text-sm font-semibold">
                    {subTopic.isPinned ? (
                      <span className="mr-2 inline-flex rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 align-middle">
                        {t('thread.pinned')}
                      </span>
                    ) : null}
                    {subTopic.status === 'locked' ? (
                      <span className="mr-2 inline-flex rounded-md border border-rose-300 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 align-middle">
                        {t('common.locked')}
                      </span>
                    ) : null}
                    {subTopic.isPoll ? (
                      <span className="mr-2 inline-flex rounded-md border border-cyan-300 bg-cyan-50 px-2 py-0.5 text-[11px] font-semibold text-cyan-800 align-middle">
                        {t('thread.poll')}
                      </span>
                    ) : null}
                    {subTopic.isSolved ? (
                      <span className="mr-2 inline-flex rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 align-middle">
                        {t('thread.solved')}
                      </span>
                    ) : null}
                    <HighlightedText
                      text={subTopic.title}
                      query={searchQuery}
                    />
                  </p>
                  <p className="text-ui-muted text-xs">
                    {t('topic.lastPostBy', {
                      name: subTopic.lastPostAuthorName,
                      time: subTopic.activeTimeLabel,
                    })}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ui-muted mt-3 text-sm">{t('topic.noActive')}</p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-brand-primary text-lg font-semibold">
            {t('topic.mainTopics')}
          </h2>
        </div>
        {hasActiveSearch ? (
          <p className="text-ui-muted text-sm">
            {t('topic.searchResults', {
              topics: filteredTopics.length,
              threads: matchedSubTopicCount,
              posts: matchedPostCount,
            })}
          </p>
        ) : canReorderTopicsByDrag ? (
          <p className="text-ui-muted text-sm">{t('topic.reorderHelp')}</p>
        ) : null}
        {managementFeedback ? (
          <p
            className={
              managementFeedback.toLowerCase().includes('copied')
                ? 'fixed right-4 top-24 z-50 inline-flex items-center rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-lg'
                : 'text-ui-muted text-sm'
            }
          >
            {managementFeedback}
          </p>
        ) : null}
      </section>

      <div className="space-y-4">
        {filteredTopics.map((topic) => (
          <div
            key={topic.id}
            className={[
              'space-y-2 rounded-lg',
              canReorderTopicsByDrag && dragOverTopicId === topic.id
                ? 'ring-2 ring-cyan-300 ring-offset-1 ring-offset-slate-50'
                : '',
            ]
              .filter(Boolean)
              .join(' ')}
            draggable={canReorderTopicsByDrag}
            onDragStart={() => handleTopicDragStart(topic.id)}
            onDragOver={(event) => handleTopicDragOver(event, topic.id)}
            onDrop={() => void handleTopicDrop(topic.id)}
            onDragEnd={handleTopicDragEnd}
          >
            <article className="forum-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <button
                  type="button"
                  onClick={() => handleOpenTopic(topic.id)}
                  className="forum-row-button min-w-0 flex-1 text-left"
                >
                  <h3 className="text-ui-strong text-lg font-semibold">
                    <HighlightedText text={topic.title} query={searchQuery} />
                  </h3>
                  <p className="text-ui-muted mt-1 text-sm">
                    <HighlightedText
                      text={topic.description}
                      query={searchQuery}
                    />
                  </p>
                  <p className="text-ui-muted mt-2 text-xs">
                    {t('topic.subTopicCount', { count: topic.subTopicCount })}
                  </p>
                  {hasActiveSearch ? (
                    <p className="text-ui-muted mt-1 text-xs">
                      {t('topic.matchingSubTopicCount', {
                        threads: topic.matchedSubTopics.length,
                        posts: topic.matchedPostCount,
                      })}
                    </p>
                  ) : null}
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleShareTopic(topic)}
                    className="bg-surface-card text-ui-strong rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold transition active:scale-95"
                  >
                    {copiedTopicId === topic.id
                      ? t('common.copied')
                      : t('common.share')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenTopic(topic.id)}
                    className="bg-brand-primary-solid rounded-md px-2 py-1 text-xs font-semibold text-white"
                  >
                    {t('common.open')}
                  </button>
                  {isAdmin ? (
                    <button
                      type="button"
                      onClick={() => handleOpenTopicManager(topic)}
                      className="bg-surface-card text-ui-strong rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold"
                    >
                      {t('common.manage')}
                    </button>
                  ) : null}
                </div>
              </div>

              {hasActiveSearch && topic.matchedSubTopics.length > 0 ? (
                <div className="mt-4 space-y-2">
                  <p className="text-ui-muted text-xs font-semibold">
                    {t('topic.matchingSubTopics')}
                  </p>
                  <ul className="space-y-2">
                    {topic.matchedSubTopics.map((subTopic) => (
                      <li key={subTopic.id}>
                        <button
                          type="button"
                          onClick={() => handleOpenThread(subTopic.id)}
                          className="forum-pill-accent w-full rounded-lg px-3 py-2 text-left transition hover:border-cyan-200 hover:bg-cyan-50/80"
                        >
                          <p className="text-ui-strong text-sm font-semibold">
                            <HighlightedText
                              text={subTopic.title}
                              query={searchQuery}
                            />
                          </p>
                          <p className="text-ui-muted text-xs">
                            <HighlightedText
                              text={subTopic.description}
                              query={searchQuery}
                            />
                          </p>
                          {(postMatchCountBySubTopicId[subTopic.id] ?? 0) >
                          0 ? (
                            <p className="text-ui-muted mt-1 text-[11px] font-semibold">
                              {t('topic.matchingPostCount', {
                                count: postMatchCountBySubTopicId[subTopic.id],
                              })}
                            </p>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>

            {managedTopicId === topic.id ? (
              <form
                className="forum-card p-4 space-y-2"
                onSubmit={handleSaveTopicManager}
              >
                <h3 className="text-ui-strong text-sm font-semibold">
                  {t('topic.manage')}
                </h3>
                <input
                  value={managedTopicTitle}
                  onChange={(event) => setManagedTopicTitle(event.target.value)}
                  placeholder={t('topic.title')}
                  className="bg-surface-card text-ui-strong w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                />
                <textarea
                  value={managedTopicDescription}
                  onChange={(event) =>
                    setManagedTopicDescription(event.target.value)
                  }
                  placeholder={t('topic.description')}
                  maxLength={TOPIC_DESCRIPTION_MAX_LENGTH}
                  className="bg-surface-card text-ui-strong min-h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                />
                <p className="text-ui-muted text-xs">
                  {managedTopicDescription.length}/
                  {TOPIC_DESCRIPTION_MAX_LENGTH}
                </p>
                <select
                  value={managedTopicStatus}
                  onChange={(event) =>
                    setManagedTopicStatus(
                      event.target.value as 'open' | 'locked'
                    )
                  }
                  className="bg-surface-card text-ui-strong w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="open">{t('common.open')}</option>
                  <option value="locked">{t('common.locked')}</option>
                </select>
                <select
                  value={managedTopicVisibility}
                  onChange={(event) =>
                    setManagedTopicVisibility(
                      event.target.value as 'visible' | 'hidden'
                    )
                  }
                  className="bg-surface-card text-ui-strong w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="visible">{t('common.visible')}</option>
                  <option value="hidden">{t('common.hidden')}</option>
                </select>
                <select
                  value={managedTopicAccess}
                  onChange={(event) =>
                    setManagedTopicAccess(event.target.value as TopicAccess)
                  }
                  className="bg-surface-card text-ui-strong w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                >
                  {topicAccessOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </option>
                  ))}
                </select>
                <AccessDisclosureNotice
                  kind="topic-creation-policy"
                  access={managedTopicAccess}
                />
                {managedTopicVisibility === 'hidden' ? (
                  <AccessDisclosureNotice kind="hidden" />
                ) : null}
                {managedTopicAccess === 'custom' ? (
                  <textarea
                    value={managedTopicAllowedAddresses}
                    onChange={(event) =>
                      setManagedTopicAllowedAddresses(event.target.value)
                    }
                    placeholder={t('moderation.walletAddresses')}
                    className="bg-surface-card text-ui-strong min-h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                  />
                ) : null}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="bg-brand-primary-solid rounded-md px-3 py-2 text-xs font-semibold text-white"
                  >
                    {t('topic.saveSettings')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setManagedTopicId(null)}
                    className="bg-surface-card text-ui-muted rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold"
                  >
                    {t('common.close')}
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        ))}
        {filteredTopics.length === 0 ? (
          <div className="forum-card p-5">
            <p className="text-ui-strong text-sm font-semibold">
              {hasActiveSearch ? t('search.noResults') : t('topic.none')}
            </p>
            <p className="text-ui-muted mt-1 text-sm">
              {hasActiveSearch
                ? t('search.tryDifferent')
                : t('topic.createFirst')}
            </p>
          </div>
        ) : null}
      </div>

      {canManageRoles ? (
        <section className="space-y-3">
          <h2 className="text-brand-primary text-lg font-semibold">
            {t('moderation.forumRoles')}
          </h2>

          <article className="forum-card-primary p-4">
            <div className="space-y-1">
              <p className="text-ui-strong text-sm font-semibold">
                {t('moderation.primarySysOp')}
              </p>
              {renderRoleIdentity(roleRegistry.primarySysOpAddress)}
              <p className="text-ui-muted text-xs break-all">
                {t('access.authenticatedAs', {
                  address: authenticatedAddress ?? t('access.noWallet'),
                })}
              </p>
            </div>

            <form className="mt-4 space-y-2" onSubmit={handleUpsertRole}>
              <input
                value={roleAddress}
                onChange={(event) => setRoleAddress(event.target.value)}
                placeholder={t('moderation.walletAddress')}
                className="bg-surface-card text-ui-strong w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
              <select
                value={roleType}
                onChange={(event) =>
                  setRoleType(
                    event.target.value as 'SuperAdmin' | 'Admin' | 'Moderator'
                  )
                }
                className="bg-surface-card text-ui-strong w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              >
                {assignableRoleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="bg-brand-primary-solid rounded-md px-3 py-2 text-xs font-semibold text-slate-900"
              >
                {t('moderation.saveRole')}
              </button>
            </form>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div>
                <h3 className="text-ui-strong text-sm font-semibold">
                  {t('moderation.superAdmins')}
                </h3>
                <ul className="mt-2 space-y-2">
                  {roleRegistry.sysOps.map((address) => (
                    <li
                      key={address}
                      className="bg-surface-card border-brand-primary flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                    >
                      {renderRoleIdentity(address)}
                      {isSysOp ? (
                        <button
                          type="button"
                          onClick={() => handleRemoveRole(address)}
                          className="text-brand-accent-strong text-xs font-semibold"
                        >
                          {t('common.remove')}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-ui-strong text-sm font-semibold">
                  {t('moderation.admins')}
                </h3>
                <ul className="mt-2 space-y-2">
                  {roleRegistry.admins.map((address) => (
                    <li
                      key={address}
                      className="bg-surface-card border-brand-primary flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                    >
                      {renderRoleIdentity(address)}
                      <button
                        type="button"
                        onClick={() => handleRemoveRole(address)}
                        disabled={currentUser.role === 'Admin'}
                        className="text-brand-accent-strong text-xs font-semibold"
                      >
                        {t('common.remove')}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-ui-strong text-sm font-semibold">
                  {t('moderation.moderators')}
                </h3>
                <ul className="mt-2 space-y-2">
                  {roleRegistry.moderators.map((address) => (
                    <li
                      key={address}
                      className="bg-surface-card border-brand-primary flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                    >
                      {renderRoleIdentity(address)}
                      <button
                        type="button"
                        onClick={() => handleRemoveRole(address)}
                        className="text-brand-accent-strong text-xs font-semibold"
                      >
                        {t('common.remove')}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {roleFeedback ? (
              <p className="text-ui-muted mt-3 text-xs">{roleFeedback}</p>
            ) : null}
          </article>
        </section>
      ) : null}

      {canCreateMainTopics ? (
        <section className="space-y-3 pt-2">
          <h2 className="text-brand-primary text-lg font-semibold">
            {t('topic.createContent')}
          </h2>

          <article className="forum-card-primary overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenCreatePanel((current) => !current)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <div>
                <h3 className="text-brand-primary text-sm font-semibold">
                  {t('topic.create')}
                </h3>
                <p className="text-ui-muted mt-0.5 text-xs">
                  {t('topic.adminCreateHelp')}
                </p>
              </div>
              <span className="text-ui-muted text-xs font-semibold">
                {openCreatePanel ? t('common.close') : t('common.open')}
              </span>
            </button>

            {openCreatePanel ? (
              <div className="border-brand-primary bg-brand-primary-soft border-t px-4 py-4">
                <form className="space-y-2" onSubmit={handleCreateTopic}>
                  <input
                    value={topicTitle}
                    onChange={(event) => setTopicTitle(event.target.value)}
                    placeholder={t('topic.titleShort')}
                    className="bg-surface-card text-ui-strong w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                  />
                  <textarea
                    value={topicDescription}
                    onChange={(event) =>
                      setTopicDescription(event.target.value)
                    }
                    placeholder={t('topic.descriptionShort')}
                    maxLength={TOPIC_DESCRIPTION_MAX_LENGTH}
                    className="bg-surface-card text-ui-strong min-h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                  />
                  <p className="text-ui-muted text-xs">
                    {topicDescription.length}/{TOPIC_DESCRIPTION_MAX_LENGTH}
                  </p>
                  <AccessDisclosureNotice kind="public-storage" />
                  <select
                    value={topicStatus}
                    onChange={(event) =>
                      setTopicStatus(event.target.value as 'open' | 'locked')
                    }
                    className="bg-surface-card text-ui-strong w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                  >
                    <option value="open">{t('topic.openTopic')}</option>
                    <option value="locked">{t('topic.lockedTopic')}</option>
                  </select>
                  <select
                    value={topicAccess}
                    onChange={(event) =>
                      setTopicAccess(event.target.value as TopicAccess)
                    }
                    className="bg-surface-card text-ui-strong w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                  >
                    {topicAccessOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </option>
                    ))}
                  </select>
                  <p className="text-ui-muted text-xs">
                    {t(
                      topicAccessOptions.find(
                        (option) => option.value === topicAccess
                      )?.helperKey ?? 'moderation.accessAnyoneHelp'
                    )}
                  </p>
                  <AccessDisclosureNotice
                    kind="topic-creation-policy"
                    access={topicAccess}
                  />
                  {topicAccess === 'custom' ? (
                    <textarea
                      value={topicAllowedAddresses}
                      onChange={(event) =>
                        setTopicAllowedAddresses(event.target.value)
                      }
                      placeholder={t('moderation.walletAddresses')}
                      className="bg-surface-card text-ui-strong min-h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                    />
                  ) : null}
                  <button
                    type="submit"
                    className="bg-brand-primary-solid rounded-md px-3 py-2 text-xs font-semibold text-white"
                  >
                    {t('topic.create')}
                  </button>
                </form>

                {topicFeedback ? (
                  <p className="text-ui-muted mt-2 text-xs">{topicFeedback}</p>
                ) : null}
              </div>
            ) : null}
          </article>
        </section>
      ) : null}
    </div>
  );
};

export default Home;
