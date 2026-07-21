import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { generateForumEntityId } from '../../../services/forum/forumId';
import {
  getAttachmentExtension,
  getAttachmentSizeLimit,
  isAllowedAttachmentFile,
} from '../../../services/forum/attachments';
import { canAccessSubTopic } from '../../../services/forum/forumAccess';
import { encodeQdnImageTag } from '../../../services/forum/richText';
import { encodeQdnVideoTag } from '../../../services/forum/videoEmbed';
import { threadPostCache } from '../../../services/forum/threadPostCache';
import { recordRecentPostMutation } from '../../../services/forum/postReconciliation';
import {
  publishMultipleQortiumResources,
  type QortiumResourceToPublish,
} from '../../../services/qortium/qortiumClient';
import { forumQdnService } from '../../../services/qdn/forumQdnService';
import type {
  ThreadSearchSnapshot,
  TopicDirectorySnapshot,
} from '../../../services/qdn/forumSearchIndexService';
import { forumSearchIndexService } from '../../../services/qdn/forumSearchIndexService';
import { forumRolesService } from '../../../services/qdn/forumRolesService';
import { writeThreadIndexCache } from '../../../services/qdn/threadIndexCache';
import { authorizeLegacyMutation } from '../../../services/architectureV2/reducer';
import {
  confirmNativePoll,
  createNativePoll,
  isNativePostPoll,
  publishNativePollReference,
  sameNativePollReference,
  submitNativePollVote,
  toPersistedNativePollReference,
} from '../../../services/architectureV2/polls.js';
import type {
  NativePollRecovery,
  V2EntityCreate,
} from '../../../services/architectureV2/types.js';
import type { ModerationAction } from '../../../services/architectureV2/moderation.js';
import { resolveTipDisplay } from '../../../services/architectureV2/tips.js';
import {
  closeNativePoll,
  loadNativePostPoll,
  qortiumNativePollGateway,
} from '../../../services/qortium/nativePollService.js';
import { resolveNameWalletAddress } from '../../../services/qortium/walletService.js';
import type {
  ForumRoleRegistry,
  Post,
  PostAttachment,
  SubTopic,
  Topic,
  TopicAccess,
  User,
} from '../../../types';
import type {
  ForumMutationResult,
  ForumPollDraft,
  ForumTipRecipientResult,
  ForumUploadAttachmentResult,
  ForumUploadImageResult,
  ForumUploadVideoResult,
} from '../types';

const FORUM_VIDEO_LIMITS = {
  maxBytes: 100 * 1024 * 1024,
  acceptedTypes: ['video/mp4', 'video/webm', 'video/ogg'],
} as const;

type UseForumCommandsParams = {
  currentUser: User;
  isAuthenticated: boolean;
  authenticatedAddress: string | null;
  roleRegistry: ForumRoleRegistry;
  topics: Topic[];
  subTopics: SubTopic[];
  posts: Post[];
  setTopicDirectoryIndex: Dispatch<
    SetStateAction<TopicDirectorySnapshot | null>
  >;
  setThreadSearchIndexes: Dispatch<
    SetStateAction<Record<string, ThreadSearchSnapshot>>
  >;
  setRoleRegistry: Dispatch<SetStateAction<ForumRoleRegistry>>;
  setUsers: Dispatch<SetStateAction<User[]>>;
  setTopics: Dispatch<SetStateAction<Topic[]>>;
  setSubTopics: Dispatch<SetStateAction<SubTopic[]>>;
  setPosts: Dispatch<SetStateAction<Post[]>>;
};

const ensureCurrentUserPresent = (users: User[], currentUser: User) => {
  return users.some((user) => user.id === currentUser.id)
    ? users
    : [currentUser, ...users];
};

const publishCompatibilityAndDerivedFragment = async (
  compatibility: QortiumResourceToPublish,
  fragment: QortiumResourceToPublish
) => {
  let compatibilityFailed = false;
  let derivedIndexFailed = false;
  try {
    await publishMultipleQortiumResources([compatibility]);
  } catch {
    compatibilityFailed = true;
  }
  try {
    await publishMultipleQortiumResources([fragment]);
  } catch {
    derivedIndexFailed = true;
  }
  if (!derivedIndexFailed) forumSearchIndexService.invalidateV2IndexCache();
  return { compatibilityFailed, derivedIndexFailed };
};

const normalizeAddressList = (input: string[]) => {
  const seen = new Set<string>();
  const next: string[] = [];

  input.forEach((value) => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    next.push(normalized);
  });

  return next;
};

const isAdminRole = (role: User['role']) =>
  role === 'Admin' || role === 'SuperAdmin' || role === 'SysOp';
const isModeratorRole = (role: User['role']) =>
  role === 'Moderator' ||
  role === 'Admin' ||
  role === 'SuperAdmin' ||
  role === 'SysOp';
const isSuperAdminRole = (role: User['role']) =>
  role === 'SuperAdmin' || role === 'SysOp';
const isSysOpRole = (role: User['role']) => role === 'SysOp';
const TOPIC_DESCRIPTION_MAX_LENGTH = 250;

const loadAuthoritativeNativePollReference = async (post: Post) => {
  if (!isNativePostPoll(post.poll)) {
    throw new Error(
      '[POLL_IDENTITY_MISMATCH] Post does not contain a native poll reference'
    );
  }
  let state;
  try {
    state = await forumQdnService.loadV2AuthorityState(undefined, {
      force: true,
    });
  } catch (error) {
    throw new Error(
      `[POLL_IDENTITY_MISMATCH] V2 Post authority lookup failed: ${
        error instanceof Error ? error.message : 'unknown authority error'
      }`
    );
  }
  if (state.discovery.completeness !== 'complete')
    throw new Error(
      '[PARTIAL_DISCOVERY] Native poll authority discovery is incomplete'
    );
  const entity = state.authoritative.entities[post.id];
  if (
    entity?.entityType !== 'post' ||
    !entity.pollReference ||
    !sameNativePollReference(
      entity.pollReference,
      toPersistedNativePollReference(post.poll)
    )
  ) {
    throw new Error(
      '[POLL_IDENTITY_MISMATCH] native poll reference is not established by the authoritative V2 Post'
    );
  }
  return entity.pollReference;
};

const normalizePollDraft = (draft: ForumPollDraft | null) => {
  if (!draft) {
    return null;
  }

  const question = draft.question.trim();
  const description = draft.description.trim();
  const options = draft.options
    .map((option) => option.trim())
    .filter(Boolean)
    .slice(0, 6);

  if (!question && options.length === 0 && !description) {
    return null;
  }

  if (!question) {
    throw new Error('Poll question is required.');
  }

  if (options.length < 2) {
    throw new Error('Poll requires at least two answer options.');
  }

  let closesAt: string | null = null;
  if (draft.closesAt) {
    const closesAtDate = new Date(draft.closesAt);
    if (Number.isNaN(closesAtDate.getTime())) {
      throw new Error('Poll closing date is invalid.');
    }

    if (closesAtDate.getTime() <= Date.now()) {
      throw new Error('Poll closing date must be in the future.');
    }

    closesAt = closesAtDate.toISOString();
  }

  return {
    question,
    description,
    mode: draft.mode,
    options,
    closesAt,
  };
};

const sortTopicsByOrder = (items: Topic[]) =>
  [...items].sort((a, b) => a.sortOrder - b.sortOrder);

const canCreateSubTopicForTopic = (
  topic: Topic,
  user: User,
  address: string | null
) => {
  if (
    user.role === 'SysOp' ||
    user.role === 'SuperAdmin' ||
    user.role === 'Admin'
  ) {
    return true;
  }

  if (topic.status === 'locked') {
    return false;
  }

  switch (topic.subTopicAccess) {
    case 'everyone':
      return true;
    case 'moderators':
      return isModeratorRole(user.role);
    case 'admins':
      return isAdminRole(user.role);
    case 'custom':
      return Boolean(address && topic.allowedAddresses.includes(address));
    default:
      return false;
  }
};

export const useForumCommands = ({
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
}: UseForumCommandsParams) => {
  const buildTopicDirectoryIndexResource = useCallback(
    (nextTopics: Topic[], nextSubTopics: SubTopic[]) => ({
      snapshot: forumSearchIndexService.buildTopicDirectorySnapshot(
        nextTopics,
        nextSubTopics
      ),
    }),
    []
  );

  const buildThreadIndexResource = useCallback(
    (subTopicId: string, nextPosts: Post[]) => ({
      snapshot: forumSearchIndexService.buildThreadSearchSnapshot(
        subTopicId,
        nextPosts
      ),
    }),
    []
  );

  const publishModeration = useCallback(
    async (input: {
      action: ModerationAction;
      targetType: 'topic' | 'thread' | 'post';
      targetId: string;
      reason?: string;
      orderValue?: number;
      publishDerived?: () => Promise<void>;
    }) => {
      if (!authenticatedAddress?.trim())
        throw new Error(
          '[MODERATION_WALLET_BINDING_MISSING] authenticated wallet is unavailable'
        );
      return forumQdnService.publishV2ModerationOperation(
        {
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId,
          actorName: currentUser.username,
          actorAddress: authenticatedAddress.trim(),
          reason: input.reason,
          orderValue: input.orderValue,
        },
        input.publishDerived
      );
    },
    [authenticatedAddress, currentUser.username]
  );

  const createTopic = useCallback(
    async (input: {
      title: string;
      description: string;
      status: Topic['status'];
      subTopicAccess: TopicAccess;
      allowedAddresses: string[];
      isPoll?: boolean;
    }): Promise<ForumMutationResult> => {
      const title = input.title.trim();
      const description = input.description.trim();
      const allowedAddresses = normalizeAddressList(input.allowedAddresses);

      if (!title || !description) {
        return { ok: false, error: 'Title and description are required.' };
      }

      if (description.length > TOPIC_DESCRIPTION_MAX_LENGTH) {
        return {
          ok: false,
          error: `Description must be ${TOPIC_DESCRIPTION_MAX_LENGTH} characters or less.`,
        };
      }

      if (!isAuthenticated) {
        return { ok: false, error: 'Authenticate with Qortium first.' };
      }

      if (!isAdminRole(currentUser.role)) {
        return {
          ok: false,
          error: 'Only admins, Super Admins and SysOp can create main topics.',
        };
      }

      if (input.status !== 'open')
        return {
          ok: false,
          error:
            'Create the Topic open, then lock it with the independent moderation action after publication.',
        };

      if (input.subTopicAccess === 'custom' && allowedAddresses.length === 0) {
        return {
          ok: false,
          error: 'Add at least one wallet address for custom topic access.',
        };
      }

      const duplicate = topics.some(
        (topic) => topic.title.toLowerCase() === title.toLowerCase()
      );
      if (duplicate) {
        return { ok: false, error: 'A topic with this title already exists.' };
      }

      const createdAt = new Date().toISOString();
      const newTopic: Topic = {
        id: generateForumEntityId('topic', currentUser.username),
        title,
        description,
        createdByUserId: currentUser.id,
        createdAt,
        sortOrder:
          topics.length > 0
            ? Math.max(...topics.map((topic) => topic.sortOrder)) + 1
            : 0,
        status: input.status,
        visibility: 'visible',
        subTopicAccess: input.subTopicAccess,
        allowedAddresses,
      };

      let v2Committed = false;
      try {
        const nextTopics = [newTopic, ...topics];
        const v2Entity: V2EntityCreate = {
          entityType: 'topic',
          entityId: newTopic.id,
          publisherName: currentUser.username,
          walletAddress: authenticatedAddress ?? '',
          title: newTopic.title,
          description: newTopic.description,
        };
        await forumQdnService.publishV2Entity(v2Entity, {
          validatePublisher: (metadata, claimed) =>
            metadata.publisherName.trim().toLowerCase() ===
            claimed.trim().toLowerCase()
              ? { ok: true }
              : {
                  ok: false,
                  code: 'IDENTITY_UNVERIFIED',
                  detail: 'publisher mismatch',
                },
          validateWalletBinding: (_name, wallet) =>
            wallet.trim() === authenticatedAddress?.trim()
              ? { ok: true }
              : {
                  ok: false,
                  code: 'IDENTITY_UNVERIFIED',
                  detail: 'wallet binding unavailable',
                },
        });
        v2Committed = true;
        const topicResource = forumQdnService.buildTopicPublishResource(
          newTopic,
          currentUser.username
        );
        const topicDirectoryResource = buildTopicDirectoryIndexResource(
          nextTopics,
          subTopics
        );
        const fragmentResource =
          forumSearchIndexService.buildV2IndexFragmentPublishResource(
            v2Entity,
            currentUser.username
          );
        const followup = await publishCompatibilityAndDerivedFragment(
          topicResource.resource,
          fragmentResource.resource
        );

        setTopics((current) => [newTopic, ...current]);
        setUsers((current) => ensureCurrentUserPresent(current, currentUser));
        setTopicDirectoryIndex(topicDirectoryResource.snapshot);
        if (followup.compatibilityFailed)
          return {
            ok: true,
            partial: { pending: 'compatibility', retryable: true },
            error: followup.derivedIndexFailed
              ? 'V2 topic committed; legacy compatibility and derived-index publications are pending.'
              : 'V2 topic committed; legacy compatibility publication is pending.',
          };
        if (followup.derivedIndexFailed)
          return {
            ok: true,
            partial: { pending: 'derived-index', retryable: true },
            error:
              'V2 topic committed; the rebuildable search fragment is pending.',
          };
        return { ok: true };
      } catch (error) {
        if (v2Committed) {
          return {
            ok: true,
            partial: { pending: 'compatibility', retryable: true },
            error:
              'V2 topic committed; legacy compatibility publication is pending.',
          };
        }
        return {
          ok: false,
          error:
            error instanceof Error ? error.message : 'Failed to publish topic.',
        };
      }
    },
    [
      authenticatedAddress,
      currentUser,
      isAuthenticated,
      buildTopicDirectoryIndexResource,
      subTopics,
      setTopicDirectoryIndex,
      setTopics,
      setUsers,
      topics,
    ]
  );

  const reorderTopics = useCallback(
    async (orderedTopicIds: string[]): Promise<ForumMutationResult> => {
      if (!isAuthenticated) {
        return { ok: false, error: 'Authenticate with Qortium first.' };
      }

      if (!isSuperAdminRole(currentUser.role)) {
        return {
          ok: false,
          error: 'Only Super Admins and SysOp can reorder main topics.',
        };
      }

      if (orderedTopicIds.length !== topics.length) {
        return { ok: false, error: 'Topic reorder payload is incomplete.' };
      }

      const topicMap = new Map(topics.map((topic) => [topic.id, topic]));
      const reorderedTopics = orderedTopicIds.map((topicId, index) => {
        const topic = topicMap.get(topicId);
        if (!topic) {
          throw new Error('Topic reorder contains an unknown topic id.');
        }

        return {
          ...topic,
          sortOrder: index,
        };
      });

      try {
        const nextTopics = sortTopicsByOrder(reorderedTopics);
        const topicDirectoryResource = buildTopicDirectoryIndexResource(
          nextTopics,
          subTopics
        );
        let committed = 0;
        try {
          for (const topic of reorderedTopics) {
            await publishModeration({
              action: 'set-order',
              targetType: 'topic',
              targetId: topic.id,
              orderValue: topic.sortOrder,
            });
            committed += 1;
          }
        } catch (error) {
          if (committed > 0)
            return {
              ok: true,
              partial: { pending: 'moderation-operations', retryable: true },
              error:
                'Some topic order operations committed; reload before retrying the remaining order.',
            };
          throw error;
        }

        setTopics(nextTopics);
        setTopicDirectoryIndex(topicDirectoryResource.snapshot);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to reorder topics.',
        };
      }
    },
    [
      currentUser.role,
      buildTopicDirectoryIndexResource,
      isAuthenticated,
      publishModeration,
      setTopicDirectoryIndex,
      setTopics,
      subTopics,
      topics,
    ]
  );

  const reorderPinnedSubTopics = useCallback(
    async (input: {
      topicId: string;
      orderedPinnedSubTopicIds: string[];
    }): Promise<ForumMutationResult> => {
      const topicId = input.topicId.trim();
      if (!topicId) {
        return { ok: false, error: 'Main topic id is required.' };
      }

      if (!isAuthenticated) {
        return { ok: false, error: 'Authenticate with Qortium first.' };
      }

      if (!isSuperAdminRole(currentUser.role)) {
        return {
          ok: false,
          error: 'Only Super Admins and SysOp can reorder pinned sub-topics.',
        };
      }

      if (!topics.some((topic) => topic.id === topicId)) {
        return { ok: false, error: 'Main topic not found.' };
      }

      const pinnedInTopic = subTopics.filter(
        (subTopic) => subTopic.topicId === topicId && subTopic.isPinned
      );

      if (pinnedInTopic.length < 2) {
        return { ok: true };
      }

      if (input.orderedPinnedSubTopicIds.length !== pinnedInTopic.length) {
        return {
          ok: false,
          error: 'Pinned sub-topic reorder payload is incomplete.',
        };
      }

      const pinnedIdSet = new Set(pinnedInTopic.map((subTopic) => subTopic.id));
      const orderedIdSet = new Set(input.orderedPinnedSubTopicIds);
      if (
        orderedIdSet.size !== pinnedIdSet.size ||
        [...orderedIdSet].some((id) => !pinnedIdSet.has(id))
      ) {
        return {
          ok: false,
          error: 'Pinned sub-topic reorder contains unknown sub-topic id.',
        };
      }

      const pinnedMap = new Map(
        pinnedInTopic.map((subTopic) => [subTopic.id, subTopic])
      );
      try {
        const reorderedPinned = input.orderedPinnedSubTopicIds.map(
          (subTopicId, index) => {
            const target = pinnedMap.get(subTopicId);
            if (!target) {
              throw new Error(
                'Pinned sub-topic reorder contains an unknown sub-topic id.'
              );
            }

            return {
              ...target,
              moderationOrder: index,
            };
          }
        );

        const reorderedPinnedMap = new Map(
          reorderedPinned.map((subTopic) => [subTopic.id, subTopic])
        );
        const nextSubTopics = subTopics.map(
          (subTopic) => reorderedPinnedMap.get(subTopic.id) ?? subTopic
        );
        const topicDirectoryResource = buildTopicDirectoryIndexResource(
          topics,
          nextSubTopics
        );
        let committed = 0;
        try {
          for (const subTopic of reorderedPinned) {
            await publishModeration({
              action: 'set-order',
              targetType: 'thread',
              targetId: subTopic.id,
              orderValue: subTopic.moderationOrder ?? 0,
            });
            committed += 1;
          }
        } catch (error) {
          if (committed > 0)
            return {
              ok: true,
              partial: { pending: 'moderation-operations', retryable: true },
              error:
                'Some pinned-thread order operations committed; reload before retrying.',
            };
          throw error;
        }

        setSubTopics(nextSubTopics);
        setTopicDirectoryIndex(topicDirectoryResource.snapshot);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to reorder pinned sub-topics.',
        };
      }
    },
    [
      currentUser.role,
      buildTopicDirectoryIndexResource,
      isAuthenticated,
      publishModeration,
      setSubTopics,
      setTopicDirectoryIndex,
      subTopics,
      topics,
    ]
  );

  const createSubTopic = useCallback(
    async (input: {
      topicId: string;
      title: string;
      description: string;
      access: TopicAccess;
      allowedAddresses: string[];
      isPoll?: boolean;
    }): Promise<ForumMutationResult> => {
      const title = input.title.trim();
      const description = input.description.trim();
      const allowedAddresses = normalizeAddressList(input.allowedAddresses);

      if (!title || !description) {
        return { ok: false, error: 'Title and description are required.' };
      }

      if (description.length > TOPIC_DESCRIPTION_MAX_LENGTH) {
        return {
          ok: false,
          error: `Description must be ${TOPIC_DESCRIPTION_MAX_LENGTH} characters or less.`,
        };
      }

      if (!isAuthenticated) {
        return { ok: false, error: 'Authenticate with Qortium first.' };
      }

      if (!topics.some((topic) => topic.id === input.topicId)) {
        return { ok: false, error: 'Main topic not found.' };
      }

      const parentTopic = topics.find((topic) => topic.id === input.topicId);
      if (!parentTopic) {
        return { ok: false, error: 'Main topic not found.' };
      }
      if (
        parentTopic.dataAvailability &&
        parentTopic.dataAvailability !== 'verified-current'
      )
        return {
          ok: false,
          error:
            '[PARTIAL_DISCOVERY] Topic authority is partial or cached; thread creation failed closed.',
        };

      if (
        !canCreateSubTopicForTopic(
          parentTopic,
          currentUser,
          authenticatedAddress
        )
      ) {
        return {
          ok: false,
          error:
            'You do not have permission to create a sub-topic under this main topic.',
        };
      }

      if (input.access === 'custom' && allowedAddresses.length === 0) {
        return {
          ok: false,
          error: 'Add at least one wallet address for custom sub-topic access.',
        };
      }
      const duplicate = subTopics.some(
        (subTopic) =>
          subTopic.topicId === input.topicId &&
          subTopic.title.toLowerCase() === title.toLowerCase()
      );
      if (duplicate) {
        return {
          ok: false,
          error:
            'This sub-topic title already exists under selected main topic.',
        };
      }

      const createdAt = new Date().toISOString();
      const newSubTopic: SubTopic = {
        id: generateForumEntityId('subtopic', currentUser.username),
        topicId: input.topicId,
        title,
        description,
        authorUserId: currentUser.id,
        createdAt,
        lastPostAt: createdAt,
        lastPostAuthorUserId: currentUser.id,
        isPinned: false,
        pinnedAt: null,
        isSolved: false,
        solvedAt: null,
        solvedByUserId: null,
        isPoll: input.isPoll === true,
        access: input.access,
        allowedAddresses,
        status: 'open',
        visibility: 'visible',
        lastModerationAction: null,
        lastModerationReason: null,
        lastModeratedByUserId: null,
        lastModeratedAt: null,
      };

      let v2Committed = false;
      try {
        const nextSubTopics = [newSubTopic, ...subTopics];
        const v2Entity: V2EntityCreate = {
          entityType: 'thread',
          entityId: newSubTopic.id,
          parentTopicId: newSubTopic.topicId,
          publisherName: currentUser.username,
          walletAddress: authenticatedAddress ?? '',
          title: newSubTopic.title,
          description: newSubTopic.description,
        };
        await forumQdnService.publishV2Entity(v2Entity, {
          validatePublisher: (metadata, claimed) =>
            metadata.publisherName.trim().toLowerCase() ===
            claimed.trim().toLowerCase()
              ? { ok: true }
              : {
                  ok: false,
                  code: 'IDENTITY_UNVERIFIED',
                  detail: 'publisher mismatch',
                },
          validateWalletBinding: (_name, wallet) =>
            wallet.trim() === authenticatedAddress?.trim()
              ? { ok: true }
              : {
                  ok: false,
                  code: 'IDENTITY_UNVERIFIED',
                  detail: 'wallet binding unavailable',
                },
        });
        v2Committed = true;
        const subTopicResource = forumQdnService.buildSubTopicPublishResource(
          newSubTopic,
          currentUser.username
        );
        const topicDirectoryResource = buildTopicDirectoryIndexResource(
          topics,
          nextSubTopics
        );
        const fragmentResource =
          forumSearchIndexService.buildV2IndexFragmentPublishResource(
            v2Entity,
            currentUser.username
          );
        const followup = await publishCompatibilityAndDerivedFragment(
          subTopicResource.resource,
          fragmentResource.resource
        );

        setSubTopics((current) => [newSubTopic, ...current]);
        setUsers((current) => ensureCurrentUserPresent(current, currentUser));
        setTopicDirectoryIndex(topicDirectoryResource.snapshot);
        if (followup.compatibilityFailed)
          return {
            ok: true,
            subTopicId: newSubTopic.id,
            partial: { pending: 'compatibility', retryable: true },
            error: followup.derivedIndexFailed
              ? 'V2 thread committed; legacy compatibility and derived-index publications are pending.'
              : 'V2 thread committed; legacy compatibility publication is pending.',
          };
        if (followup.derivedIndexFailed)
          return {
            ok: true,
            subTopicId: newSubTopic.id,
            partial: { pending: 'derived-index', retryable: true },
            error:
              'V2 thread committed; the rebuildable search fragment is pending.',
          };
        return { ok: true, subTopicId: newSubTopic.id };
      } catch (error) {
        if (v2Committed) {
          return {
            ok: true,
            subTopicId: newSubTopic.id,
            partial: { pending: 'compatibility', retryable: true },
            error:
              'V2 thread committed; legacy compatibility publication is pending.',
          };
        }
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to publish sub-topic.',
        };
      }
    },
    [
      currentUser,
      authenticatedAddress,
      buildTopicDirectoryIndexResource,
      isAuthenticated,
      setTopicDirectoryIndex,
      setSubTopics,
      setUsers,
      subTopics,
      topics,
    ]
  );

  const updateTopicOwnerContent = useCallback(
    async (input: {
      topicId: string;
      title: string;
      description: string;
    }): Promise<ForumMutationResult> => {
      const target = topics.find((topic) => topic.id === input.topicId);
      if (!target) return { ok: false, error: 'Main topic not found.' };
      if (!isAuthenticated)
        return { ok: false, error: 'Authenticate with Qortium first.' };
      try {
        await forumQdnService.publishV2OwnerEdit(
          {
            operation: 'owner-edit',
            targetType: 'topic',
            targetId: target.id,
            publisherName: currentUser.username,
            walletAddress: authenticatedAddress ?? '',
            changes: {
              title: input.title.trim(),
              description: input.description.trim(),
            },
          },
          currentUser.username,
          {
            validatePublisher: (metadata, claimed) =>
              metadata.publisherName.trim().toLowerCase() ===
              claimed.trim().toLowerCase()
                ? { ok: true }
                : {
                    ok: false,
                    code: 'IDENTITY_UNVERIFIED',
                    detail: 'publisher mismatch',
                  },
            validateWalletBinding: (_name, wallet) =>
              wallet.trim() === authenticatedAddress?.trim()
                ? { ok: true }
                : {
                    ok: false,
                    code: 'IDENTITY_UNVERIFIED',
                    detail: 'wallet binding unavailable',
                  },
          }
        );
        const fragment =
          forumSearchIndexService.buildV2IndexFragmentPublishResource(
            {
              entityType: 'topic',
              entityId: target.id,
              publisherName: currentUser.username,
              walletAddress: authenticatedAddress ?? '',
              title: input.title.trim(),
              description: input.description.trim(),
            },
            currentUser.username
          );
        try {
          await publishMultipleQortiumResources([fragment.resource]);
          forumSearchIndexService.invalidateV2IndexCache();
          return { ok: true };
        } catch {
          return {
            ok: true,
            partial: { pending: 'derived-index', retryable: true },
            error:
              'Topic edit committed; the rebuildable search fragment is pending.',
          };
        }
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : '[LEGACY_AUTHORITY_BLOCKED] owner authority unavailable.',
        };
      }
    },
    [authenticatedAddress, currentUser.username, isAuthenticated, topics]
  );

  const updateTopicSettings = useCallback(
    async (input: {
      topicId: string;
      title: string;
      description: string;
      status: Topic['status'];
      visibility: Topic['visibility'];
      subTopicAccess: TopicAccess;
      allowedAddresses: string[];
    }): Promise<ForumMutationResult> => {
      const target = topics.find((topic) => topic.id === input.topicId);
      if (!target) {
        return { ok: false, error: 'Main topic not found.' };
      }

      if (!isAuthenticated) {
        return { ok: false, error: 'Authenticate with Qortium first.' };
      }

      if (!isAdminRole(currentUser.role)) {
        return { ok: false, error: 'Only admins can manage main topics.' };
      }

      const title = input.title.trim();
      const description = input.description.trim();
      if (!title || !description) {
        return {
          ok: false,
          error: 'Main topic title and description are required.',
        };
      }

      if (description.length > TOPIC_DESCRIPTION_MAX_LENGTH) {
        return {
          ok: false,
          error: `Main topic description must be ${TOPIC_DESCRIPTION_MAX_LENGTH} characters or less.`,
        };
      }

      const allowedAddresses = normalizeAddressList(input.allowedAddresses);
      if (input.subTopicAccess === 'custom' && allowedAddresses.length === 0) {
        return {
          ok: false,
          error: 'Add at least one wallet address for custom topic access.',
        };
      }

      const sameAllowedAddresses =
        allowedAddresses.length === target.allowedAddresses.length &&
        allowedAddresses.every(
          (address, index) => address === target.allowedAddresses[index]
        );
      if (
        input.subTopicAccess !== target.subTopicAccess ||
        !sameAllowedAddresses
      )
        return {
          ok: false,
          error:
            '[FORBIDDEN_FIELD] Topic access configuration is not a moderation field and remains feature-gated.',
        };

      const updatedTopic: Topic = {
        ...target,
        title,
        description,
        status: input.status,
        visibility: input.visibility,
        subTopicAccess: input.subTopicAccess,
        allowedAddresses,
      };

      try {
        const nextTopics = topics.map((topic) =>
          topic.id === target.id ? updatedTopic : topic
        );
        const topicDirectoryResource = buildTopicDirectoryIndexResource(
          nextTopics,
          subTopics
        );
        let authoritativeChanges = 0;
        if (title !== target.title || description !== target.description) {
          const ownerEdit = await updateTopicOwnerContent({
            topicId: target.id,
            title,
            description,
          });
          if (!ownerEdit.ok) return ownerEdit;
          authoritativeChanges += 1;
        }
        const operations: Array<{ action: ModerationAction }> = [];
        if (input.status !== target.status)
          operations.push({
            action: input.status === 'locked' ? 'lock' : 'unlock',
          });
        if (input.visibility !== target.visibility)
          operations.push({
            action: input.visibility === 'hidden' ? 'hide' : 'unhide',
          });
        try {
          for (const operation of operations) {
            await publishModeration({
              action: operation.action,
              targetType: 'topic',
              targetId: target.id,
            });
            authoritativeChanges += 1;
          }
        } catch (error) {
          if (authoritativeChanges > 0)
            return {
              ok: true,
              partial: { pending: 'moderation-operations', retryable: true },
              error:
                'Some authoritative topic changes committed; reload before retrying.',
            };
          throw error;
        }
        setTopics((current) =>
          current.map((topic) =>
            topic.id === target.id ? updatedTopic : topic
          )
        );
        setTopicDirectoryIndex(topicDirectoryResource.snapshot);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to update main topic.',
        };
      }
    },
    [
      currentUser.role,
      buildTopicDirectoryIndexResource,
      isAuthenticated,
      publishModeration,
      setTopicDirectoryIndex,
      setTopics,
      subTopics,
      topics,
      updateTopicOwnerContent,
    ]
  );

  const updateSubTopicOwnerContent = useCallback(
    async (input: {
      subTopicId: string;
      title: string;
      description: string;
    }): Promise<ForumMutationResult> => {
      const target = subTopics.find(
        (subTopic) => subTopic.id === input.subTopicId
      );
      if (!target) return { ok: false, error: 'Sub-topic not found.' };
      if (!isAuthenticated)
        return { ok: false, error: 'Authenticate with Qortium first.' };
      try {
        await forumQdnService.publishV2OwnerEdit(
          {
            operation: 'owner-edit',
            targetType: 'thread',
            targetId: target.id,
            publisherName: currentUser.username,
            walletAddress: authenticatedAddress ?? '',
            changes: {
              title: input.title.trim(),
              description: input.description.trim(),
            },
          },
          currentUser.username,
          {
            validatePublisher: (metadata, claimed) =>
              metadata.publisherName.trim().toLowerCase() ===
              claimed.trim().toLowerCase()
                ? { ok: true }
                : {
                    ok: false,
                    code: 'IDENTITY_UNVERIFIED',
                    detail: 'publisher mismatch',
                  },
            validateWalletBinding: (_name, wallet) =>
              wallet.trim() === authenticatedAddress?.trim()
                ? { ok: true }
                : {
                    ok: false,
                    code: 'IDENTITY_UNVERIFIED',
                    detail: 'wallet binding unavailable',
                  },
          }
        );
        const fragment =
          forumSearchIndexService.buildV2IndexFragmentPublishResource(
            {
              entityType: 'thread',
              entityId: target.id,
              parentTopicId: target.topicId,
              publisherName: currentUser.username,
              walletAddress: authenticatedAddress ?? '',
              title: input.title.trim(),
              description: input.description.trim(),
            },
            currentUser.username
          );
        try {
          await publishMultipleQortiumResources([fragment.resource]);
          forumSearchIndexService.invalidateV2IndexCache();
          return { ok: true };
        } catch {
          return {
            ok: true,
            partial: { pending: 'derived-index', retryable: true },
            error:
              'Thread edit committed; the rebuildable search fragment is pending.',
          };
        }
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : '[LEGACY_AUTHORITY_BLOCKED] owner authority unavailable.',
        };
      }
    },
    [authenticatedAddress, currentUser.username, isAuthenticated, subTopics]
  );

  const updateSubTopicSettings = useCallback(
    async (input: {
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
    }): Promise<ForumMutationResult> => {
      const target = subTopics.find(
        (subTopic) => subTopic.id === input.subTopicId
      );
      if (!target) {
        return { ok: false, error: 'Sub-topic not found.' };
      }

      if (!isAuthenticated) {
        return { ok: false, error: 'Authenticate with Qortium first.' };
      }

      if (!isModeratorRole(currentUser.role)) {
        return {
          ok: false,
          error:
            'Only moderators, admins, Super Admins and SysOp can manage sub-topics.',
        };
      }

      const normalizedAllowedAddresses = normalizeAddressList(
        input.allowedAddresses
      );
      const sameAllowedAddresses =
        normalizedAllowedAddresses.length === target.allowedAddresses.length &&
        normalizedAllowedAddresses.every(
          (address, index) => address === target.allowedAddresses[index]
        );
      const nextTopicId = input.topicId?.trim() || target.topicId;
      const isStatusChanged = input.status !== target.status;
      const isVisibilityChanged = input.visibility !== target.visibility;
      const isPinnedChanged = input.isPinned !== target.isPinned;
      const isSolvedChanged = input.isSolved !== target.isSolved;
      const isPollChanged = (input.isPoll ?? target.isPoll) !== target.isPoll;
      const isTitleChanged = input.title.trim() !== target.title;
      const isDescriptionChanged =
        input.description.trim() !== target.description;
      const isTopicChanged = nextTopicId !== target.topicId;
      const isAccessChanged = input.access !== target.access;
      const hasConfigurationChanges =
        isTitleChanged ||
        isDescriptionChanged ||
        isVisibilityChanged ||
        isPinnedChanged ||
        isSolvedChanged ||
        isPollChanged ||
        isTopicChanged ||
        isAccessChanged ||
        !sameAllowedAddresses;

      if (currentUser.role === 'Moderator') {
        const onlyStatusChange = isStatusChanged && !hasConfigurationChanges;
        if (!onlyStatusChange) {
          return {
            ok: false,
            error:
              'Moderators can only lock or unlock sub-topics. Ask an admin for other changes.',
          };
        }
      }

      const moderationActions: string[] = [];
      if (isStatusChanged) {
        moderationActions.push(input.status === 'locked' ? 'lock' : 'unlock');
      }
      if (isVisibilityChanged) {
        moderationActions.push(input.visibility === 'hidden' ? 'hide' : 'show');
      }
      if (isPinnedChanged) {
        moderationActions.push(input.isPinned ? 'pin' : 'unpin');
      }
      if (isSolvedChanged) {
        moderationActions.push(input.isSolved ? 'mark-solved' : 'clear-solved');
      }
      const moderationReason = input.moderationReason?.trim() ?? '';
      const hasModerationAction = moderationActions.length > 0;

      const title = input.title.trim();
      const description = input.description.trim();
      if (!title || !description) {
        return {
          ok: false,
          error: 'Sub-topic title and description are required.',
        };
      }

      if (description.length > TOPIC_DESCRIPTION_MAX_LENGTH) {
        return {
          ok: false,
          error: `Sub-topic description must be ${TOPIC_DESCRIPTION_MAX_LENGTH} characters or less.`,
        };
      }

      if (!topics.some((topic) => topic.id === nextTopicId)) {
        return { ok: false, error: 'Target main topic not found.' };
      }

      const allowedAddresses = normalizedAllowedAddresses;
      if (input.access === 'custom' && allowedAddresses.length === 0) {
        return {
          ok: false,
          error: 'Add at least one wallet address for custom sub-topic access.',
        };
      }
      if (
        isTopicChanged ||
        isAccessChanged ||
        isPollChanged ||
        !sameAllowedAddresses
      )
        return {
          ok: false,
          error:
            '[FORBIDDEN_FIELD] Thread parent/access/poll configuration is not moderation state and remains feature-gated.',
        };

      const updatedSubTopic: SubTopic = {
        ...target,
        topicId: nextTopicId,
        title,
        description,
        status: input.status,
        visibility: input.visibility,
        isPinned: input.isPinned,
        pinnedAt: input.isPinned
          ? (target.pinnedAt ?? new Date().toISOString())
          : null,
        isSolved: input.isSolved,
        solvedAt: input.isSolved
          ? (target.solvedAt ?? new Date().toISOString())
          : null,
        solvedByUserId: input.isSolved
          ? (target.solvedByUserId ?? currentUser.id)
          : null,
        isPoll: input.isPoll ?? target.isPoll,
        access: input.access,
        allowedAddresses,
        lastModerationAction: hasModerationAction
          ? moderationActions.join(',')
          : (target.lastModerationAction ?? null),
        lastModerationReason: hasModerationAction
          ? moderationReason || null
          : (target.lastModerationReason ?? null),
        lastModeratedByUserId: hasModerationAction
          ? currentUser.id
          : (target.lastModeratedByUserId ?? null),
        lastModeratedAt: hasModerationAction
          ? new Date().toISOString()
          : (target.lastModeratedAt ?? null),
      };

      try {
        const nextSubTopics = subTopics.map((subTopic) =>
          subTopic.id === target.id ? updatedSubTopic : subTopic
        );
        const topicDirectoryResource = buildTopicDirectoryIndexResource(
          topics,
          nextSubTopics
        );
        let authoritativeChanges = 0;
        if (isTitleChanged || isDescriptionChanged) {
          const ownerEdit = await updateSubTopicOwnerContent({
            subTopicId: target.id,
            title,
            description,
          });
          if (!ownerEdit.ok) return ownerEdit;
          authoritativeChanges += 1;
        }
        const operations: ModerationAction[] = [];
        if (isStatusChanged)
          operations.push(input.status === 'locked' ? 'lock' : 'unlock');
        if (isVisibilityChanged)
          operations.push(input.visibility === 'hidden' ? 'hide' : 'unhide');
        if (isPinnedChanged) operations.push(input.isPinned ? 'pin' : 'unpin');
        if (isSolvedChanged)
          operations.push(input.isSolved ? 'solve' : 'unsolve');
        try {
          for (const action of operations) {
            await publishModeration({
              action,
              targetType: 'thread',
              targetId: target.id,
              reason: moderationReason,
            });
            authoritativeChanges += 1;
          }
        } catch (error) {
          if (authoritativeChanges > 0)
            return {
              ok: true,
              partial: { pending: 'moderation-operations', retryable: true },
              error:
                'Some authoritative thread changes committed; reload before retrying.',
            };
          throw error;
        }
        setSubTopics((current) =>
          current.map((subTopic) =>
            subTopic.id === target.id ? updatedSubTopic : subTopic
          )
        );
        setTopicDirectoryIndex(topicDirectoryResource.snapshot);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to update sub-topic.',
        };
      }
    },
    [
      currentUser.id,
      currentUser.role,
      buildTopicDirectoryIndexResource,
      isAuthenticated,
      publishModeration,
      setTopicDirectoryIndex,
      setSubTopics,
      subTopics,
      topics,
      updateSubTopicOwnerContent,
    ]
  );

  const toggleSubTopicSolved = useCallback(
    async (input: {
      subTopicId: string;
      reason?: string | null;
    }): Promise<ForumMutationResult> => {
      const target = subTopics.find(
        (subTopic) => subTopic.id === input.subTopicId
      );
      if (!target) {
        return { ok: false, error: 'Sub-topic not found.' };
      }

      if (!isAuthenticated) {
        return { ok: false, error: 'Authenticate with Qortium first.' };
      }

      if (!isModeratorRole(currentUser.role)) {
        return {
          ok: false,
          error:
            'Only moderators, admins, Super Admins and SysOp can change solved state.',
        };
      }

      const reason = input.reason?.trim() ?? '';

      const updatedSubTopic: SubTopic = {
        ...target,
        isSolved: !target.isSolved,
        solvedAt: target.isSolved ? null : new Date().toISOString(),
        solvedByUserId: target.isSolved ? null : currentUser.id,
        lastModerationAction: target.isSolved ? 'clear-solved' : 'mark-solved',
        lastModerationReason: reason || null,
        lastModeratedByUserId: currentUser.id,
        lastModeratedAt: new Date().toISOString(),
      };

      try {
        const nextSubTopics = subTopics.map((subTopic) =>
          subTopic.id === target.id ? updatedSubTopic : subTopic
        );
        const topicDirectoryResource = buildTopicDirectoryIndexResource(
          topics,
          nextSubTopics
        );
        const published = await publishModeration({
          action: target.isSolved ? 'unsolve' : 'solve',
          targetType: 'thread',
          targetId: target.id,
          reason,
        });

        setSubTopics((current) =>
          current.map((subTopic) =>
            subTopic.id === target.id ? updatedSubTopic : subTopic
          )
        );
        setTopicDirectoryIndex(topicDirectoryResource.snapshot);
        return 'partial' in published
          ? { ok: true, partial: published.partial, error: published.detail }
          : { ok: true };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to update solved state.',
        };
      }
    },
    [
      currentUser.id,
      currentUser.role,
      buildTopicDirectoryIndexResource,
      isAuthenticated,
      publishModeration,
      setSubTopics,
      setTopicDirectoryIndex,
      subTopics,
      topics,
    ]
  );

  const upsertRoleAssignment = useCallback(
    async (input: {
      address: string;
      role: 'SuperAdmin' | 'Admin' | 'Moderator';
    }): Promise<ForumMutationResult> => {
      const address = input.address.trim();

      if (!address) {
        return { ok: false, error: 'Wallet address is required.' };
      }

      if (!isAuthenticated || !authenticatedAddress) {
        return { ok: false, error: 'Authenticate with Qortium first.' };
      }

      const isPrimarySysOp =
        isSysOpRole(currentUser.role) &&
        authenticatedAddress === roleRegistry.primarySysOpAddress;
      const isSuperAdmin = currentUser.role === 'SuperAdmin';
      const isAdmin = currentUser.role === 'Admin';

      if (!isPrimarySysOp && !isSuperAdmin && !isAdmin) {
        return {
          ok: false,
          error: 'Only SysOp, Super Admin or Admin can manage forum roles.',
        };
      }

      if (address === roleRegistry.primarySysOpAddress) {
        return {
          ok: false,
          error: 'The primary SysOp address is fixed and cannot be reassigned.',
        };
      }

      if (isAdmin && input.role !== 'Moderator') {
        return {
          ok: false,
          error: 'Admins can only assign Moderator role.',
        };
      }

      if (isSuperAdmin && input.role === 'SuperAdmin') {
        return {
          ok: false,
          error: 'Only SysOp can assign Super Admin role.',
        };
      }

      try {
        const published = await forumRolesService.publishRoleOperation({
          action: 'assign',
          role: input.role,
          targetAddress: address,
          actorName: currentUser.username,
          actorAddress: authenticatedAddress,
        });
        if (!published.ok)
          return {
            ok: false,
            error: `[${published.code}] ${published.detail}`,
          };
        if ('partial' in published)
          return {
            ok: true,
            error: published.detail,
            partial: published.partial,
          };
        setRoleRegistry(published.state.registry);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to update forum role registry.',
        };
      }
    },
    [
      authenticatedAddress,
      currentUser.role,
      currentUser.username,
      isAuthenticated,
      roleRegistry,
      setRoleRegistry,
    ]
  );

  const removeRoleAssignment = useCallback(
    async (address: string): Promise<ForumMutationResult> => {
      const normalizedAddress = address.trim();

      if (!normalizedAddress) {
        return { ok: false, error: 'Wallet address is required.' };
      }

      if (!isAuthenticated || !authenticatedAddress) {
        return { ok: false, error: 'Authenticate with Qortium first.' };
      }

      const isPrimarySysOp =
        isSysOpRole(currentUser.role) &&
        authenticatedAddress === roleRegistry.primarySysOpAddress;
      const isSuperAdmin = currentUser.role === 'SuperAdmin';
      const isAdmin = currentUser.role === 'Admin';

      if (!isPrimarySysOp && !isSuperAdmin && !isAdmin) {
        return {
          ok: false,
          error: 'Only SysOp, Super Admin or Admin can manage forum roles.',
        };
      }

      if (normalizedAddress === roleRegistry.primarySysOpAddress) {
        return {
          ok: false,
          error: 'The primary SysOp role cannot be removed.',
        };
      }

      const isTargetSuperAdmin =
        roleRegistry.sysOps.includes(normalizedAddress);
      const isTargetAdmin = roleRegistry.admins.includes(normalizedAddress);
      const isTargetModerator =
        roleRegistry.moderators.includes(normalizedAddress);

      if (isAdmin && !isTargetModerator) {
        return {
          ok: false,
          error: 'Admins can only remove Moderator role.',
        };
      }

      if (
        isSuperAdmin &&
        !isTargetSuperAdmin &&
        !isTargetAdmin &&
        !isTargetModerator
      ) {
        return {
          ok: false,
          error:
            'Super Admin can only remove Super Admin, Admin or Moderator roles.',
        };
      }

      if (isSuperAdmin && isTargetSuperAdmin) {
        return {
          ok: false,
          error: 'Only SysOp can remove Super Admin role.',
        };
      }

      const targetRole = isTargetSuperAdmin
        ? 'SuperAdmin'
        : isTargetAdmin
          ? 'Admin'
          : isTargetModerator
            ? 'Moderator'
            : null;
      if (!targetRole)
        return {
          ok: false,
          error: 'The target does not currently hold a delegated role.',
        };

      try {
        const published = await forumRolesService.publishRoleOperation({
          action: 'revoke',
          role: targetRole,
          targetAddress: normalizedAddress,
          actorName: currentUser.username,
          actorAddress: authenticatedAddress,
        });
        if (!published.ok)
          return {
            ok: false,
            error: `[${published.code}] ${published.detail}`,
          };
        if ('partial' in published)
          return {
            ok: true,
            error: published.detail,
            partial: published.partial,
          };
        setRoleRegistry(published.state.registry);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to update forum role registry.',
        };
      }
    },
    [
      authenticatedAddress,
      currentUser.role,
      currentUser.username,
      isAuthenticated,
      roleRegistry,
      setRoleRegistry,
    ]
  );

  const createPost = useCallback(
    async (input: {
      subTopicId: string;
      content: string;
      parentPostId?: string | null;
      attachments?: PostAttachment[];
      poll?: ForumPollDraft | null;
      nativePollRecovery?: NativePollRecovery;
    }): Promise<ForumMutationResult> => {
      const content = input.content.trim();
      const attachments = input.attachments ?? [];
      let normalizedPoll: ReturnType<typeof normalizePollDraft>;
      try {
        normalizedPoll = normalizePollDraft(input.poll ?? null);
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'Poll configuration is invalid.',
        };
      }

      if (!content && attachments.length === 0 && !normalizedPoll) {
        return {
          ok: false,
          error: 'Post content, attachment or poll is required.',
        };
      }

      if (!isAuthenticated) {
        return { ok: false, error: 'Authenticate with Qortium first.' };
      }

      if (!subTopics.some((subTopic) => subTopic.id === input.subTopicId)) {
        return { ok: false, error: 'Sub-topic not found.' };
      }

      const targetSubTopic = subTopics.find(
        (subTopic) => subTopic.id === input.subTopicId
      );
      if (!targetSubTopic) {
        return { ok: false, error: 'Sub-topic not found.' };
      }
      if (
        targetSubTopic.dataAvailability &&
        targetSubTopic.dataAvailability !== 'verified-current'
      )
        return {
          ok: false,
          error:
            '[PARTIAL_DISCOVERY] Thread authority is partial or cached; post creation failed closed.',
        };

      if (targetSubTopic.status === 'locked') {
        return { ok: false, error: 'This sub-topic is locked.' };
      }

      if (
        targetSubTopic.visibility === 'hidden' &&
        !isModeratorRole(currentUser.role)
      ) {
        return { ok: false, error: 'This sub-topic is hidden.' };
      }

      if (
        !canAccessSubTopic(targetSubTopic, currentUser, authenticatedAddress)
      ) {
        return {
          ok: false,
          error: 'You do not have access to post in this sub-topic.',
        };
      }

      if (input.parentPostId) {
        const parentPost = posts.find((post) => post.id === input.parentPostId);
        if (!parentPost || parentPost.subTopicId !== input.subTopicId) {
          return {
            ok: false,
            error: 'The reply target post was not found in this thread.',
          };
        }
      }

      if (normalizedPoll && !targetSubTopic.isPoll) {
        return {
          ok: false,
          error: 'Polls can only be added inside Poll / Voting topics.',
        };
      }

      const createdAt = new Date().toISOString();
      const postId =
        input.nativePollRecovery?.postId ??
        generateForumEntityId('post', currentUser.username);
      let nativePollRecovery = input.nativePollRecovery;
      let poll: Post['poll'] = null;
      if (normalizedPoll) {
        if (!authenticatedAddress?.trim()) {
          return {
            ok: false,
            error:
              '[POLL_IDENTITY_MISMATCH] authenticated wallet is required to create a native poll.',
          };
        }
        let boundWallet: string | null = null;
        try {
          boundWallet = await resolveNameWalletAddress(currentUser.username);
        } catch {
          boundWallet = null;
        }
        if (boundWallet?.trim() !== authenticatedAddress.trim()) {
          return {
            ok: false,
            error:
              '[POLL_IDENTITY_MISMATCH] Current Qortium name is not bound to the authenticated wallet.',
          };
        }
        const definition = {
          question: normalizedPoll.question,
          description: normalizedPoll.description,
          selectionMode: normalizedPoll.mode,
          options: normalizedPoll.options.map((label, offset) => ({
            index: offset + 1,
            label,
          })),
          startsAt: null,
          closesAt: normalizedPoll.closesAt,
        };
        if (
          nativePollRecovery &&
          (nativePollRecovery.creatorName !== currentUser.username ||
            nativePollRecovery.creatorAddress !== authenticatedAddress ||
            JSON.stringify(nativePollRecovery.definition) !==
              JSON.stringify(definition))
        ) {
          return {
            ok: false,
            error:
              '[POLL_IDENTITY_MISMATCH] saved native poll recovery does not match this draft or identity.',
          };
        }
        try {
          let reference = nativePollRecovery
            ? await confirmNativePoll(
                nativePollRecovery,
                qortiumNativePollGateway
              )
            : null;
          if (!nativePollRecovery) {
            const created = await createNativePoll(
              {
                postId,
                creatorName: currentUser.username,
                creatorAddress: authenticatedAddress,
                definition,
              },
              qortiumNativePollGateway
            );
            nativePollRecovery = created.recovery;
            reference = created.reference;
          }
          if (!reference || !nativePollRecovery) {
            return {
              ok: false,
              partial: {
                pending: 'native-poll-confirmation',
                retryable: true,
              },
              nativePollRecovery,
              error:
                '[NATIVE_POLL_UNAVAILABLE] Native poll was submitted but is not confirmed yet. Retry publishing this post after Core confirms it.',
            };
          }
          nativePollRecovery = {
            ...nativePollRecovery,
            pollId: reference.pollId,
          };
          poll = await loadNativePostPoll(reference, authenticatedAddress);
        } catch (error) {
          return {
            ok: false,
            nativePollRecovery,
            error:
              error instanceof Error
                ? error.message
                : '[POLL_CREATION_FAILED] Failed to create native poll.',
          };
        }
      } else if (nativePollRecovery) {
        return {
          ok: false,
          error:
            '[POLL_REFERENCE_PUBLICATION_FAILED] Poll recovery cannot be used without its poll draft.',
        };
      }
      const newPost: Post = {
        id: postId,
        subTopicId: input.subTopicId,
        authorUserId: currentUser.id,
        parentPostId: input.parentPostId ?? null,
        content,
        attachments,
        poll,
        createdAt,
        updatedAt: createdAt,
        isPinned: false,
        pinnedAt: null,
        pinnedByUserId: null,
        likes: 0,
        tips: 0,
        likedByAddresses: [],
      };

      let v2Committed = false;
      try {
        const nextPosts = [...posts, newPost];
        const pollReference = isNativePostPoll(newPost.poll)
          ? toPersistedNativePollReference(newPost.poll)
          : null;
        const v2Entity: V2EntityCreate = {
          entityType: 'post',
          entityId: newPost.id,
          parentThreadId: newPost.subTopicId,
          parentPostId: newPost.parentPostId,
          publisherName: currentUser.username,
          walletAddress: authenticatedAddress ?? '',
          content: newPost.content,
          pollReference,
        };
        const publishV2Post = () =>
          forumQdnService.publishV2Entity(v2Entity, {
            validatePublisher: (metadata, claimed) =>
              metadata.publisherName.trim().toLowerCase() ===
              claimed.trim().toLowerCase()
                ? { ok: true }
                : {
                    ok: false,
                    code: 'IDENTITY_UNVERIFIED',
                    detail: 'publisher mismatch',
                  },
            validateWalletBinding: (_name, wallet) =>
              wallet.trim() === authenticatedAddress?.trim()
                ? { ok: true }
                : {
                    ok: false,
                    code: 'IDENTITY_UNVERIFIED',
                    detail: 'wallet binding unavailable',
                  },
          });
        if (pollReference && nativePollRecovery) {
          const publication = await publishNativePollReference(
            pollReference,
            nativePollRecovery,
            publishV2Post
          );
          if (publication.ok === false) {
            return {
              ok: false,
              partial: { pending: 'poll-reference', retryable: true },
              nativePollRecovery: publication.recovery,
              error: `[${publication.code}] ${publication.detail}`,
            };
          }
        } else {
          await publishV2Post();
        }
        v2Committed = true;
        const nextSubTopics = subTopics.map((subTopic) =>
          subTopic.id === input.subTopicId
            ? {
                ...subTopic,
                lastPostAt: createdAt,
                lastPostAuthorUserId: currentUser.id,
              }
            : subTopic
        );
        const postResource = forumQdnService.buildPostPublishResource(
          newPost,
          currentUser.username
        );
        const threadIndexResource = buildThreadIndexResource(
          input.subTopicId,
          nextPosts
        );
        const threadPostsForSubTopic = nextPosts.filter(
          (post) => post.subTopicId === input.subTopicId
        );
        const topicDirectoryResource = buildTopicDirectoryIndexResource(
          topics,
          nextSubTopics
        );
        const fragmentResource =
          forumSearchIndexService.buildV2IndexFragmentPublishResource(
            v2Entity,
            currentUser.username
          );
        const followup = await publishCompatibilityAndDerivedFragment(
          postResource.resource,
          fragmentResource.resource
        );

        recordRecentPostMutation(newPost);
        threadPostCache.write(input.subTopicId, threadPostsForSubTopic);
        writeThreadIndexCache(input.subTopicId, threadIndexResource.snapshot);

        setPosts((current) => {
          const next = [...current, newPost];
          threadPostCache.write(input.subTopicId, threadPostsForSubTopic);
          return next;
        });
        setSubTopics((current) =>
          current.map((subTopic) =>
            subTopic.id === input.subTopicId
              ? { ...subTopic, lastPostAt: createdAt }
              : subTopic
          )
        );
        setUsers((current) => ensureCurrentUserPresent(current, currentUser));
        setThreadSearchIndexes((current) => ({
          ...current,
          [input.subTopicId]: threadIndexResource.snapshot,
        }));
        setTopicDirectoryIndex(topicDirectoryResource.snapshot);
        if (followup.compatibilityFailed)
          return {
            ok: true,
            partial: { pending: 'compatibility', retryable: true },
            error: followup.derivedIndexFailed
              ? 'V2 post committed; legacy compatibility and derived-index publications are pending.'
              : 'V2 post committed; legacy compatibility publication is pending.',
          };
        if (followup.derivedIndexFailed)
          return {
            ok: true,
            partial: { pending: 'derived-index', retryable: true },
            error:
              'V2 post committed; the rebuildable search fragment is pending.',
          };
        return { ok: true };
      } catch (error) {
        if (v2Committed) {
          return {
            ok: true,
            partial: { pending: 'compatibility', retryable: true },
            error:
              'V2 post committed; compatibility/index publication is pending.',
          };
        }
        return {
          ok: false,
          error:
            error instanceof Error ? error.message : 'Failed to publish post.',
        };
      }
    },
    [
      currentUser,
      authenticatedAddress,
      buildThreadIndexResource,
      buildTopicDirectoryIndexResource,
      isAuthenticated,
      posts,
      setPosts,
      setSubTopics,
      setThreadSearchIndexes,
      setTopicDirectoryIndex,
      setUsers,
      subTopics,
      topics,
    ]
  );

  const updatePost = useCallback(
    async (input: {
      postId: string;
      content: string;
      attachments?: PostAttachment[];
    }): Promise<ForumMutationResult> => {
      const content = input.content.trim();
      const attachments = input.attachments ?? [];
      if (!content && attachments.length === 0) {
        return { ok: false, error: 'Post content or attachment is required.' };
      }

      if (!isAuthenticated) {
        return { ok: false, error: 'Authenticate with Qortium first.' };
      }

      const target = posts.find((post) => post.id === input.postId);
      if (!target) {
        return { ok: false, error: 'Post not found.' };
      }

      if (target.authorUserId !== currentUser.id) {
        return { ok: false, error: 'Only owner can edit this post.' };
      }

      try {
        await forumQdnService.publishV2OwnerEdit(
          {
            operation: 'owner-edit',
            targetType: 'post',
            targetId: target.id,
            publisherName: currentUser.username,
            walletAddress: authenticatedAddress ?? '',
            changes: { content },
          },
          currentUser.username,
          {
            validatePublisher: (metadata, claimed) =>
              metadata.publisherName.trim().toLowerCase() ===
              claimed.trim().toLowerCase()
                ? { ok: true }
                : {
                    ok: false,
                    code: 'IDENTITY_UNVERIFIED',
                    detail: 'publisher mismatch',
                  },
            validateWalletBinding: (_name, wallet) =>
              wallet.trim() === authenticatedAddress?.trim()
                ? { ok: true }
                : {
                    ok: false,
                    code: 'IDENTITY_UNVERIFIED',
                    detail: 'wallet binding unavailable',
                  },
          }
        );
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : '[LEGACY_AUTHORITY_BLOCKED] V2 owner authority unavailable.',
        };
      }

      const updatedAt = new Date().toISOString();
      const updatedPost: Post = {
        ...target,
        content,
        attachments,
        updatedAt,
        editedAt: updatedAt,
      };

      try {
        const nextPosts = posts.map((post) =>
          post.id === input.postId ? updatedPost : post
        );
        const postResource = forumQdnService.buildPostPublishResource(
          updatedPost,
          currentUser.username
        );
        const threadIndexResource = buildThreadIndexResource(
          updatedPost.subTopicId,
          nextPosts
        );
        const fragmentResource =
          forumSearchIndexService.buildV2IndexFragmentPublishResource(
            {
              entityType: 'post',
              entityId: updatedPost.id,
              parentThreadId: updatedPost.subTopicId,
              parentPostId: updatedPost.parentPostId,
              publisherName: currentUser.username,
              walletAddress: authenticatedAddress ?? '',
              content: updatedPost.content,
              pollReference: isNativePostPoll(updatedPost.poll)
                ? toPersistedNativePollReference(updatedPost.poll)
                : null,
            },
            currentUser.username
          );
        const followup = await publishCompatibilityAndDerivedFragment(
          postResource.resource,
          fragmentResource.resource
        );

        recordRecentPostMutation(updatedPost);
        writeThreadIndexCache(
          updatedPost.subTopicId,
          threadIndexResource.snapshot
        );
        setPosts((current) => {
          const next = current.map((post) =>
            post.id === input.postId ? updatedPost : post
          );
          threadPostCache.write(
            updatedPost.subTopicId,
            next.filter((post) => post.subTopicId === updatedPost.subTopicId)
          );
          return next;
        });
        setThreadSearchIndexes((current) => ({
          ...current,
          [updatedPost.subTopicId]: threadIndexResource.snapshot,
        }));
        if (followup.compatibilityFailed)
          return {
            ok: true,
            partial: { pending: 'compatibility', retryable: true },
            error: followup.derivedIndexFailed
              ? 'V2 post edit committed; legacy compatibility and derived-index publications are pending.'
              : 'V2 post edit committed; legacy compatibility publication is pending.',
          };
        if (followup.derivedIndexFailed)
          return {
            ok: true,
            partial: { pending: 'derived-index', retryable: true },
            error:
              'V2 post edit committed; the rebuildable search fragment is pending.',
          };
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error ? error.message : 'Failed to update post.',
        };
      }
    },
    [
      authenticatedAddress,
      currentUser,
      buildThreadIndexResource,
      isAuthenticated,
      posts,
      setPosts,
      setThreadSearchIndexes,
    ]
  );

  const togglePostPin = useCallback(
    async (postId: string): Promise<ForumMutationResult> => {
      if (!isAuthenticated) {
        return { ok: false, error: 'Authenticate with Qortium first.' };
      }

      if (!isModeratorRole(currentUser.role)) {
        return { ok: false, error: 'Only moderators can pin posts.' };
      }

      const target = posts.find((post) => post.id === postId);
      if (!target) {
        return { ok: false, error: 'Post not found.' };
      }

      const isPinned = target.isPinned === true;
      const updatedAt = new Date().toISOString();
      const updatedPost: Post = {
        ...target,
        updatedAt,
        isPinned: !isPinned,
        pinnedAt: isPinned ? null : updatedAt,
        pinnedByUserId: isPinned ? null : currentUser.id,
      };

      try {
        const nextPosts = posts.map((post) =>
          post.id === postId ? updatedPost : post
        );
        const threadIndexResource = buildThreadIndexResource(
          updatedPost.subTopicId,
          nextPosts
        );
        const published = await publishModeration({
          action: isPinned ? 'unpin' : 'pin',
          targetType: 'post',
          targetId: target.id,
        });

        recordRecentPostMutation(updatedPost);
        writeThreadIndexCache(
          updatedPost.subTopicId,
          threadIndexResource.snapshot
        );
        setPosts((current) => {
          const next = current.map((post) =>
            post.id === postId ? updatedPost : post
          );
          threadPostCache.write(
            updatedPost.subTopicId,
            next.filter((post) => post.subTopicId === updatedPost.subTopicId)
          );
          return next;
        });
        setThreadSearchIndexes((current) => ({
          ...current,
          [updatedPost.subTopicId]: threadIndexResource.snapshot,
        }));
        return 'partial' in published
          ? { ok: true, partial: published.partial, error: published.detail }
          : { ok: true };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error ? error.message : 'Failed to update pin.',
        };
      }
    },
    [
      buildThreadIndexResource,
      currentUser,
      isAuthenticated,
      publishModeration,
      posts,
      setPosts,
      setThreadSearchIndexes,
    ]
  );

  const voteOnPoll = useCallback(
    async (input: {
      postId: string;
      optionIds: string[];
    }): Promise<ForumMutationResult> => {
      if (!isAuthenticated) {
        return { ok: false, error: 'Authenticate with Qortium first.' };
      }

      const target = posts.find((post) => post.id === input.postId);
      if (!target?.poll) {
        return { ok: false, error: 'Poll not found.' };
      }

      if (!isNativePostPoll(target.poll)) {
        return {
          ok: false,
          error:
            '[UNSUPPORTED_CAPABILITY] Legacy embedded polls are historical and read-only.',
        };
      }

      const targetSubTopic = subTopics.find(
        (subTopic) => subTopic.id === target.subTopicId
      );
      if (!targetSubTopic) {
        return { ok: false, error: 'Sub-topic not found.' };
      }

      if (
        targetSubTopic.visibility === 'hidden' &&
        !isModeratorRole(currentUser.role)
      ) {
        return { ok: false, error: 'This sub-topic is hidden.' };
      }

      if (
        !canAccessSubTopic(targetSubTopic, currentUser, authenticatedAddress)
      ) {
        return {
          ok: false,
          error: 'You do not have access to vote in this sub-topic.',
        };
      }

      if (!authenticatedAddress?.trim()) {
        return {
          ok: false,
          error: '[POLL_IDENTITY_MISMATCH] Unable to identify native voter.',
        };
      }
      let authoritativeReference;
      try {
        authoritativeReference =
          await loadAuthoritativeNativePollReference(target);
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : '[POLL_IDENTITY_MISMATCH] Native poll authority is unavailable.',
        };
      }
      if (target.poll.runtime?.isClosed) {
        return { ok: false, error: 'This poll is closed.' };
      }

      try {
        const optionIndexes = input.optionIds.map((optionId) => {
          const match = /^native:(\d+)$/.exec(optionId);
          return match ? Number(match[1]) : Number.NaN;
        });
        const submitted = await submitNativePollVote(
          authoritativeReference,
          optionIndexes,
          qortiumNativePollGateway
        );
        const refreshedPoll = await loadNativePostPoll(
          authoritativeReference,
          authenticatedAddress
        );
        let cacheWriteFailed = false;
        try {
          const refreshedPosts = posts.map((post) =>
            post.id === input.postId ? { ...post, poll: refreshedPoll } : post
          );
          threadPostCache.write(
            target.subTopicId,
            refreshedPosts.filter(
              (post) => post.subTopicId === target.subTopicId
            )
          );
        } catch {
          cacheWriteFailed = true;
        }
        setPosts((current) => {
          return current.map((post) =>
            post.id === input.postId ? { ...post, poll: refreshedPoll } : post
          );
        });
        if (refreshedPoll.runtime?.availability !== 'available') {
          return {
            ok: true,
            transactionSignature: submitted.transactionSignature,
            partial: { pending: 'poll-result-refresh', retryable: true },
            error: 'Native vote committed; Core result refresh is pending.',
          };
        }
        if (cacheWriteFailed) {
          return {
            ok: true,
            transactionSignature: submitted.transactionSignature,
            partial: { pending: 'derived-index', retryable: true },
            error:
              'Native vote committed; local derived poll cache update is pending.',
          };
        }
        return {
          ok: true,
          transactionSignature: submitted.transactionSignature,
        };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : '[POLL_VOTE_FAILED] Failed to submit native vote.',
        };
      }
    },
    [
      authenticatedAddress,
      currentUser,
      isAuthenticated,
      posts,
      setPosts,
      subTopics,
    ]
  );

  const closePoll = useCallback(
    async (input: { postId: string }): Promise<ForumMutationResult> => {
      if (!isAuthenticated) {
        return { ok: false, error: 'Authenticate with Qortium first.' };
      }

      const target = posts.find((post) => post.id === input.postId);
      if (!target?.poll) {
        return { ok: false, error: 'Poll not found.' };
      }
      if (!isNativePostPoll(target.poll)) {
        return {
          ok: false,
          error:
            '[UNSUPPORTED_CAPABILITY] Legacy embedded polls are historical and read-only.',
        };
      }
      if (!authenticatedAddress?.trim()) {
        return {
          ok: false,
          error:
            '[POLL_IDENTITY_MISMATCH] Authenticated wallet is required to update a native poll.',
        };
      }
      let authoritativeReference;
      try {
        authoritativeReference =
          await loadAuthoritativeNativePollReference(target);
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : '[POLL_IDENTITY_MISMATCH] Native poll authority is unavailable.',
        };
      }
      let boundWallet: string | null = null;
      try {
        boundWallet = await resolveNameWalletAddress(currentUser.username);
      } catch {
        boundWallet = null;
      }
      if (
        authoritativeReference.creatorAddress !== authenticatedAddress ||
        boundWallet?.trim() !== authenticatedAddress.trim()
      ) {
        return {
          ok: false,
          error:
            '[POLL_IDENTITY_MISMATCH] Current Qortium identity does not own this native poll.',
        };
      }

      try {
        const transactionSignature = await closeNativePoll(
          authoritativeReference,
          authenticatedAddress
        );
        const refreshedPoll = await loadNativePostPoll(
          authoritativeReference,
          authenticatedAddress
        );
        let cacheWriteFailed = false;
        try {
          const refreshedPosts = posts.map((post) =>
            post.id === input.postId ? { ...post, poll: refreshedPoll } : post
          );
          threadPostCache.write(
            target.subTopicId,
            refreshedPosts.filter(
              (post) => post.subTopicId === target.subTopicId
            )
          );
        } catch {
          cacheWriteFailed = true;
        }
        setPosts((current) => {
          return current.map((post) =>
            post.id === input.postId ? { ...post, poll: refreshedPoll } : post
          );
        });
        if (refreshedPoll.runtime?.availability !== 'available') {
          return {
            ok: true,
            transactionSignature,
            partial: { pending: 'poll-result-refresh', retryable: true },
            error:
              'Native poll update committed; Core result refresh is pending.',
          };
        }
        if (cacheWriteFailed) {
          return {
            ok: true,
            transactionSignature,
            partial: { pending: 'derived-index', retryable: true },
            error:
              'Native poll update committed; local derived poll cache update is pending.',
          };
        }
        return { ok: true, transactionSignature };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : '[POLL_UPDATE_REJECTED] Failed to update native poll.',
        };
      }
    },
    [
      authenticatedAddress,
      currentUser.username,
      isAuthenticated,
      posts,
      setPosts,
    ]
  );

  const deletePost = useCallback(
    async (input: {
      postId: string;
      reason?: string | null;
    }): Promise<ForumMutationResult> => {
      const target = posts.find((post) => post.id === input.postId);
      if (!target) {
        return { ok: false, error: 'Post not found.' };
      }

      if (!isAuthenticated) {
        return { ok: false, error: 'Authenticate with Qortium first.' };
      }

      const canDeleteAsStaff = isAdminRole(currentUser.role);
      if (target.authorUserId !== currentUser.id && !canDeleteAsStaff) {
        return {
          ok: false,
          error:
            'Only owner, admin, Super Admin or SysOp can delete this post.',
        };
      }

      if (!canDeleteAsStaff) {
        const authority = authorizeLegacyMutation('UNRESOLVED');
        return {
          ok: false,
          error: authority.ok
            ? '[FORBIDDEN_FIELD] Owner tombstones are not enabled.'
            : `[${authority.code}] ${authority.detail}`,
        };
      }

      try {
        const nextPosts = posts.filter((post) => post.id !== input.postId);
        const threadIndexResource = buildThreadIndexResource(
          target.subTopicId,
          nextPosts
        );
        const published = await publishModeration({
          action: 'remove',
          targetType: 'post',
          targetId: target.id,
          reason: input.reason?.trim(),
        });
        setPosts((current) => {
          const next = current.filter((post) => post.id !== input.postId);
          threadPostCache.write(
            target.subTopicId,
            next.filter((post) => post.subTopicId === target.subTopicId)
          );
          return next;
        });
        setThreadSearchIndexes((current) => ({
          ...current,
          [target.subTopicId]: threadIndexResource.snapshot,
        }));
        return 'partial' in published
          ? { ok: true, partial: published.partial, error: published.detail }
          : { ok: true };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error ? error.message : 'Failed to delete post.',
        };
      }
    },
    [
      buildThreadIndexResource,
      currentUser,
      isAuthenticated,
      posts,
      publishModeration,
      setPosts,
      setThreadSearchIndexes,
    ]
  );

  const likePost = useCallback(
    async (postId: string) => {
      if (!isAuthenticated || !authenticatedAddress?.trim()) return;
      const target = posts.find((post) => post.id === postId);
      if (!target) return;
      const actorId = `addr:${authenticatedAddress.trim().toLowerCase()}`;
      const nextState = target.likedByAddresses.includes(actorId)
        ? 'inactive'
        : 'active';
      try {
        await forumQdnService.publishPostReaction(
          postId,
          nextState,
          currentUser.username,
          authenticatedAddress.trim()
        );
        const reactions = await forumQdnService.loadPostReactions(postId);
        const activeActors = Object.values(reactions.actors).filter(
          (reaction) => reaction.state === 'active'
        );
        setPosts((current) => {
          const next = current.map((post) =>
            post.id === postId
              ? {
                  ...post,
                  likes: reactions.count,
                  likedByAddresses: activeActors.map(
                    (reaction) =>
                      `addr:${reaction.walletAddress.trim().toLowerCase()}`
                  ),
                }
              : post
          );
          threadPostCache.write(
            target.subTopicId,
            next.filter((post) => post.subTopicId === target.subTopicId)
          );
          return next;
        });
      } catch {
        // No optimistic state is committed; reload retains the last valid state.
      }
    },
    [
      authenticatedAddress,
      currentUser.username,
      isAuthenticated,
      posts,
      setPosts,
    ]
  );

  const resolvePostTipRecipient = useCallback(
    async (postId: string): Promise<ForumTipRecipientResult> => {
      if (!isAuthenticated) {
        return { ok: false, error: 'Authenticate with Qortium first.' };
      }
      const target = posts.find((post) => post.id === postId);
      if (!target) return { ok: false, error: 'Post not found.' };
      try {
        const recipient = await forumQdnService.resolvePostTipRecipient(postId);
        return recipient
          ? {
              ok: true,
              recipientName: recipient.name,
              recipientAddress: recipient.address,
            }
          : {
              ok: false,
              error:
                'This legacy or unavailable Post has no approved V2 owner authority, so its tip recipient cannot be verified.',
            };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to resolve the authoritative Post owner.',
        };
      }
    },
    [isAuthenticated, posts]
  );

  const tipPost = useCallback(
    async (input: {
      postId: string;
      amountQort: string;
      recovery?: import('../../../services/qdn/forumTipsService').TipRecovery;
    }): Promise<ForumMutationResult> => {
      if (!isAuthenticated)
        return { ok: false, error: 'Authenticate with Qortium first.' };
      if (!authenticatedAddress?.trim())
        return { ok: false, error: 'Authenticated wallet is unavailable.' };
      const target = posts.find((post) => post.id === input.postId);
      if (!target) return { ok: false, error: 'Post not found.' };
      let result: Awaited<ReturnType<typeof forumQdnService.submitPostTip>>;
      try {
        result = await forumQdnService.submitPostTip(
          {
            ...input,
            senderName: currentUser.username,
            senderAddress: authenticatedAddress,
          },
          async (state) => {
            const tipSummary = resolveTipDisplay(target.id, target.tips, state);
            const nextPosts = posts.map((post) =>
              post.id === input.postId ? { ...post, tipSummary } : post
            );
            threadPostCache.write(
              target.subTopicId,
              nextPosts.filter((post) => post.subTopicId === target.subTopicId)
            );
            setPosts((current) =>
              current.map((post) =>
                post.id === input.postId
                  ? {
                      ...post,
                      tipSummary: resolveTipDisplay(post.id, post.tips, state),
                    }
                  : post
              )
            );
          }
        );
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'Verified tip workflow failed before payment submission.',
        };
      }
      if (!result.ok)
        return {
          ok: false,
          error: result.paymentCommitted
            ? `QORT payment succeeded, but its verified tip reference was rejected: [${result.code}] ${result.detail}`
            : `[${result.code}] ${result.detail}`,
          transactionSignature:
            'transactionSignature' in result
              ? result.transactionSignature
              : undefined,
        };
      if (result.status === 'PARTIAL') {
        const pending = {
          'transaction-verification': 'tip-transaction-verification',
          'reference-publication': 'tip-reference-publication',
          'reference-refresh': 'tip-reference-refresh',
          'derived-cache': 'tip-derived-cache',
        } as const;
        return {
          ok: true,
          error: `QORT payment succeeded. ${result.detail} Retry resumes metadata verification only and will not send another payment.`,
          partial: { pending: pending[result.pending], retryable: true },
          transactionSignature: result.transactionSignature,
          tipRecovery: result.recovery,
        };
      }
      return {
        ok: true,
        transactionSignature: result.transactionSignature,
      };
    },
    [
      authenticatedAddress,
      currentUser.username,
      isAuthenticated,
      posts,
      setPosts,
    ]
  );

  const uploadPostImage = useCallback(
    async (file: File): Promise<ForumUploadImageResult> => {
      if (!isAuthenticated) {
        return { ok: false, error: 'Authenticate with Qortium first.' };
      }

      try {
        const reference = await forumQdnService.publishPostImage(
          file,
          currentUser.username
        );
        return {
          ok: true,
          imageTag: encodeQdnImageTag({
            name: reference.name,
            identifier: reference.identifier,
            filename: reference.filename,
          }),
        };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error ? error.message : 'Failed to upload image.',
        };
      }
    },
    [currentUser.username, isAuthenticated]
  );

  const uploadPostAttachment = useCallback(
    async (file: File): Promise<ForumUploadAttachmentResult> => {
      if (!isAuthenticated) {
        return { ok: false, error: 'Authenticate with Qortium first.' };
      }

      if (!isAllowedAttachmentFile(file)) {
        return {
          ok: false,
          error: 'Unsupported attachment type. Use TXT, MD or ZIP.',
        };
      }

      const sizeLimit = getAttachmentSizeLimit(file);
      if (file.size > sizeLimit) {
        return {
          ok: false,
          error:
            getAttachmentExtension(file.name) === 'zip'
              ? 'ZIP attachment is too large. Maximum allowed size is 10 MB.'
              : 'Text attachment is too large. Maximum allowed size is 2 MB.',
        };
      }

      try {
        const reference = await forumQdnService.publishPostAttachment(
          file,
          currentUser.username
        );

        return {
          ok: true,
          attachment: {
            id: generateForumEntityId('attachment', currentUser.username),
            service: reference.service,
            name: reference.name,
            identifier: reference.identifier,
            filename: reference.filename,
            mimeType: reference.mimeType,
            size: reference.size,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to upload attachment.',
        };
      }
    },
    [currentUser.username, isAuthenticated]
  );

  const uploadPostVideo = useCallback(
    async (file: File, title?: string): Promise<ForumUploadVideoResult> => {
      if (!isAuthenticated) {
        return { ok: false, error: 'Authenticate with Qortium first.' };
      }

      if (
        file.type &&
        !FORUM_VIDEO_LIMITS.acceptedTypes.includes(
          file.type as (typeof FORUM_VIDEO_LIMITS.acceptedTypes)[number]
        )
      ) {
        return {
          ok: false,
          error: 'Unsupported video type. Use MP4, WEBM or OGG.',
        };
      }

      if (file.size > FORUM_VIDEO_LIMITS.maxBytes) {
        return {
          ok: false,
          error: 'Video is too large. Maximum allowed size is 100 MB.',
        };
      }

      try {
        const reference = await forumQdnService.publishPostVideo(
          file,
          currentUser.username
        );

        return {
          ok: true,
          videoTag: encodeQdnVideoTag({
            service: 'VIDEO',
            name: reference.name,
            identifier: reference.identifier,
            title: title?.trim() || file.name,
            source: 'qdn',
          }),
        };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error ? error.message : 'Failed to upload video.',
        };
      }
    },
    [currentUser.username, isAuthenticated]
  );

  return {
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
    updatePost,
    togglePostPin,
    voteOnPoll,
    closePoll,
    deletePost,
    likePost,
    resolvePostTipRecipient,
    tipPost,
    uploadPostImage,
    uploadPostAttachment,
    uploadPostVideo,
  };
};
