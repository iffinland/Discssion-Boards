import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  | 'ready'
  | 'empty-confirmed'
  | 'error';

type BootstrapSession = {
  user: User;
  authenticatedAddress: string | null;
  identityKey: string;
};

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
  const [selectedAccount, setSelectedAccount] = useState<UserAccount | null>(
    null
  );
  const loadedIdentityRef = useRef<string | null>(null);
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

      loadedIdentityRef.current = null;
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
      return () => {
        active = false;
      };
    }

    const bootstrapQdnData = async () => {
      let account: UserAccount | null = null;

      try {
        setIsAuthReady(false);
        setLoadError(null);
        setLoadStatus('loading-auth');
        setLoadingStage('Loading Qortium account...');
        account = await getUserAccount();
      } catch (error) {
        if (!active) {
          return;
        }

        setSelectedAccount(null);
        setAuthenticatedAddress(null);
        setUsers([GUEST_USER]);
        setCurrentUserId(GUEST_USER.id);
        setLoadError(
          error instanceof Error
            ? error.message
            : 'Unable to read the selected Qortium account.'
        );
        setLoadingStage('Qortium account unavailable');
        setLoadStatus('error');
        setIsAuthReady(true);
        return;
      }

      if (!active) {
        return;
      }

      const accountAddress = account.address?.trim() ?? '';
      const accountName = account.name?.trim() ?? '';
      const identity = activeAuthName?.trim() || accountName || accountAddress;
      const identityKey = identity || GUEST_USER.id;

      setSelectedAccount(account);

      if (loadedIdentityRef.current === identityKey) {
        setAuthenticatedAddress(accountAddress || null);
        setIsAuthReady(true);
        return;
      }

      const endTiming = perfDebugTimeStart('initial-forum-data-load', {
        identityKey,
        mode: identity ? 'authenticated' : 'guest',
      });
      let session: BootstrapSession | null = null;

      try {
        setIsAuthReady(false);
        setLoadError(null);
        setLoadingStage('Loading forum roles...');
        setLoadStatus('loading-roles');
        const [registryResult] = await Promise.allSettled([
          forumRolesService.loadRoleRegistry(),
        ]);

        if (!active) {
          return;
        }

        const nextRoleRegistry =
          registryResult.status === 'fulfilled'
            ? registryResult.value
            : createDefaultRoleRegistry();
        const nextAuthenticatedAddress =
          identity && accountAddress ? accountAddress : null;

        const nextUser = identity
          ? {
              id: identity,
              username: identity,
              displayName: identity,
              address: nextAuthenticatedAddress,
              avatarUrl: account.avatarUrl || createAvatarLink(identity),
              role: 'Member' as const,
              avatarColor: 'bg-cyan-600',
              joinedAt: new Date().toISOString(),
            }
          : GUEST_USER;

        session = {
          identityKey,
          authenticatedAddress: nextAuthenticatedAddress,
          user: identity
            ? {
                ...nextUser,
                role: resolveRoleForAddress(
                  nextAuthenticatedAddress,
                  nextRoleRegistry
                ),
              }
            : GUEST_USER,
        };

        setAuthenticatedAddress(session.authenticatedAddress);
        setRoleRegistry(nextRoleRegistry);
        setThreadSearchIndexes({});
        setCurrentUserId(session.user.id);
        loadedIdentityRef.current = identityKey;

        setLoadingStage('Loading forum structure...');
        setLoadStatus('loading-index');
        const nextTopicDirectoryIndex =
          await forumSearchIndexService.loadTopicDirectoryIndex();
        if (!active) {
          return;
        }
        setTopicDirectoryIndex(nextTopicDirectoryIndex);

        if (
          nextTopicDirectoryIndex &&
          hasForumStructure(nextTopicDirectoryIndex)
        ) {
          const indexedStructure = toForumStructureFromTopicDirectory(
            nextTopicDirectoryIndex
          );
          const moderatedStructure =
            await forumQdnService.applyForumModerationState(
              indexedStructure.topics,
              indexedStructure.subTopics
            );
          applyForumStructure(
            [session.user],
            moderatedStructure.topics,
            moderatedStructure.subTopics
          );
          endTiming({
            usedTopicDirectoryIndex: true,
            topicCount: moderatedStructure.topics.length,
            subTopicCount: moderatedStructure.subTopics.length,
          });
          setLoadingStage('Ready');
          setLoadStatus('ready');
          setIsAuthReady(true);
        } else {
          setLoadingStage(
            nextTopicDirectoryIndex
              ? 'Topic index is empty, checking QDN resources...'
              : 'Loading topics from QDN...'
          );
          setLoadStatus('loading-qdn');
          let remoteData = await forumQdnService.loadForumStructureCached({
            force: Boolean(nextTopicDirectoryIndex),
          });
          if (!active) {
            return;
          }

          if (!hasForumStructure(remoteData)) {
            setLoadingStage('No topics found yet, rechecking QDN resources...');
            await sleep(2000);
            remoteData = await forumQdnService.loadForumStructureCached({
              force: true,
            });
            if (!active) {
              return;
            }
          }

          if (nextTopicDirectoryIndex && !hasForumStructure(remoteData)) {
            throw new Error(
              'The topic index is empty and direct QDN fallback did not return forum topics yet. This node may still be syncing QDN resources.'
            );
          }

          applyForumStructure(
            [session.user],
            remoteData.topics,
            remoteData.subTopics
          );
          endTiming({
            usedTopicDirectoryIndex: false,
            topicCount: remoteData.topics.length,
            subTopicCount: remoteData.subTopics.length,
          });
          setLoadingStage(
            hasForumStructure(remoteData)
              ? 'Ready'
              : 'No forum topics were found after QDN sync checks.'
          );
          setLoadStatus(
            hasForumStructure(remoteData) ? 'ready' : 'empty-confirmed'
          );
          setIsAuthReady(true);
        }
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

        if (session && session.user.id !== GUEST_USER.id) {
          setAuthenticatedAddress(session.authenticatedAddress);
          setUsers([session.user]);
          setCurrentUserId(session.user.id);
        } else {
          setAuthenticatedAddress(null);
          setUsers([GUEST_USER]);
          setCurrentUserId(GUEST_USER.id);
        }
        setTopics([]);
        setSubTopics([]);
        setPosts([]);
        setRoleRegistry(createDefaultRoleRegistry());
        setTopicDirectoryIndex(null);
        setThreadSearchIndexes({});
        loadedIdentityRef.current = session ? identityKey : null;
        setIsAuthReady(true);
      }
    };

    void bootstrapQdnData();

    return () => {
      active = false;
    };
  }, [activeAuthName, applyForumStructure, qortiumBridgeProbe]);

  const authenticate = useCallback(async () => {
    const account = await getUserAccount();
    setSelectedAccount(account);
    setActiveAuthName(account.name?.trim() || account.address?.trim() || null);
    loadedIdentityRef.current = null;
  }, []);

  const retryLoadData = useCallback(() => {
    setIsRetrying(true);
    setLoadError(null);
    setLoadStatus('initializing');
    loadedIdentityRef.current = null;
    setQortiumBridgeProbe(0);
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
