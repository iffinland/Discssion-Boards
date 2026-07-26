import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  getAccountNames,
  getUserAccount,
  type UserAccount,
} from '../../../services/qortium/walletService';
import { forumQdnService } from '../../../services/qdn/forumQdnService';
import {
  forumSearchIndexService,
  type ThreadSearchSnapshot,
  type TopicDirectorySnapshot,
} from '../../../services/qdn/forumSearchIndexService';
import {
  createDefaultRoleRegistry,
  forumRolesService,
  resolveRoleForAddress,
} from '../../../services/qdn/forumRolesService';
import { isQortiumRequestAvailable } from '../../../services/qortium/qortiumClient';
import { perfDebugTimeStart } from '../../../services/perf/perfDebug';
import {
  beginStartupSpan,
  recordStartupEvent,
  setStartupState,
} from '../../../services/perf/startupDiagnostics';
import {
  StartupTimeoutError,
  withStartupTimeout,
} from '../../../services/perf/startupControl';
import type {
  ForumRoleRegistry,
  Post,
  SubTopic,
  Topic,
  User,
} from '../../../types';

type ForumAuthMode = 'qortium';
export type ForumLoadStatus =
  | 'initializing'
  | 'waiting-qortium'
  | 'loading-auth'
  | 'loading-roles'
  | 'loading-index'
  | 'loading-qdn'
  | 'partial'
  | 'cached'
  | 'ready'
  | 'empty-confirmed'
  | 'error';

const GUEST_USER: User = {
  id: 'qortium-guest',
  username: 'qortium-guest',
  displayName: 'Guest',
  address: null,
  avatarUrl: null,
  role: 'Member',
  avatarColor: 'bg-slate-400',
  joinedAt: new Date(0).toISOString(),
};

const QORTIUM_BRIDGE_MAX_PROBES = 16;
const QORTIUM_BRIDGE_PROBE_DELAY_MS = 250;
const IDENTITY_STARTUP_TIMEOUT_MS = 8_000;
const ROLE_STARTUP_TIMEOUT_MS = 10_000;
const STRUCTURE_STARTUP_TIMEOUT_MS = 45_000;
const EMPTY_RECHECK_TIMEOUT_MS = 15_000;
const INDEX_FALLBACK_WAIT_MS = 5_000;

const createAvatarLink = (identity: string) =>
  `/arbitrary/THUMBNAIL/${encodeURIComponent(identity)}/avatar?async=true`;

const hasForumStructure = (input: {
  topics: unknown[];
  subTopics: unknown[];
}) => input.topics.length > 0 || input.subTopics.length > 0;

const sleep = async (durationMs: number) => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
};

const toUniqueNames = (input: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  const next: string[] = [];

  input.forEach((value) => {
    const normalized = value?.trim();
    if (!normalized) {
      return;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    next.push(normalized);
  });

  return next;
};

const mergeUsersFromForumData = (
  baseUsers: User[],
  topics: Topic[],
  subTopics: SubTopic[],
  posts: Post[]
) => {
  const nextUsers = [...baseUsers];
  const seen = new Set(nextUsers.map((user) => user.id));

  const authorIds = new Set<string>();
  topics.forEach((topic) => authorIds.add(topic.createdByUserId));
  subTopics.forEach((subTopic) => authorIds.add(subTopic.authorUserId));
  posts.forEach((post) => authorIds.add(post.authorUserId));

  authorIds.forEach((id) => {
    if (!id || seen.has(id)) {
      return;
    }

    nextUsers.push({
      id,
      username: id,
      displayName: id,
      address: null,
      avatarUrl: createAvatarLink(id),
      role: 'Member',
      avatarColor: 'bg-cyan-500',
      joinedAt: new Date().toISOString(),
    });
    seen.add(id);
  });

  return nextUsers;
};

const toForumStructureFromTopicDirectory = (
  snapshot: TopicDirectorySnapshot
) => {
  const fallbackCreatedAt = new Date(0).toISOString();

  const topicsFromIndex: Topic[] = snapshot.topics.map((topic) => ({
    id: topic.topicId,
    title: topic.title,
    description: topic.description,
    createdByUserId: 'qdn-index',
    createdAt: fallbackCreatedAt,
    sortOrder: topic.sortOrder,
    status: topic.status,
    visibility: topic.visibility,
    subTopicAccess: topic.subTopicAccess,
    allowedAddresses: topic.allowedAddresses,
    dataAvailability: 'index-only' as const,
    dataProvenance: 'legacy-index' as const,
  }));

  const subTopicsFromIndex: SubTopic[] = snapshot.subTopics.map((subTopic) => ({
    id: subTopic.subTopicId,
    topicId: subTopic.topicId,
    title: subTopic.title,
    description: subTopic.description,
    authorUserId: subTopic.authorUserId || 'qdn-index',
    createdAt: subTopic.lastPostAt || fallbackCreatedAt,
    lastPostAt: subTopic.lastPostAt || fallbackCreatedAt,
    lastPostAuthorUserId:
      subTopic.lastPostAuthorUserId || subTopic.authorUserId || 'qdn-index',
    isPinned: subTopic.isPinned,
    pinnedAt: subTopic.pinnedAt,
    isSolved: subTopic.isSolved,
    solvedAt: subTopic.solvedAt,
    solvedByUserId: subTopic.solvedByUserId,
    isPoll: subTopic.isPoll,
    access: subTopic.access,
    allowedAddresses: subTopic.allowedAddresses,
    status: subTopic.status,
    visibility: subTopic.visibility,
    lastModerationAction: subTopic.lastModerationAction ?? null,
    lastModerationReason: subTopic.lastModerationReason ?? null,
    lastModeratedByUserId: subTopic.lastModeratedByUserId ?? null,
    lastModeratedAt: subTopic.lastModeratedAt ?? null,
    dataAvailability: 'index-only' as const,
    dataProvenance: 'legacy-index' as const,
  }));

  return {
    topics: topicsFromIndex,
    subTopics: subTopicsFromIndex,
  };
};

export const useForumDataQuery = () => {
  const [users, setUsers] = useState<User[]>([GUEST_USER]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [subTopics, setSubTopics] = useState<SubTopic[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>(GUEST_USER.id);
  const [availableAuthNames, setAvailableAuthNames] = useState<string[]>([]);
  const [activeAuthName, setActiveAuthName] = useState<string | null>(null);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);
  const [authenticatedAddress, setAuthenticatedAddress] = useState<
    string | null
  >(null);
  const [roleRegistry, setRoleRegistry] = useState<ForumRoleRegistry>(
    createDefaultRoleRegistry()
  );
  const [topicDirectoryIndex, setTopicDirectoryIndex] =
    useState<TopicDirectorySnapshot | null>(null);
  const [threadSearchIndexes, setThreadSearchIndexes] = useState<
    Record<string, ThreadSearchSnapshot>
  >({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const [loadingStage, setLoadingStage] = useState<string>('Initializing...');
  const [loadStatus, setLoadStatus] = useState<ForumLoadStatus>('initializing');
  const [qortiumBridgeProbe, setQortiumBridgeProbe] = useState(0);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const [selectedAccount, setSelectedAccount] = useState<UserAccount | null>(
    null
  );
  const authMode: ForumAuthMode = 'qortium';

  const currentUser = useMemo(() => {
    const baseUser =
      users.find((user) => user.id === currentUserId) ?? users[0];

    if (baseUser.id === GUEST_USER.id) {
      return baseUser;
    }

    return {
      ...baseUser,
      address: authenticatedAddress,
      role: resolveRoleForAddress(authenticatedAddress, roleRegistry),
    };
  }, [authenticatedAddress, currentUserId, roleRegistry, users]);

  useEffect(() => {
    let active = true;

    const syncAccountNames = async () => {
      const normalizedAddress = selectedAccount?.address?.trim();
      const selectedName = selectedAccount?.name?.trim();
      const known = toUniqueNames([selectedName]);

      if (!normalizedAddress) {
        if (!active) {
          return;
        }
        setAvailableAuthNames(known);
        setActiveAuthName((current) => current ?? known[0] ?? null);
        return;
      }

      try {
        const resolved = await getAccountNames(normalizedAddress);
        if (!active) {
          return;
        }

        const merged = toUniqueNames([...known, ...resolved]);
        setAvailableAuthNames(merged);
        setActiveAuthName((current) => {
          if (current && merged.includes(current)) {
            return current;
          }

          if (selectedName && merged.includes(selectedName)) {
            return selectedName;
          }

          return merged[0] ?? null;
        });
      } catch {
        if (!active) {
          return;
        }

        setAvailableAuthNames(known);
        setActiveAuthName((current) => current ?? known[0] ?? null);
      }
    };

    void syncAccountNames();

    return () => {
      active = false;
    };
  }, [selectedAccount]);

  useEffect(() => {
    const identity = activeAuthName?.trim();
    const accountAddress = selectedAccount?.address?.trim() ?? '';
    if (!identity || !selectedAccount) return;

    const nextUser: User = {
      id: identity,
      username: identity,
      displayName: identity,
      address: accountAddress || null,
      avatarUrl: selectedAccount.avatarUrl || createAvatarLink(identity),
      role: resolveRoleForAddress(accountAddress || null, roleRegistry),
      avatarColor: 'bg-cyan-600',
      joinedAt: new Date().toISOString(),
    };
    setAuthenticatedAddress(accountAddress || null);
    setCurrentUserId(identity);
    setUsers((current) => [
      nextUser,
      ...current.filter((user) => user.id !== identity),
    ]);
  }, [activeAuthName, roleRegistry, selectedAccount]);

  const applyForumStructure = useCallback(
    (baseUsers: User[], nextTopics: Topic[], nextSubTopics: SubTopic[]) => {
      setTopics(nextTopics);
      setSubTopics(nextSubTopics);
      setUsers(
        mergeUsersFromForumData(baseUsers, nextTopics, nextSubTopics, [])
      );
      setPosts([]);
    },
    []
  );

  useEffect(() => {
    let active = true;
    const isQortium = isQortiumRequestAvailable();

    if (!isQortium) {
      if (qortiumBridgeProbe === 0) {
        recordStartupEvent('BRIDGE_INIT_START');
        setStartupState('waiting-qortium');
      }
      if (qortiumBridgeProbe < QORTIUM_BRIDGE_MAX_PROBES) {
        setIsAuthReady(false);
        setLoadStatus('waiting-qortium');
        setLoadingStage('Waiting for Qortium bridge...');
        const timeoutId = window.setTimeout(() => {
          setQortiumBridgeProbe((current) => current + 1);
        }, QORTIUM_BRIDGE_PROBE_DELAY_MS);

        return () => {
          active = false;
          window.clearTimeout(timeoutId);
        };
      }

      setUsers([GUEST_USER]);
      setTopics([]);
      setSubTopics([]);
      setPosts([]);
      setCurrentUserId(GUEST_USER.id);
      setAuthenticatedAddress(null);
      setSelectedAccount(null);
      setAvailableAuthNames([]);
      setActiveAuthName(null);
      setRoleRegistry(createDefaultRoleRegistry());
      setTopicDirectoryIndex(null);
      setThreadSearchIndexes({});
      setLoadError(null);
      setLoadingStage('No Qortium environment detected.');
      setLoadStatus('empty-confirmed');
      setIsAuthReady(true);
      recordStartupEvent('LOADING_STATE_FALSE', {
        completion: 'empty',
        detail: 'bridge-unavailable',
      });
      setStartupState('bridge-unavailable', 'empty');
      return () => {
        active = false;
      };
    }

    const bootstrapQdnData = async () => {
      const endTiming = perfDebugTimeStart('initial-forum-data-load', {
        trigger: retryGeneration > 0 ? 'retry' : 'mount',
      });
      recordStartupEvent('BRIDGE_READY', { completion: 'success' });
      setStartupState('loading-initial-structure');
      setIsAuthReady(false);
      setLoadError(null);
      setLoadingStage('Loading authoritative forum resources from QDN...');
      setLoadStatus('loading-qdn');

      const endIdentity = beginStartupSpan('IDENTITY_START');
      const identityPromise = withStartupTimeout(
        getUserAccount(),
        IDENTITY_STARTUP_TIMEOUT_MS,
        'Qortium identity'
      )
        .then((account) => {
          endIdentity('IDENTITY_READY', { completion: 'success' });
          return account;
        })
        .catch((error: unknown) => {
          endIdentity('IDENTITY_READY', {
            completion:
              error instanceof StartupTimeoutError ? 'timeout' : 'error',
            detail: 'guest-read-mode',
          });
          return null;
        });

      recordStartupEvent('FORUM_CONFIG_REQUEST_START', {
        completion: 'success',
        detail: 'no-separate-forum-config-resource',
      });
      recordStartupEvent('FORUM_CONFIG_REQUEST_END', {
        completion: 'empty',
        detail: 'configuration-is-local',
      });

      const rolePromise = withStartupTimeout(
        forumRolesService.loadRoleRegistry(),
        ROLE_STARTUP_TIMEOUT_MS,
        'Forum roles'
      ).catch(() => createDefaultRoleRegistry());

      const endIndex = beginStartupSpan('STARTUP_STATE', {
        caller: 'forumSearchIndexService.loadTopicDirectoryIndex',
        trigger: 'background-derived-index',
        detail: 'background-derived-index-start',
      });
      const indexPromise = forumSearchIndexService
        .loadTopicDirectoryIndex()
        .then((snapshot) => {
          endIndex('BACKGROUND_DISCOVERY_COMPLETE', {
            completion: snapshot
              ? snapshot.dataAvailability === 'partial'
                ? 'partial'
                : 'success'
              : 'empty',
            resultCount:
              (snapshot?.topics.length ?? 0) +
              (snapshot?.subTopics.length ?? 0),
          });
          if (active) setTopicDirectoryIndex(snapshot);
          return snapshot;
        })
        .catch(() => {
          endIndex('BACKGROUND_DISCOVERY_COMPLETE', {
            completion: 'error',
            detail: 'derived-index-unavailable',
          });
          return null;
        });

      const endLegacy = beginStartupSpan('LEGACY_DISCOVERY_START', {
        caller: 'forumQdnService.loadForumStructureCached',
      });
      const endStructure = beginStartupSpan('STRUCTURE_DISCOVERY_START', {
        caller: 'forumQdnService.loadForumStructureCached',
        trigger: 'foreground-authoritative-structure',
      });
      const structurePromise = withStartupTimeout(
        forumQdnService.loadForumStructureCached({ force: true }),
        STRUCTURE_STARTUP_TIMEOUT_MS,
        'Forum structure'
      );

      let loadedTopics: Topic[] = [];
      let loadedSubTopics: SubTopic[] = [];
      try {
        try {
          let remoteData = await structurePromise;
          if (!active) return;
          if (
            !hasForumStructure(remoteData) &&
            remoteData.discovery.completeness === 'complete'
          ) {
            setLoadingStage('No topics found yet, rechecking QDN resources...');
            await sleep(2000);
            remoteData = await withStartupTimeout(
              forumQdnService.loadForumStructureCached({ force: true }),
              EMPTY_RECHECK_TIMEOUT_MS,
              'Empty forum structure recheck'
            );
            if (!active) return;
          }
          endLegacy('LEGACY_DISCOVERY_END', {
            completion:
              remoteData.discovery.completeness === 'complete'
                ? hasForumStructure(remoteData)
                  ? 'success'
                  : 'empty'
                : 'partial',
            resultCount: remoteData.topics.length + remoteData.subTopics.length,
          });
          loadedTopics = remoteData.topics;
          loadedSubTopics = remoteData.subTopics;
          applyForumStructure(
            [GUEST_USER],
            remoteData.topics,
            remoteData.subTopics
          );
          recordStartupEvent('STRUCTURE_FIRST_RESULT', {
            completion: hasForumStructure(remoteData) ? 'success' : 'empty',
            resultCount: remoteData.topics.length + remoteData.subTopics.length,
          });
          endStructure('STRUCTURE_DISCOVERY_END', {
            completion:
              remoteData.discovery.completeness === 'complete'
                ? 'success'
                : 'partial',
            resultCount: remoteData.topics.length + remoteData.subTopics.length,
          });
          recordStartupEvent('FIRST_STRUCTURE_AVAILABLE', {
            completion: hasForumStructure(remoteData) ? 'success' : 'empty',
            resultCount: remoteData.topics.length + remoteData.subTopics.length,
          });
          const partial = remoteData.discovery.completeness !== 'complete';
          endTiming({
            usedTopicDirectoryIndex: false,
            partial,
            topicCount: remoteData.topics.length,
            subTopicCount: remoteData.subTopics.length,
          });
          setLoadingStage(
            partial
              ? 'Forum discovery is incomplete; showing verified resources found so far.'
              : hasForumStructure(remoteData)
                ? 'Ready'
                : 'No forum topics were found after complete QDN discovery.'
          );
          setLoadStatus(
            partial
              ? 'partial'
              : hasForumStructure(remoteData)
                ? 'ready'
                : 'empty-confirmed'
          );
          setIsAuthReady(true);
          recordStartupEvent('LOADING_STATE_FALSE', {
            completion: partial
              ? 'partial'
              : hasForumStructure(remoteData)
                ? 'success'
                : 'empty',
          });
          setStartupState(
            partial
              ? 'ready-partial'
              : hasForumStructure(remoteData)
                ? 'ready'
                : 'empty',
            partial
              ? 'partial'
              : hasForumStructure(remoteData)
                ? 'success'
                : 'empty'
          );
        } catch (directError) {
          endLegacy('LEGACY_DISCOVERY_END', {
            completion:
              directError instanceof StartupTimeoutError ? 'timeout' : 'error',
          });
          endStructure('STRUCTURE_DISCOVERY_END', {
            completion:
              directError instanceof StartupTimeoutError ? 'timeout' : 'error',
          });
          const nextTopicDirectoryIndex = await withStartupTimeout(
            indexPromise,
            INDEX_FALLBACK_WAIT_MS,
            'Derived topic-directory fallback'
          ).catch(() => null);
          if (
            !nextTopicDirectoryIndex ||
            !hasForumStructure(nextTopicDirectoryIndex)
          )
            throw directError;
          const indexedStructure = toForumStructureFromTopicDirectory(
            nextTopicDirectoryIndex
          );
          loadedTopics = indexedStructure.topics;
          loadedSubTopics = indexedStructure.subTopics;
          applyForumStructure(
            [GUEST_USER],
            indexedStructure.topics,
            indexedStructure.subTopics
          );
          endTiming({
            usedTopicDirectoryIndex: true,
            cached: true,
            topicCount: indexedStructure.topics.length,
            subTopicCount: indexedStructure.subTopics.length,
          });
          setLoadingStage(
            'Authoritative QDN data is unavailable; showing read-only cached index hints.'
          );
          setLoadStatus('cached');
          setIsAuthReady(true);
          recordStartupEvent('FIRST_STRUCTURE_AVAILABLE', {
            completion: 'partial',
            resultCount:
              indexedStructure.topics.length +
              indexedStructure.subTopics.length,
            detail: 'derived-index-read-only-fallback',
          });
          recordStartupEvent('LOADING_STATE_FALSE', {
            completion: 'partial',
          });
          setStartupState('ready-partial', 'partial');
        }

        const [account, nextRoleRegistry] = await Promise.all([
          identityPromise,
          rolePromise,
        ]);
        if (!active) return;

        const accountAddress = account?.address?.trim() ?? '';
        const accountName = account?.name?.trim() ?? '';
        const identity = accountName || accountAddress;
        const nextAuthenticatedAddress =
          identity && accountAddress ? accountAddress : null;
        const nextUser = identity
          ? {
              id: identity,
              username: identity,
              displayName: identity,
              address: nextAuthenticatedAddress,
              avatarUrl: account?.avatarUrl || createAvatarLink(identity),
              role: resolveRoleForAddress(
                nextAuthenticatedAddress,
                nextRoleRegistry
              ),
              avatarColor: 'bg-cyan-600',
              joinedAt: new Date().toISOString(),
            }
          : GUEST_USER;

        setSelectedAccount(account);
        setAuthenticatedAddress(nextAuthenticatedAddress);
        setRoleRegistry(nextRoleRegistry);
        setThreadSearchIndexes({});
        setCurrentUserId(nextUser.id);
        setUsers(
          mergeUsersFromForumData([nextUser], loadedTopics, loadedSubTopics, [])
        );
      } catch (error) {
        endTiming({ error: true });
        if (!active) {
          return;
        }

        const errorMessage =
          error instanceof Error
            ? error.message
            : 'Failed to load forum data. This might be due to QDN sync delays or network issues.';

        setLoadError(errorMessage);
        setLoadingStage('Error');
        setLoadStatus('error');

        setAuthenticatedAddress(null);
        setUsers([GUEST_USER]);
        setCurrentUserId(GUEST_USER.id);
        setTopics([]);
        setSubTopics([]);
        setPosts([]);
        setRoleRegistry(createDefaultRoleRegistry());
        setTopicDirectoryIndex(null);
        setThreadSearchIndexes({});
        setIsAuthReady(true);
        recordStartupEvent('LOADING_STATE_FALSE', {
          completion:
            error instanceof StartupTimeoutError ? 'timeout' : 'error',
        });
        setStartupState(
          error instanceof StartupTimeoutError ? 'timeout' : 'error',
          error instanceof StartupTimeoutError ? 'timeout' : 'error'
        );
      }
    };

    void bootstrapQdnData();

    return () => {
      active = false;
    };
  }, [applyForumStructure, qortiumBridgeProbe, retryGeneration]);

  const authenticate = useCallback(async () => {
    const account = await getUserAccount();
    setSelectedAccount(account);
    setActiveAuthName(account.name?.trim() || account.address?.trim() || null);
    setRetryGeneration((current) => current + 1);
  }, []);

  const retryLoadData = useCallback(() => {
    setIsRetrying(true);
    setLoadError(null);
    setLoadStatus('initializing');
    setQortiumBridgeProbe(0);
    setRetryGeneration((current) => current + 1);
    setIsAuthReady(false);

    setTimeout(() => {
      setIsRetrying(false);
    }, 500);
  }, []);

  const isAuthenticated =
    authMode === 'qortium' && currentUser.id !== GUEST_USER.id;

  return {
    users,
    setUsers,
    topics,
    setTopics,
    subTopics,
    setSubTopics,
    posts,
    setPosts,
    currentUser,
    isAuthReady,
    authMode,
    isAuthenticated,
    authenticate,
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
    loadError,
    isRetrying,
    loadingStage,
    loadStatus,
    retryLoadData,
  };
};
