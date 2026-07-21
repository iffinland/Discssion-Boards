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
import { publishMultipleQortiumResources } from '../../../services/qortium/qortiumClient';
import { forumQdnService } from '../../../services/qdn/forumQdnService';
import type {
  ThreadSearchSnapshot,
  TopicDirectorySnapshot,
} from '../../../services/qdn/forumSearchIndexService';
import { forumSearchIndexService } from '../../../services/qdn/forumSearchIndexService';
import { forumRolesService } from '../../../services/qdn/forumRolesService';
import { writeThreadIndexCache } from '../../../services/qdn/threadIndexCache';
import { authorizeLegacyMutation } from '../../../services/architectureV2/reducer';
import type {
  ForumRoleRegistry,
  Post,
  PostAttachment,
  PostPoll,
  SubTopic,
  Topic,
  TopicAccess,
  User,
} from '../../../types';
import type {
  ForumMutationResult,
  ForumPollDraft,
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

const isPollClosed = (poll: PostPoll) => {
  if (poll.closedAt) {
    return true;
  }

  return Boolean(
    poll.closesAt && new Date(poll.closesAt).getTime() <= Date.now()
  );
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
  const syncThreadSearchIndex = useCallback(
    async (subTopicId: string, nextPosts: Post[]) => {
      try {
        const snapshot = await forumSearchIndexService.publishThreadIndex(
          subTopicId,
          nextPosts,
          currentUser.username
        );
        setThreadSearchIndexes((current) => ({
          ...current,
          [subTopicId]: snapshot,
        }));
        writeThreadIndexCache(subTopicId, snapshot);
      } catch {
        // Keep forum mutations successful even if index publish lags behind.
      }
    },
    [currentUser.username, setThreadSearchIndexes]
  );

  const buildTopicDirectoryIndexResource = useCallback(
    (nextTopics: Topic[], nextSubTopics: SubTopic[]) =>
      forumSearchIndexService.buildTopicDirectoryIndexPublishResource(
        nextTopics,
        nextSubTopics,
        currentUser.username
      ),
    [currentUser.username]
  );

  const buildThreadIndexResource = useCallback(
    (subTopicId: string, nextPosts: Post[]) =>
      forumSearchIndexService.buildThreadIndexPublishResource(
        subTopicId,
        nextPosts,
        currentUser.username
      ),
    [currentUser.username]
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

      try {
        const nextTopics = [newTopic, ...topics];
        const topicResource = forumQdnService.buildTopicPublishResource(
          newTopic,
          currentUser.username
        );
        const topicDirectoryResource = buildTopicDirectoryIndexResource(
          nextTopics,
          subTopics
        );
        await publishMultipleQortiumResources([
          topicResource.resource,
          topicDirectoryResource.resource,
        ]);

        setTopics((current) => [newTopic, ...current]);
        setUsers((current) => ensureCurrentUserPresent(current, currentUser));
        setTopicDirectoryIndex(topicDirectoryResource.snapshot);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error ? error.message : 'Failed to publish topic.',
        };
      }
    },
    [
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
        const topicResources = reorderedTopics.map((topic) =>
          forumQdnService.buildTopicPublishResource(topic, currentUser.username)
        );
        const nextTopics = sortTopicsByOrder(reorderedTopics);
        const topicDirectoryResource = buildTopicDirectoryIndexResource(
          nextTopics,
          subTopics
        );
        await publishMultipleQortiumResources([
          ...topicResources.map((item) => item.resource),
          topicDirectoryResource.resource,
        ]);

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
      currentUser.username,
      buildTopicDirectoryIndexResource,
      isAuthenticated,
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
      const baseTimestampMs =
        Date.now() - input.orderedPinnedSubTopicIds.length * 1000;

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
              pinnedAt: new Date(baseTimestampMs + index * 1000).toISOString(),
            };
          }
        );

        const reorderedPinnedMap = new Map(
          reorderedPinned.map((subTopic) => [subTopic.id, subTopic])
        );
        const nextSubTopics = subTopics.map(
          (subTopic) => reorderedPinnedMap.get(subTopic.id) ?? subTopic
        );
        const subTopicResources = reorderedPinned.map((subTopic) =>
          forumQdnService.buildSubTopicPublishResource(
            subTopic,
            currentUser.username
          )
        );
        const topicDirectoryResource = buildTopicDirectoryIndexResource(
          topics,
          nextSubTopics
        );
        await publishMultipleQortiumResources([
          ...subTopicResources.map((resource) => resource.resource),
          topicDirectoryResource.resource,
        ]);

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
      currentUser.username,
      buildTopicDirectoryIndexResource,
      isAuthenticated,
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

      try {
        const nextSubTopics = [newSubTopic, ...subTopics];
        const subTopicResource = forumQdnService.buildSubTopicPublishResource(
          newSubTopic,
          currentUser.username
        );
        const topicDirectoryResource = buildTopicDirectoryIndexResource(
          topics,
          nextSubTopics
        );
        await publishMultipleQortiumResources([
          subTopicResource.resource,
          topicDirectoryResource.resource,
        ]);

        setSubTopics((current) => [newSubTopic, ...current]);
        setUsers((current) => ensureCurrentUserPresent(current, currentUser));
        setTopicDirectoryIndex(topicDirectoryResource.snapshot);
        return { ok: true, subTopicId: newSubTopic.id };
      } catch (error) {
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
        const topicResource = forumQdnService.buildTopicPublishResource(
          updatedTopic,
          currentUser.username
        );
        const topicDirectoryResource = buildTopicDirectoryIndexResource(
          nextTopics,
          subTopics
        );
        await publishMultipleQortiumResources([
          topicResource.resource,
          topicDirectoryResource.resource,
        ]);

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
      currentUser.username,
      buildTopicDirectoryIndexResource,
      isAuthenticated,
      setTopicDirectoryIndex,
      setTopics,
      subTopics,
      topics,
    ]
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
        const subTopicResource = forumQdnService.buildSubTopicPublishResource(
          updatedSubTopic,
          currentUser.username
        );
        const topicDirectoryResource = buildTopicDirectoryIndexResource(
          topics,
          nextSubTopics
        );
        await publishMultipleQortiumResources([
          subTopicResource.resource,
          topicDirectoryResource.resource,
        ]);

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
      currentUser.username,
      buildTopicDirectoryIndexResource,
      isAuthenticated,
      setTopicDirectoryIndex,
      setSubTopics,
      subTopics,
      topics,
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
        const subTopicResource = forumQdnService.buildSubTopicPublishResource(
          updatedSubTopic,
          currentUser.username
        );
        const topicDirectoryResource = buildTopicDirectoryIndexResource(
          topics,
          nextSubTopics
        );
        await publishMultipleQortiumResources([
          subTopicResource.resource,
          topicDirectoryResource.resource,
        ]);

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
              : 'Failed to update solved state.',
        };
      }
    },
    [
      currentUser.id,
      currentUser.role,
      currentUser.username,
      buildTopicDirectoryIndexResource,
      isAuthenticated,
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

      if (!isAuthenticated) {
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

      const nextRegistry: ForumRoleRegistry = {
        ...roleRegistry,
        sysOps:
          input.role === 'SuperAdmin'
            ? normalizeAddressList([...roleRegistry.sysOps, address])
            : roleRegistry.sysOps.filter((entry) => entry !== address),
        admins:
          input.role === 'Admin'
            ? normalizeAddressList([...roleRegistry.admins, address])
            : roleRegistry.admins.filter((entry) => entry !== address),
        moderators:
          input.role === 'Moderator'
            ? normalizeAddressList([...roleRegistry.moderators, address])
            : roleRegistry.moderators.filter((entry) => entry !== address),
        updatedAt: Date.now(),
      };

      try {
        const published = await forumRolesService.publishRoleRegistry(
          nextRegistry,
          currentUser.username
        );
        setRoleRegistry(published);
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

      if (!isAuthenticated) {
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

      const nextRegistry: ForumRoleRegistry = {
        ...roleRegistry,
        sysOps: roleRegistry.sysOps.filter(
          (entry) => entry !== normalizedAddress
        ),
        admins: roleRegistry.admins.filter(
          (entry) => entry !== normalizedAddress
        ),
        moderators: roleRegistry.moderators.filter(
          (entry) => entry !== normalizedAddress
        ),
        updatedAt: Date.now(),
      };

      try {
        const published = await forumRolesService.publishRoleRegistry(
          nextRegistry,
          currentUser.username
        );
        setRoleRegistry(published);
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

      if (input.poll && !targetSubTopic.isPoll) {
        return {
          ok: false,
          error: 'Polls can only be added inside Poll / Voting topics.',
        };
      }

      const createdAt = new Date().toISOString();
      const poll: PostPoll | null = normalizedPoll
        ? {
            id: generateForumEntityId('poll', currentUser.username),
            question: normalizedPoll.question,
            description: normalizedPoll.description,
            mode: normalizedPoll.mode,
            options: normalizedPoll.options.map((label) => ({
              id: generateForumEntityId('option', currentUser.username),
              label,
            })),
            votes: [],
            closesAt: normalizedPoll.closesAt,
            closedAt: null,
            closedByUserId: null,
          }
        : null;
      const newPost: Post = {
        id: generateForumEntityId('post', currentUser.username),
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

      try {
        const nextPosts = [...posts, newPost];
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
        await publishMultipleQortiumResources([
          postResource.resource,
          threadIndexResource.resource,
          topicDirectoryResource.resource,
        ]);

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
        return { ok: true };
      } catch (error) {
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

      const authority = authorizeLegacyMutation('UNRESOLVED');
      if (!authority.ok) {
        return { ok: false, error: `[${authority.code}] ${authority.detail}` };
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
        await publishMultipleQortiumResources([
          postResource.resource,
          threadIndexResource.resource,
        ]);

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
        const postResource = forumQdnService.buildPostPublishResource(
          updatedPost,
          currentUser.username
        );
        const threadIndexResource = buildThreadIndexResource(
          updatedPost.subTopicId,
          nextPosts
        );
        await publishMultipleQortiumResources([
          postResource.resource,
          threadIndexResource.resource,
        ]);

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
        return { ok: true };
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

      const voterId = authenticatedAddress ?? currentUser.id;
      if (!voterId) {
        return { ok: false, error: 'Unable to identify voter.' };
      }

      const validOptionIds = new Set(
        target.poll.options.map((option) => option.id)
      );
      const selectedOptionIds = [...new Set(input.optionIds)].filter(
        (optionId) => validOptionIds.has(optionId)
      );

      if (selectedOptionIds.length === 0) {
        return { ok: false, error: 'Choose at least one poll option.' };
      }

      if (target.poll.mode === 'single' && selectedOptionIds.length > 1) {
        return { ok: false, error: 'This poll allows one answer only.' };
      }

      if (isPollClosed(target.poll)) {
        return { ok: false, error: 'This poll is closed.' };
      }

      const votedAt = new Date().toISOString();
      const updatedPost: Post = {
        ...target,
        updatedAt: votedAt,
        poll: {
          ...target.poll,
          votes: [
            ...target.poll.votes.filter((vote) => vote.voterId !== voterId),
            {
              voterId,
              optionIds: selectedOptionIds,
              votedAt,
            },
          ],
        },
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
        await publishMultipleQortiumResources([
          postResource.resource,
          threadIndexResource.resource,
        ]);

        recordRecentPostMutation(updatedPost);
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
        writeThreadIndexCache(
          updatedPost.subTopicId,
          threadIndexResource.snapshot
        );
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error ? error.message : 'Failed to submit vote.',
        };
      }
    },
    [
      authenticatedAddress,
      buildThreadIndexResource,
      currentUser,
      isAuthenticated,
      posts,
      setPosts,
      setThreadSearchIndexes,
      subTopics,
    ]
  );

  const closePoll = useCallback(
    async (input: { postId: string }): Promise<ForumMutationResult> => {
      if (!isAuthenticated) {
        return { ok: false, error: 'Authenticate with Qortium first.' };
      }

      if (!isModeratorRole(currentUser.role)) {
        return {
          ok: false,
          error:
            'Only moderators, admins, Super Admins and SysOp can close polls.',
        };
      }

      const target = posts.find((post) => post.id === input.postId);
      if (!target?.poll) {
        return { ok: false, error: 'Poll not found.' };
      }

      if (target.poll.closedAt) {
        return { ok: false, error: 'This poll is already closed.' };
      }

      const closedAt = new Date().toISOString();
      const updatedPost: Post = {
        ...target,
        updatedAt: closedAt,
        poll: {
          ...target.poll,
          closedAt,
          closedByUserId: currentUser.id,
        },
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
        await publishMultipleQortiumResources([
          postResource.resource,
          threadIndexResource.resource,
        ]);

        recordRecentPostMutation(updatedPost);
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
        writeThreadIndexCache(
          updatedPost.subTopicId,
          threadIndexResource.snapshot
        );
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error ? error.message : 'Failed to close poll.',
        };
      }
    },
    [
      buildThreadIndexResource,
      currentUser.id,
      currentUser.role,
      currentUser.username,
      isAuthenticated,
      posts,
      setPosts,
      setThreadSearchIndexes,
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

      const authority = authorizeLegacyMutation('UNRESOLVED');
      if (!authority.ok) {
        return { ok: false, error: `[${authority.code}] ${authority.detail}` };
      }

      try {
        await forumQdnService.deletePost(target, currentUser.username);
        const nextPosts = posts.filter((post) => post.id !== input.postId);
        setPosts((current) => {
          const next = current.filter((post) => post.id !== input.postId);
          threadPostCache.write(
            target.subTopicId,
            next.filter((post) => post.subTopicId === target.subTopicId)
          );
          return next;
        });
        await syncThreadSearchIndex(target.subTopicId, nextPosts);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error ? error.message : 'Failed to delete post.',
        };
      }
    },
    [currentUser, isAuthenticated, posts, setPosts, syncThreadSearchIndex]
  );

  const likePost = useCallback(
    (postId: string) => {
      if (!isAuthenticated) {
        return;
      }

      const actorId = authenticatedAddress?.trim()
        ? `addr:${authenticatedAddress.trim().toLowerCase()}`
        : currentUser.id?.trim()
          ? `user:${currentUser.id.trim().toLowerCase()}`
          : '';
      if (!actorId) {
        return;
      }

      setPosts((current) => {
        const next = current.map((post) => {
          if (post.id !== postId) {
            return post;
          }

          if (post.likedByAddresses.includes(actorId)) {
            return post;
          }

          return {
            ...post,
            updatedAt: new Date().toISOString(),
            likes: post.likes + 1,
            likedByAddresses: [...post.likedByAddresses, actorId],
          };
        });

        const target = next.find((post) => post.id === postId);
        const original = current.find((post) => post.id === postId);
        if (
          target &&
          original &&
          (target.likes !== original.likes ||
            target.likedByAddresses.length !== original.likedByAddresses.length)
        ) {
          threadPostCache.write(
            target.subTopicId,
            next.filter((post) => post.subTopicId === target.subTopicId)
          );
          recordRecentPostMutation(target);
          void forumQdnService.publishPost(target, currentUser.username);
          void syncThreadSearchIndex(target.subTopicId, next);
        }

        return next;
      });
    },
    [
      authenticatedAddress,
      currentUser.id,
      currentUser.username,
      isAuthenticated,
      setPosts,
      syncThreadSearchIndex,
    ]
  );

  const tipPost = useCallback(
    async (postId: string): Promise<ForumMutationResult> => {
      if (!isAuthenticated) {
        return { ok: false, error: 'Authenticate with Qortium first.' };
      }

      const target = posts.find((post) => post.id === postId);
      if (!target) {
        return { ok: false, error: 'Post not found.' };
      }

      const updatedPost: Post = {
        ...target,
        updatedAt: new Date().toISOString(),
        tips: target.tips + 1,
      };

      try {
        const nextPosts = posts.map((post) =>
          post.id === postId ? updatedPost : post
        );
        const postResource = forumQdnService.buildPostPublishResource(
          updatedPost,
          currentUser.username
        );
        const threadIndexResource = buildThreadIndexResource(
          updatedPost.subTopicId,
          nextPosts
        );
        await publishMultipleQortiumResources([
          postResource.resource,
          threadIndexResource.resource,
        ]);

        recordRecentPostMutation(updatedPost);
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

        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to persist tip counter.',
        };
      }
    },
    [
      currentUser.username,
      buildThreadIndexResource,
      isAuthenticated,
      posts,
      setPosts,
      setThreadSearchIndexes,
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
    updateTopicSettings,
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
    tipPost,
    uploadPostImage,
    uploadPostAttachment,
    uploadPostVideo,
  };
};
