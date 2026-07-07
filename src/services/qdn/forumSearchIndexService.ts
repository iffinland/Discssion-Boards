import type { Post, PostAttachment, SubTopic, Topic } from '../../types';
import {
  fetchWithQdnReadyFallback,
  isMissingResourceError,
  mapWithConcurrency,
} from './qdnReadiness';
import {
  isThreadQuarantined,
  quarantineThread,
} from '../forum/threadLoadQuarantine';
import {
  requestQortium,
  type QortiumResourceToPublish,
} from '../qortium/qortiumClient';
import { getUserAccount } from '../qortium/walletService';
import { perfDebugTimeStart } from '../perf/perfDebug';

const FORUM_SERVICE = import.meta.env.VITE_QORTIUM_QDN_SERVICE ?? 'DOCUMENT';
const FORUM_NAMESPACE =
  import.meta.env.VITE_QORTIUM_QDN_IDENTIFIER?.trim() || 'qdbm';
const TOPIC_DIRECTORY_IDENTIFIER = `${FORUM_NAMESPACE}-index-topics`;
const THREAD_INDEX_PREFIX = `${FORUM_NAMESPACE}-index-thread-`;
const VERIFY_RETRIES = 5;
const VERIFY_DELAY_MS = 1500;
const MAX_SAFE_QDN_IDENTIFIER_LENGTH = 64;
const TOPIC_DIRECTORY_CACHE_TTL_MS = 15 * 1000;

type SearchQdnResourceResult = {
  name: string;
  identifier: string;
};

export type TopicDirectorySnapshot = {
  updatedAt: number;
  topics: Array<{
    topicId: string;
    title: string;
    description: string;
    sortOrder: number;
    status: Topic['status'];
    visibility: Topic['visibility'];
    subTopicAccess: Topic['subTopicAccess'];
    allowedAddresses: string[];
  }>;
  subTopics: Array<{
    subTopicId: string;
    topicId: string;
    title: string;
    description: string;
    isPinned: boolean;
    pinnedAt: string | null;
    isSolved: boolean;
    solvedAt: string | null;
    solvedByUserId: string | null;
    isPoll: boolean;
    access: SubTopic['access'];
    allowedAddresses: string[];
    status: SubTopic['status'];
    visibility: SubTopic['visibility'];
    authorUserId: string;
    lastPostAt: string;
    lastPostAuthorUserId: string;
    lastModerationAction?: string | null;
    lastModerationReason?: string | null;
    lastModeratedByUserId?: string | null;
    lastModeratedAt?: string | null;
  }>;
};

export type ThreadSearchSnapshot = {
  subTopicId: string;
  updatedAt: number;
  posts: Array<{
    postId: string;
    authorUserId: string;
    parentPostId: string | null;
    content: string;
    attachments: PostAttachment[];
    poll?: Post['poll'];
    createdAt: string;
    updatedAt?: string | null;
    editedAt?: string | null;
    isPinned?: boolean;
    pinnedAt?: string | null;
    pinnedByUserId?: string | null;
    likes: number;
    tips: number;
    likedByAddresses: string[];
  }>;
};

type TopicDirectoryPayload = {
  version: 1;
  type: 'topic-directory-index';
  updatedAt: number;
  snapshot: TopicDirectorySnapshot;
};

type ThreadIndexPayload = {
  version: 1;
  type: 'thread-search-index';
  updatedAt: number;
  snapshot: ThreadSearchSnapshot;
};

let topicDirectoryIndexCache: {
  value: TopicDirectorySnapshot | null;
  updatedAt: number;
  inflight: Promise<TopicDirectorySnapshot | null> | null;
} = {
  value: null,
  updatedAt: 0,
  inflight: null,
};

const encodeBase64Json = (value: unknown): string => {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
};

const decodeBase64Json = (value: string): unknown => {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const decoded = new TextDecoder().decode(bytes);
  return JSON.parse(decoded) as unknown;
};

const parseJsonLike = (raw: unknown): unknown => {
  if (typeof raw !== 'string') {
    return raw;
  }

  const trimmed = raw.trim();

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return decodeBase64Json(trimmed);
  }
};

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const sanitizePostAttachments = (value: unknown): PostAttachment[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => isObject(item))
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : '',
      service: typeof item.service === 'string' ? item.service : 'FILE',
      name: typeof item.name === 'string' ? item.name : '',
      identifier: typeof item.identifier === 'string' ? item.identifier : '',
      filename: typeof item.filename === 'string' ? item.filename : '',
      mimeType:
        typeof item.mimeType === 'string'
          ? item.mimeType
          : 'application/octet-stream',
      size:
        typeof item.size === 'number' && Number.isFinite(item.size)
          ? item.size
          : 0,
    }))
    .filter((attachment) =>
      Boolean(
        attachment.id &&
          attachment.name &&
          attachment.identifier &&
          attachment.filename
      )
    );
};

const sanitizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const next: string[] = [];

  value.forEach((entry) => {
    if (typeof entry !== 'string') {
      return;
    }

    const normalized = entry.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    next.push(normalized);
  });

  return next;
};

const sanitizePostPoll = (value: unknown): Post['poll'] => {
  if (!isObject(value)) {
    return null;
  }

  const options = Array.isArray(value.options)
    ? value.options
        .filter((item) => isObject(item))
        .map((item) => ({
          id: typeof item.id === 'string' ? item.id : '',
          label: typeof item.label === 'string' ? item.label.trim() : '',
        }))
        .filter((option) => option.id && option.label)
        .slice(0, 6)
    : [];

  if (
    typeof value.id !== 'string' ||
    typeof value.question !== 'string' ||
    !value.question.trim() ||
    options.length < 2
  ) {
    return null;
  }

  const validOptionIds = new Set(options.map((option) => option.id));
  const votes = Array.isArray(value.votes)
    ? value.votes
        .filter((item) => isObject(item))
        .map((item) => ({
          voterId: typeof item.voterId === 'string' ? item.voterId : '',
          optionIds: sanitizeStringList(item.optionIds).filter((optionId) =>
            validOptionIds.has(optionId)
          ),
          votedAt: typeof item.votedAt === 'string' ? item.votedAt : '',
        }))
        .filter(
          (vote) => vote.voterId && vote.optionIds.length > 0 && vote.votedAt
        )
    : [];

  return {
    id: value.id,
    question: value.question.trim(),
    description:
      typeof value.description === 'string' ? value.description.trim() : '',
    mode: value.mode === 'multiple' ? 'multiple' : 'single',
    options,
    votes,
    closesAt:
      typeof value.closesAt === 'string' && value.closesAt.trim()
        ? value.closesAt
        : null,
    closedAt:
      typeof value.closedAt === 'string' && value.closedAt.trim()
        ? value.closedAt
        : null,
    closedByUserId:
      typeof value.closedByUserId === 'string' && value.closedByUserId.trim()
        ? value.closedByUserId
        : null,
  };
};

const sleep = async (durationMs: number) => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
};

const assertIdentifierLength = (identifier: string) => {
  if (identifier.length > MAX_SAFE_QDN_IDENTIFIER_LENGTH) {
    throw new Error(
      `Generated QDN identifier is too long (${identifier.length}). Maximum supported length is ${MAX_SAFE_QDN_IDENTIFIER_LENGTH}.`
    );
  }
};

const resolveOwnerName = async (providedName?: string): Promise<string> => {
  if (providedName?.trim()) {
    return providedName.trim();
  }

  const account = await getUserAccount();
  if (account.name?.trim()) {
    return account.name.trim();
  }

  throw new Error('Authenticated account has no Qortium name.');
};

const searchByPrefix = async (
  prefix: string
): Promise<SearchQdnResourceResult[]> => {
  const search = await requestQortium<SearchQdnResourceResult[]>({
    action: 'SEARCH_QDN_RESOURCES',
    service: FORUM_SERVICE,
    identifier: prefix,
    prefix: true,
    mode: 'ALL',
    reverse: true,
    limit: 1000,
    offset: 0,
  });

  return Array.isArray(search) ? search : [];
};

const fetchResource = async (
  name: string,
  identifier: string
): Promise<unknown> => {
  const fetcher = () =>
    requestQortium<unknown>({
      action: 'FETCH_QDN_RESOURCE',
      service: FORUM_SERVICE,
      name,
      identifier,
    });

  const raw = await fetchWithQdnReadyFallback(
    FORUM_SERVICE,
    name,
    identifier,
    fetcher
  );
  return parseJsonLike(raw);
};

const parseTopicDirectoryPayload = (
  raw: unknown
): TopicDirectoryPayload | null => {
  if (
    !isObject(raw) ||
    raw.type !== 'topic-directory-index' ||
    !isObject(raw.snapshot)
  ) {
    return null;
  }

  const topics = Array.isArray(raw.snapshot.topics) ? raw.snapshot.topics : [];
  const subTopics = Array.isArray(raw.snapshot.subTopics)
    ? raw.snapshot.subTopics
    : [];

  return {
    version: 1,
    type: 'topic-directory-index',
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    snapshot: {
      updatedAt:
        typeof raw.snapshot.updatedAt === 'number'
          ? raw.snapshot.updatedAt
          : Date.now(),
      topics: topics
        .filter((item) => isObject(item))
        .map((item) => ({
          topicId: typeof item.topicId === 'string' ? item.topicId : '',
          title: typeof item.title === 'string' ? item.title : '',
          description:
            typeof item.description === 'string' ? item.description : '',
          sortOrder:
            typeof item.sortOrder === 'number' &&
            Number.isFinite(item.sortOrder)
              ? item.sortOrder
              : Number.MAX_SAFE_INTEGER,
          status: (item.status === 'locked'
            ? 'locked'
            : 'open') as Topic['status'],
          visibility: (item.visibility === 'hidden'
            ? 'hidden'
            : 'visible') as Topic['visibility'],
          subTopicAccess: (item.subTopicAccess === 'moderators' ||
          item.subTopicAccess === 'admins' ||
          item.subTopicAccess === 'custom'
            ? item.subTopicAccess
            : 'everyone') as Topic['subTopicAccess'],
          allowedAddresses: Array.isArray(item.allowedAddresses)
            ? item.allowedAddresses.filter(
                (address): address is string =>
                  typeof address === 'string' && Boolean(address.trim())
              )
            : [],
        }))
        .filter((item) => item.topicId)
        .sort((a, b) => a.sortOrder - b.sortOrder),
      subTopics: subTopics
        .filter((item) => isObject(item))
        .map((item) => ({
          subTopicId:
            typeof item.subTopicId === 'string' ? item.subTopicId : '',
          topicId: typeof item.topicId === 'string' ? item.topicId : '',
          title: typeof item.title === 'string' ? item.title : '',
          description:
            typeof item.description === 'string' ? item.description : '',
          isPinned: item.isPinned === true,
          pinnedAt:
            typeof item.pinnedAt === 'string' && item.pinnedAt.trim()
              ? item.pinnedAt
              : null,
          isSolved: item.isSolved === true,
          solvedAt:
            typeof item.solvedAt === 'string' && item.solvedAt.trim()
              ? item.solvedAt
              : null,
          solvedByUserId:
            typeof item.solvedByUserId === 'string' &&
            item.solvedByUserId.trim()
              ? item.solvedByUserId
              : null,
          isPoll: item.isPoll === true,
          access: (item.access === 'moderators' ||
          item.access === 'admins' ||
          item.access === 'custom'
            ? item.access
            : 'everyone') as SubTopic['access'],
          allowedAddresses: Array.isArray(item.allowedAddresses)
            ? item.allowedAddresses.filter(
                (address): address is string =>
                  typeof address === 'string' && Boolean(address.trim())
              )
            : [],
          status: (item.status === 'locked'
            ? 'locked'
            : 'open') as SubTopic['status'],
          visibility: (item.visibility === 'hidden'
            ? 'hidden'
            : 'visible') as SubTopic['visibility'],
          authorUserId:
            typeof item.authorUserId === 'string' ? item.authorUserId : '',
          lastPostAt:
            typeof item.lastPostAt === 'string' ? item.lastPostAt : '',
          lastPostAuthorUserId:
            typeof item.lastPostAuthorUserId === 'string' &&
            item.lastPostAuthorUserId.trim()
              ? item.lastPostAuthorUserId
              : typeof item.authorUserId === 'string'
                ? item.authorUserId
                : '',
          lastModerationAction:
            typeof item.lastModerationAction === 'string' &&
            item.lastModerationAction.trim()
              ? item.lastModerationAction
              : null,
          lastModerationReason:
            typeof item.lastModerationReason === 'string' &&
            item.lastModerationReason.trim()
              ? item.lastModerationReason
              : null,
          lastModeratedByUserId:
            typeof item.lastModeratedByUserId === 'string' &&
            item.lastModeratedByUserId.trim()
              ? item.lastModeratedByUserId
              : null,
          lastModeratedAt:
            typeof item.lastModeratedAt === 'string' &&
            item.lastModeratedAt.trim()
              ? item.lastModeratedAt
              : null,
        }))
        .filter((item) => item.subTopicId && item.topicId),
    },
  };
};

const parseThreadIndexPayload = (raw: unknown): ThreadIndexPayload | null => {
  if (
    !isObject(raw) ||
    raw.type !== 'thread-search-index' ||
    !isObject(raw.snapshot)
  ) {
    return null;
  }

  const posts = Array.isArray(raw.snapshot.posts) ? raw.snapshot.posts : [];

  if (
    typeof raw.snapshot.subTopicId !== 'string' ||
    !raw.snapshot.subTopicId.trim()
  ) {
    return null;
  }

  return {
    version: 1,
    type: 'thread-search-index',
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    snapshot: {
      subTopicId: raw.snapshot.subTopicId,
      updatedAt:
        typeof raw.snapshot.updatedAt === 'number'
          ? raw.snapshot.updatedAt
          : Date.now(),
      posts: posts
        .filter((item) => isObject(item))
        .map((item) => ({
          postId: typeof item.postId === 'string' ? item.postId : '',
          authorUserId:
            typeof item.authorUserId === 'string' ? item.authorUserId : '',
          parentPostId:
            typeof item.parentPostId === 'string' ? item.parentPostId : null,
          content: typeof item.content === 'string' ? item.content : '',
          attachments: sanitizePostAttachments(item.attachments),
          poll: sanitizePostPoll(item.poll),
          createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
          updatedAt:
            typeof item.updatedAt === 'string'
              ? item.updatedAt
              : typeof item.editedAt === 'string'
                ? item.editedAt
                : typeof item.createdAt === 'string'
                  ? item.createdAt
                  : '',
          editedAt:
            typeof item.editedAt === 'string' || item.editedAt === null
              ? item.editedAt
              : null,
          isPinned: item.isPinned === true,
          pinnedAt: typeof item.pinnedAt === 'string' ? item.pinnedAt : null,
          pinnedByUserId:
            typeof item.pinnedByUserId === 'string'
              ? item.pinnedByUserId
              : null,
          likes:
            typeof item.likes === 'number' && Number.isFinite(item.likes)
              ? item.likes
              : 0,
          tips:
            typeof item.tips === 'number' && Number.isFinite(item.tips)
              ? item.tips
              : 0,
          likedByAddresses: sanitizeStringList(item.likedByAddresses),
        }))
        .filter((item) => item.postId),
    },
  };
};

const publishPayload = async (
  ownerName: string,
  identifier: string,
  payload: TopicDirectoryPayload | ThreadIndexPayload,
  title: string,
  description: string,
  tags: string[]
) => {
  assertIdentifierLength(identifier);

  await requestQortium<unknown>({
    action: 'PUBLISH_QDN_RESOURCE',
    service: FORUM_SERVICE,
    name: ownerName,
    identifier,
    title,
    description,
    tags,
    data64: encodeBase64Json(payload),
  });
};

const toPublishResource = (
  ownerName: string,
  identifier: string,
  payload: TopicDirectoryPayload | ThreadIndexPayload,
  title: string,
  description: string,
  tags: string[]
): QortiumResourceToPublish => {
  assertIdentifierLength(identifier);

  return {
    service: FORUM_SERVICE,
    name: ownerName,
    identifier,
    title,
    description,
    tags,
    data64: encodeBase64Json(payload),
  };
};

const verifyPublication = async (
  ownerName: string,
  identifier: string,
  type: TopicDirectoryPayload['type'] | ThreadIndexPayload['type']
) => {
  for (let attempt = 1; attempt <= VERIFY_RETRIES; attempt += 1) {
    try {
      const raw = await requestQortium<unknown>({
        action: 'FETCH_QDN_RESOURCE',
        service: FORUM_SERVICE,
        name: ownerName,
        identifier,
      });
      const parsed = parseJsonLike(raw) as { type?: string } | null;
      if (parsed?.type === type) {
        return;
      }
    } catch {
      // Retry until exhausted.
    }

    if (attempt < VERIFY_RETRIES) {
      await sleep(VERIFY_DELAY_MS);
    }
  }

  throw new Error('Search index was submitted but could not be verified yet.');
};

const pickLatest = <TPayload extends { updatedAt: number }>(
  payloads: Array<TPayload | null>
) => {
  return (
    payloads
      .filter((item): item is TPayload => item !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
  );
};

export const forumSearchIndexService = {
  buildTopicDirectoryIndexPublishResource(
    topics: Topic[],
    subTopics: SubTopic[],
    ownerName: string
  ) {
    const updatedAt = Date.now();
    const payload: TopicDirectoryPayload = {
      version: 1,
      type: 'topic-directory-index',
      updatedAt,
      snapshot: {
        updatedAt,
        topics: topics.map((topic) => ({
          topicId: topic.id,
          title: topic.title,
          description: topic.description,
          sortOrder: topic.sortOrder,
          status: topic.status,
          visibility: topic.visibility,
          subTopicAccess: topic.subTopicAccess,
          allowedAddresses: topic.allowedAddresses,
        })),
        subTopics: subTopics.map((subTopic) => ({
          subTopicId: subTopic.id,
          topicId: subTopic.topicId,
          title: subTopic.title,
          description: subTopic.description,
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
          authorUserId: subTopic.authorUserId,
          lastPostAt: subTopic.lastPostAt,
          lastPostAuthorUserId: subTopic.lastPostAuthorUserId,
          lastModerationAction: subTopic.lastModerationAction ?? null,
          lastModerationReason: subTopic.lastModerationReason ?? null,
          lastModeratedByUserId: subTopic.lastModeratedByUserId ?? null,
          lastModeratedAt: subTopic.lastModeratedAt ?? null,
        })),
      },
    };

    return {
      identifier: TOPIC_DIRECTORY_IDENTIFIER,
      snapshot: payload.snapshot,
      resource: toPublishResource(
        ownerName,
        TOPIC_DIRECTORY_IDENTIFIER,
        payload,
        'Forum topic directory index',
        'Persistent forum search index for topics and sub-topics',
        ['forum', 'search', 'index', 'qdb']
      ),
    };
  },

  async loadTopicDirectoryIndex(): Promise<TopicDirectorySnapshot | null> {
    const endTiming = perfDebugTimeStart('topic-directory-index-load');
    const now = Date.now();

    if (
      topicDirectoryIndexCache.value &&
      now - topicDirectoryIndexCache.updatedAt <= TOPIC_DIRECTORY_CACHE_TTL_MS
    ) {
      endTiming({
        cacheHit: true,
        topicCount: topicDirectoryIndexCache.value.topics.length,
        subTopicCount: topicDirectoryIndexCache.value.subTopics.length,
      });
      return topicDirectoryIndexCache.value;
    }

    if (topicDirectoryIndexCache.inflight) {
      endTiming({ reusedInflight: true });
      return topicDirectoryIndexCache.inflight;
    }

    const loadPromise = (async () => {
      const resources = await searchByPrefix(TOPIC_DIRECTORY_IDENTIFIER);
      const payloads = await mapWithConcurrency(resources, async (item) => {
        try {
          const raw = await fetchResource(item.name, item.identifier);
          return parseTopicDirectoryPayload(raw);
        } catch {
          return null;
        }
      });

      return pickLatest(payloads)?.snapshot ?? null;
    })()
      .then((result) => {
        topicDirectoryIndexCache = {
          value: result,
          updatedAt: Date.now(),
          inflight: null,
        };
        return result;
      })
      .catch((error) => {
        topicDirectoryIndexCache = {
          ...topicDirectoryIndexCache,
          inflight: null,
        };
        throw error;
      });

    topicDirectoryIndexCache = {
      ...topicDirectoryIndexCache,
      inflight: loadPromise,
    };

    return loadPromise.then((result) => {
      endTiming({
        cacheHit: false,
        found: Boolean(result),
        topicCount: result?.topics.length ?? 0,
        subTopicCount: result?.subTopics.length ?? 0,
      });
      return result;
    });
  },

  async publishTopicDirectoryIndex(
    topics: Topic[],
    subTopics: SubTopic[],
    ownerName?: string
  ) {
    const resolvedOwner = await resolveOwnerName(ownerName);
    const { snapshot } = this.buildTopicDirectoryIndexPublishResource(
      topics,
      subTopics,
      resolvedOwner
    );
    const updatedAt = snapshot.updatedAt;
    const payload: TopicDirectoryPayload = {
      version: 1,
      type: 'topic-directory-index',
      updatedAt,
      snapshot,
    };

    await publishPayload(
      resolvedOwner,
      TOPIC_DIRECTORY_IDENTIFIER,
      payload,
      'Forum topic directory index',
      'Persistent forum search index for topics and sub-topics',
      ['forum', 'search', 'index', 'qdb']
    );
    await verifyPublication(
      resolvedOwner,
      TOPIC_DIRECTORY_IDENTIFIER,
      'topic-directory-index'
    );
    topicDirectoryIndexCache = {
      value: snapshot,
      updatedAt,
      inflight: null,
    };
    return snapshot;
  },

  buildThreadIndexPublishResource(
    subTopicId: string,
    posts: Post[],
    ownerName: string
  ) {
    const updatedAt = Date.now();
    const identifier = `${THREAD_INDEX_PREFIX}${subTopicId}`;
    const payload: ThreadIndexPayload = {
      version: 1,
      type: 'thread-search-index',
      updatedAt,
      snapshot: {
        subTopicId,
        updatedAt,
        posts: posts
          .filter((post) => post.subTopicId === subTopicId)
          .map((post) => ({
            postId: post.id,
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
          })),
      },
    };

    return {
      identifier,
      snapshot: payload.snapshot,
      resource: toPublishResource(
        ownerName,
        identifier,
        payload,
        `Forum thread index ${subTopicId}`,
        'Persistent forum search index for a thread',
        ['forum', 'search', 'thread', 'index', 'qdb']
      ),
    };
  },

  async loadThreadIndex(
    subTopicId: string
  ): Promise<ThreadSearchSnapshot | null> {
    if (isThreadQuarantined(subTopicId)) {
      return null;
    }

    const identifier = `${THREAD_INDEX_PREFIX}${subTopicId}`;
    const resources = await searchByPrefix(identifier);
    let sawMissingResourceError = false;
    const payloads = await mapWithConcurrency(resources, async (item) => {
      try {
        const raw = await fetchResource(item.name, item.identifier);
        return parseThreadIndexPayload(raw);
      } catch (error) {
        if (isMissingResourceError(error)) {
          sawMissingResourceError = true;
        }
        return null;
      }
    });

    const snapshot =
      pickLatest(
        payloads.filter((item) => item?.snapshot.subTopicId === subTopicId)
      )?.snapshot ?? null;

    if (!snapshot && sawMissingResourceError) {
      quarantineThread(subTopicId);
    }

    return snapshot;
  },

  async publishThreadIndex(
    subTopicId: string,
    posts: Post[],
    ownerName?: string
  ) {
    const resolvedOwner = await resolveOwnerName(ownerName);
    const { identifier, snapshot } = this.buildThreadIndexPublishResource(
      subTopicId,
      posts,
      resolvedOwner
    );
    const payload: ThreadIndexPayload = {
      version: 1,
      type: 'thread-search-index',
      updatedAt: snapshot.updatedAt,
      snapshot,
    };

    await publishPayload(
      resolvedOwner,
      identifier,
      payload,
      `Forum thread index ${subTopicId}`,
      'Persistent forum search index for a thread',
      ['forum', 'search', 'thread', 'index', 'qdb']
    );
    await verifyPublication(resolvedOwner, identifier, 'thread-search-index');
    return snapshot;
  },
};
