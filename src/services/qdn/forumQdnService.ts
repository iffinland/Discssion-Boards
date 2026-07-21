import type {
  Post,
  PostAttachment,
  SubTopic,
  Topic,
} from '../../types/index.js';
import { generateForumEntityId, toPartitionKey } from '../forum/forumId.js';
import {
  ensureQdnResourceReady,
  fetchWithQdnReadyFallback,
  mapWithConcurrency,
} from './qdnReadiness.js';
import {
  requestQortium,
  type QortiumResourceToPublish,
} from '../qortium/qortiumClient.js';
import {
  getUserAccount,
  resolveNameWalletAddress,
} from '../qortium/walletService.js';
import { perfDebugTimeStart } from '../perf/perfDebug.js';
import type {
  LegacyAuthorityState,
  QdbV2ResourceMetadata,
} from '../architectureV2/types.js';
import {
  buildV2Envelope,
  buildV2OwnerEditEnvelope,
  isV2EntityEnvelope,
  reduceV2RuntimeRecords,
  toV2RuntimeRecord,
  type V2RuntimeRecord,
  type V2RuntimeState,
} from '../architectureV2/runtime.js';
import type { OwnerEdit } from '../architectureV2/types.js';
import { applyOwnerEdit } from '../architectureV2/reducer.js';
import type { V2EntityCreate } from '../architectureV2/types.js';
import { validateEntityCreate } from '../architectureV2/validation.js';
import {
  buildReactionEnvelope,
  buildReactionIdentifier,
  buildReactionTargetPrefix,
  loadReactionState,
  publishReactionEnvelope,
  resolveReactionDisplay,
  type ReactionState,
} from '../architectureV2/reactions.js';
import {
  isNativePollReference,
  isNativePostPoll,
  toPersistedNativePollReference,
} from '../architectureV2/polls.js';
import { loadNativePostPoll } from '../qortium/nativePollService.js';
import type { IdentityValidator } from '../architectureV2/validation.js';
import {
  buildModerationEnvelope,
  applyModerationToForumStructure,
  applyModerationToPosts,
  loadModerationState,
  publishModerationEnvelope,
  reduceModerationRecords,
  resolveRoleFromTrustedState,
  type ModerationAction,
  type ModerationOperation,
  type ReducedModerationState,
  type TrustedRoleAuthorizationState,
} from '../architectureV2/moderation.js';
import { forumRolesService } from './forumRolesService.js';
import {
  finalizeTipDerivedState,
  forumTipsService,
  type TipRecovery,
} from './forumTipsService.js';

const FORUM_SERVICE = import.meta.env?.VITE_QORTIUM_QDN_SERVICE ?? 'DOCUMENT';
const FORUM_IMAGE_SERVICE =
  import.meta.env?.VITE_QORTIUM_QDN_IMAGE_SERVICE ?? 'IMAGE';
const FORUM_NAMESPACE =
  import.meta.env?.VITE_QORTIUM_QDN_IDENTIFIER?.trim() || 'qdbm';
const FORUM_IDENTIFIER_PREFIX = `${FORUM_NAMESPACE}-`;
const TOPIC_PREFIX = `${FORUM_IDENTIFIER_PREFIX}topic-`;
const SUBTOPIC_PREFIX = `${FORUM_IDENTIFIER_PREFIX}sub-`;
const POST_PREFIX = `${FORUM_IDENTIFIER_PREFIX}post-`;
const MODERATION_PREFIX = `${FORUM_IDENTIFIER_PREFIX}v2-mod-`;
const IMAGE_PREFIX = `${FORUM_IDENTIFIER_PREFIX}img-`;
const ATTACHMENT_PREFIX = `${FORUM_IDENTIFIER_PREFIX}att-`;
const VIDEO_PREFIX = `${FORUM_IDENTIFIER_PREFIX}video-`;
const VERIFY_RETRIES = 5;
const VERIFY_DELAY_MS = 1500;
const IMAGE_PUBLISH_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_SAFE_QDN_IDENTIFIER_LENGTH = 64;
const FORUM_STRUCTURE_CACHE_TTL_MS = 30 * 1000;
const imageUrlCache = new Map<string, string>();

interface SearchQdnResourceResult {
  name: string;
  identifier: string;
  service?: string;
  created?: number;
  updated?: number | null;
  latestSignature?: string;
  status?: unknown;
}

export type LegacyResourceProvenance = {
  resource: QdbV2ResourceMetadata;
  availability: 'available' | 'unavailable';
  authorityState: LegacyAuthorityState;
};

export type ForumPostImageReference = {
  service: string;
  name: string;
  identifier: string;
  filename: string;
};

export type ForumPostAttachmentReference = {
  service: string;
  name: string;
  identifier: string;
  filename: string;
  mimeType: string;
  size: number;
};

export type ForumPostVideoReference = {
  service: 'VIDEO';
  name: string;
  identifier: string;
  filename: string;
  mimeType: string;
  size: number;
};

type EntityStatus = 'active' | 'deleted';

type TopicPayload = {
  version: 1;
  type: 'topic';
  status: EntityStatus;
  updatedAt: number;
  topic: Topic;
  provenance?: LegacyResourceProvenance;
};

type SubTopicPayload = {
  version: 1;
  type: 'subtopic';
  status: EntityStatus;
  updatedAt: number;
  subTopic: SubTopic;
  provenance?: LegacyResourceProvenance;
};

type PostPayload = {
  version: 1;
  type: 'post';
  status: EntityStatus;
  updatedAt: number;
  post: Post;
  provenance?: LegacyResourceProvenance;
};

type ForumStructureSnapshot = {
  topics: Topic[];
  subTopics: SubTopic[];
};

let forumStructureCache: {
  value: ForumStructureSnapshot | null;
  updatedAt: number;
  inflight: Promise<ForumStructureSnapshot> | null;
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

const fileToBase64 = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

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

const toTopicIdentifier = (topicId: string) => `${TOPIC_PREFIX}${topicId}`;
const toSubTopicIdentifier = (subTopicId: string) =>
  `${SUBTOPIC_PREFIX}${subTopicId}`;
const toThreadPostPartition = (subTopicId: string) =>
  toPartitionKey(subTopicId, 8);
const toThreadPostPrefix = (subTopicId: string) =>
  `${POST_PREFIX}${toThreadPostPartition(subTopicId)}-`;
const toLegacyPostSearchPrefix = () => POST_PREFIX;
const toPostIdentifier = (post: Post) =>
  `${toThreadPostPrefix(post.subTopicId)}${post.id}`;
const toImageIdentifier = (imageId: string) => `${IMAGE_PREFIX}${imageId}`;
const toAttachmentIdentifier = (attachmentId: string) =>
  `${ATTACHMENT_PREFIX}${attachmentId}`;
const toVideoIdentifier = (videoId: string) => `${VIDEO_PREFIX}${videoId}`;

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

const verifyPublication = async (
  ownerName: string,
  identifier: string,
  expectedType:
    | TopicPayload['type']
    | SubTopicPayload['type']
    | PostPayload['type']
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
      if (parsed && parsed.type === expectedType) {
        return;
      }
    } catch {
      // Keep retrying.
    }

    if (attempt < VERIFY_RETRIES) {
      await sleep(VERIFY_DELAY_MS);
    }
  }

  throw new Error(
    'Publish was submitted but resource could not be verified yet.'
  );
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
    includeMetadata: true,
    includeStatus: true,
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

const mapLatestPayloads = <TPayload extends { updatedAt: number }, TKey>(
  payloads: Array<TPayload | null>,
  keyOf: (payload: TPayload) => TKey
) => {
  // This selector is V1 display compatibility only. Its client timestamp
  // never establishes V2 authority or mutation permission.
  const nextMap = new Map<TKey, TPayload>();

  payloads.filter(Boolean).forEach((payload) => {
    if (!payload) return;
    const key = keyOf(payload);
    const current = nextMap.get(key);
    if (!current || payload.updatedAt > current.updatedAt) {
      nextMap.set(key, payload);
    }
  });

  return nextMap;
};

const fetchTopicPayloads = async () => {
  const topicResults = await searchByPrefix(TOPIC_PREFIX);
  let failedCount = 0;
  const payloads = await mapWithConcurrency(topicResults, async (item) => {
    try {
      const raw = await fetchResource(item.name, item.identifier);
      return parseTopicPayload(raw, item);
    } catch {
      failedCount += 1;
      return null;
    }
  });
  return {
    payloads,
    resourceCount: topicResults.length,
    failedCount,
  };
};

const fetchSubTopicPayloads = async () => {
  const subTopicResults = await searchByPrefix(SUBTOPIC_PREFIX);
  let failedCount = 0;
  const payloads = await mapWithConcurrency(subTopicResults, async (item) => {
    try {
      const raw = await fetchResource(item.name, item.identifier);
      return parseSubTopicPayload(raw, item);
    } catch {
      failedCount += 1;
      return null;
    }
  });
  return {
    payloads,
    resourceCount: subTopicResults.length,
    failedCount,
  };
};

const fetchPostPayloadsByPrefix = async (prefix: string) => {
  const postResults = await searchByPrefix(prefix);
  return mapWithConcurrency(postResults, async (item) => {
    try {
      const raw = await fetchResource(item.name, item.identifier);
      return parsePostPayload(raw, item);
    } catch {
      return null;
    }
  });
};

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const sanitizeAddressList = (value: unknown) => {
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

  if (isNativePollReference(value)) {
    return value;
  }
  if (value.kind === 'native' || value.schema === 'qdb-native-poll') {
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
          optionIds: sanitizeAddressList(item.optionIds).filter((optionId) =>
            validOptionIds.has(optionId)
          ),
          votedAt: typeof item.votedAt === 'string' ? item.votedAt : '',
        }))
        .filter(
          (vote) => vote.voterId && vote.optionIds.length > 0 && vote.votedAt
        )
    : [];

  return {
    kind: 'legacy',
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

const toPersistedPost = (post: Post): Post => {
  const persisted = { ...post };
  delete persisted.tipSummary;
  return {
    ...persisted,
    poll: isNativePostPoll(post.poll)
      ? toPersistedNativePollReference(post.poll)
      : (post.poll ?? null),
  };
};

const sanitizeTopic = (value: unknown): Topic | null => {
  if (!isObject(value)) {
    return null;
  }

  if (
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.description !== 'string' ||
    typeof value.createdByUserId !== 'string' ||
    typeof value.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: value.id,
    title: value.title,
    description: value.description,
    createdByUserId: value.createdByUserId,
    createdAt: value.createdAt,
    sortOrder:
      typeof value.sortOrder === 'number' && Number.isFinite(value.sortOrder)
        ? value.sortOrder
        : new Date(value.createdAt).getTime(),
    status: value.status === 'locked' ? 'locked' : 'open',
    visibility: value.visibility === 'hidden' ? 'hidden' : 'visible',
    subTopicAccess:
      value.subTopicAccess === 'moderators' ||
      value.subTopicAccess === 'admins' ||
      value.subTopicAccess === 'custom'
        ? value.subTopicAccess
        : 'everyone',
    allowedAddresses: sanitizeAddressList(value.allowedAddresses),
  };
};

const sanitizeSubTopic = (value: unknown): SubTopic | null => {
  if (!isObject(value)) {
    return null;
  }

  if (
    typeof value.id !== 'string' ||
    typeof value.topicId !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.description !== 'string' ||
    typeof value.authorUserId !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.lastPostAt !== 'string'
  ) {
    return null;
  }

  return {
    id: value.id,
    topicId: value.topicId,
    title: value.title,
    description: value.description,
    authorUserId: value.authorUserId,
    createdAt: value.createdAt,
    lastPostAt: value.lastPostAt,
    lastPostAuthorUserId:
      typeof value.lastPostAuthorUserId === 'string' &&
      value.lastPostAuthorUserId.trim()
        ? value.lastPostAuthorUserId
        : value.authorUserId,
    isPinned: value.isPinned === true,
    pinnedAt:
      typeof value.pinnedAt === 'string' && value.pinnedAt.trim()
        ? value.pinnedAt
        : null,
    isSolved: value.isSolved === true,
    solvedAt:
      typeof value.solvedAt === 'string' && value.solvedAt.trim()
        ? value.solvedAt
        : null,
    solvedByUserId:
      typeof value.solvedByUserId === 'string' && value.solvedByUserId.trim()
        ? value.solvedByUserId
        : null,
    isPoll: value.isPoll === true,
    access:
      value.access === 'moderators' ||
      value.access === 'admins' ||
      value.access === 'custom'
        ? value.access
        : 'everyone',
    allowedAddresses: sanitizeAddressList(value.allowedAddresses),
    status: value.status === 'locked' ? 'locked' : 'open',
    visibility: value.visibility === 'hidden' ? 'hidden' : 'visible',
    lastModerationAction:
      typeof value.lastModerationAction === 'string' &&
      value.lastModerationAction.trim()
        ? value.lastModerationAction
        : null,
    lastModerationReason:
      typeof value.lastModerationReason === 'string' &&
      value.lastModerationReason.trim()
        ? value.lastModerationReason
        : null,
    lastModeratedByUserId:
      typeof value.lastModeratedByUserId === 'string' &&
      value.lastModeratedByUserId.trim()
        ? value.lastModeratedByUserId
        : null,
    lastModeratedAt:
      typeof value.lastModeratedAt === 'string' && value.lastModeratedAt.trim()
        ? value.lastModeratedAt
        : null,
  };
};

const isPost = (value: unknown): value is Post => {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.subTopicId === 'string' &&
    typeof value.authorUserId === 'string' &&
    (typeof value.parentPostId === 'string' || value.parentPostId === null) &&
    typeof value.content === 'string' &&
    (Array.isArray(value.attachments) || value.attachments === undefined) &&
    typeof value.createdAt === 'string' &&
    (typeof value.updatedAt === 'string' ||
      value.updatedAt === null ||
      value.updatedAt === undefined) &&
    (typeof value.editedAt === 'string' ||
      value.editedAt === null ||
      value.editedAt === undefined) &&
    (typeof value.isPinned === 'boolean' || value.isPinned === undefined) &&
    (typeof value.pinnedAt === 'string' ||
      value.pinnedAt === null ||
      value.pinnedAt === undefined) &&
    (typeof value.pinnedByUserId === 'string' ||
      value.pinnedByUserId === null ||
      value.pinnedByUserId === undefined) &&
    (typeof value.likes === 'number' || value.likes === undefined) &&
    (typeof value.tips === 'number' || value.tips === undefined) &&
    (Array.isArray(value.likedByAddresses) ||
      value.likedByAddresses === undefined)
  );
};

const toLegacyProvenance = (
  resource: SearchQdnResourceResult
): LegacyResourceProvenance | undefined => {
  if (
    typeof resource.service !== 'string' ||
    typeof resource.created !== 'number' ||
    (resource.updated !== undefined &&
      resource.updated !== null &&
      typeof resource.updated !== 'number')
  ) {
    return undefined;
  }
  return {
    resource: {
      service: resource.service,
      publisherName: resource.name,
      identifier: resource.identifier,
      created: resource.created,
      updated: resource.updated ?? null,
      latestSignature: resource.latestSignature,
    },
    availability: 'available',
    authorityState: 'UNRESOLVED',
  };
};

const parseTopicPayload = (
  raw: unknown,
  resource: SearchQdnResourceResult
): TopicPayload | null => {
  if (!isObject(raw) || raw.type !== 'topic') {
    return null;
  }

  const topic = sanitizeTopic(raw.topic);
  if (!topic) {
    return null;
  }

  const status = raw.status === 'deleted' ? 'deleted' : 'active';
  return {
    version: 1,
    type: 'topic',
    status,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    topic,
    provenance: toLegacyProvenance(resource),
  };
};

const parseSubTopicPayload = (
  raw: unknown,
  resource: SearchQdnResourceResult
): SubTopicPayload | null => {
  if (!isObject(raw) || raw.type !== 'subtopic') {
    return null;
  }

  const subTopic = sanitizeSubTopic(raw.subTopic);
  if (!subTopic) {
    return null;
  }

  const status = raw.status === 'deleted' ? 'deleted' : 'active';
  return {
    version: 1,
    type: 'subtopic',
    status,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    subTopic,
    provenance: toLegacyProvenance(resource),
  };
};

const parsePostPayload = (
  raw: unknown,
  resource: SearchQdnResourceResult
): PostPayload | null => {
  if (!isObject(raw) || raw.type !== 'post' || !isPost(raw.post)) {
    return null;
  }

  const status = raw.status === 'deleted' ? 'deleted' : 'active';
  return {
    version: 1,
    type: 'post',
    status,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    post: {
      ...raw.post,
      attachments: sanitizePostAttachments(raw.post.attachments),
      poll: sanitizePostPoll(raw.post.poll),
      updatedAt:
        typeof raw.post.updatedAt === 'string'
          ? raw.post.updatedAt
          : (raw.post.editedAt ?? raw.post.createdAt),
      isPinned: raw.post.isPinned === true,
      pinnedAt:
        typeof raw.post.pinnedAt === 'string' ? raw.post.pinnedAt : null,
      pinnedByUserId:
        typeof raw.post.pinnedByUserId === 'string'
          ? raw.post.pinnedByUserId
          : null,
      likes:
        typeof raw.post.likes === 'number' && Number.isFinite(raw.post.likes)
          ? raw.post.likes
          : 0,
      tips:
        typeof raw.post.tips === 'number' && Number.isFinite(raw.post.tips)
          ? raw.post.tips
          : 0,
      likedByAddresses: sanitizeAddressList(raw.post.likedByAddresses),
    },
    provenance: toLegacyProvenance(resource),
  };
};

const publishPayload = async (
  ownerName: string,
  identifier: string,
  payload: TopicPayload | SubTopicPayload | PostPayload,
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
  payload: TopicPayload | SubTopicPayload | PostPayload,
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

export const forumQdnService = {
  async loadV2ModerationState(options?: {
    identity?: IdentityValidator;
    roleState?: TrustedRoleAuthorizationState;
    authority?: V2RuntimeState;
  }): Promise<ReducedModerationState> {
    const resources = await searchByPrefix(MODERATION_PREFIX);
    const walletByName = new Map<string, string | null>();
    if (!options?.identity) {
      await Promise.all(
        [
          ...new Set(resources.map((item) => item.name.trim()).filter(Boolean)),
        ].map(async (name) => {
          try {
            walletByName.set(
              name.trim().toLowerCase(),
              await resolveNameWalletAddress(name)
            );
          } catch {
            walletByName.set(name.trim().toLowerCase(), null);
          }
        })
      );
    }
    const identity: IdentityValidator = options?.identity ?? {
      validatePublisher: (metadata, claimedPublisher) =>
        metadata.publisherName.trim().toLowerCase() ===
        claimedPublisher.trim().toLowerCase()
          ? { ok: true }
          : {
              ok: false,
              code: 'IDENTITY_UNVERIFIED',
              detail: 'moderation actor does not match QDN publisher',
            },
      validateWalletBinding: (publisherName, walletAddress) =>
        walletByName.get(publisherName.trim().toLowerCase())?.trim() ===
        walletAddress.trim()
          ? { ok: true }
          : {
              ok: false,
              code: 'IDENTITY_UNVERIFIED',
              detail: 'current QDN name-to-wallet binding is unavailable',
            },
    };
    const [authority, roleState] = await Promise.all([
      options?.authority
        ? Promise.resolve(options.authority)
        : this.loadV2AuthorityState(options?.identity),
      options?.roleState
        ? Promise.resolve(options.roleState)
        : forumRolesService.loadTrustedRoleAuthorizationState({ force: true }),
    ]);
    return loadModerationState(resources, {
      fetchPayload: (resource) =>
        fetchResource(resource.name ?? '', resource.identifier ?? ''),
      identity,
      roleState,
      authority: authority.authoritative,
    });
  },

  async publishV2ModerationOperation(
    input: {
      action: ModerationAction;
      targetType: V2EntityCreate['entityType'];
      targetId: string;
      actorName: string;
      actorAddress: string;
      reason?: string;
      orderValue?: number;
    },
    publishDerived?: () => Promise<void>
  ) {
    const roleState = await forumRolesService.loadTrustedRoleAuthorizationState(
      {
        force: true,
      }
    );
    const resolvedWallet = await resolveNameWalletAddress(input.actorName);
    if (!resolvedWallet || resolvedWallet.trim() !== input.actorAddress.trim())
      throw new Error(
        '[MODERATION_WALLET_BINDING_MISSING] current actor name/wallet binding could not be verified'
      );
    const identity: IdentityValidator = {
      validatePublisher: (metadata, claimedPublisher) =>
        metadata.publisherName.trim().toLowerCase() ===
        claimedPublisher.trim().toLowerCase()
          ? { ok: true }
          : {
              ok: false,
              code: 'IDENTITY_UNVERIFIED',
              detail: 'moderation actor does not match QDN publisher',
            },
      validateWalletBinding: (publisherName, walletAddress) =>
        publisherName.trim().toLowerCase() ===
          input.actorName.trim().toLowerCase() &&
        walletAddress.trim() === resolvedWallet.trim()
          ? { ok: true }
          : {
              ok: false,
              code: 'IDENTITY_UNVERIFIED',
              detail: 'moderation wallet binding mismatch',
            },
    };
    const authority = await this.loadV2AuthorityState();
    const operation: ModerationOperation = {
      operation: 'moderation',
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      actorName: input.actorName,
      actorAddress: input.actorAddress,
      authorization: {
        model: 'v2-role-operation-history',
        actorRole: resolveRoleFromTrustedState(input.actorAddress, roleState),
        ...roleState.checkpoint,
      },
      ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
      ...(input.action === 'set-order' ? { orderValue: input.orderValue } : {}),
    };
    const recordId = `${MODERATION_PREFIX}${generateForumEntityId(
      'moderation',
      input.actorName
    )}`;
    assertIdentifierLength(recordId);
    const envelope = buildModerationEnvelope(operation, recordId);
    const now = Date.now();
    const preflight = reduceModerationRecords(
      [
        {
          metadata: {
            service: FORUM_SERVICE,
            publisherName: input.actorName,
            identifier: recordId,
            created: now,
            updated: null,
          },
          envelope,
        },
      ],
      authority.authoritative,
      identity,
      roleState
    );
    const rejection = preflight.diagnostics[0];
    if (rejection) throw new Error(`[${rejection.code}] ${rejection.detail}`);
    const result = await publishModerationEnvelope(
      envelope,
      async (record) => {
        await requestQortium<unknown>({
          action: 'PUBLISH_QDN_RESOURCE',
          service: FORUM_SERVICE,
          name: input.actorName,
          identifier: recordId,
          tags: ['forum', 'qdb-v2', 'moderation', input.action],
          data64: encodeBase64Json(record),
        });
      },
      publishDerived
    );
    if (result.ok === false)
      throw new Error(`[${result.code}] ${result.detail}`);
    return result;
  },

  async applyForumModerationState(topics: Topic[], subTopics: SubTopic[]) {
    let moderation: ReducedModerationState;
    try {
      moderation = await this.loadV2ModerationState();
    } catch {
      return { topics, subTopics };
    }
    return applyModerationToForumStructure(topics, subTopics, moderation);
  },

  async applyPostModerationState(posts: Post[]) {
    let moderation: ReducedModerationState;
    try {
      moderation = await this.loadV2ModerationState();
    } catch {
      return posts;
    }
    return applyModerationToPosts(posts, moderation);
  },

  async publishPostReaction(
    targetId: string,
    state: ReactionState,
    publisherName: string,
    walletAddress: string
  ) {
    const resolvedWallet = await resolveNameWalletAddress(publisherName);
    if (!resolvedWallet || resolvedWallet !== walletAddress)
      throw new Error(
        '[IDENTITY_UNVERIFIED] reaction publisher wallet binding failed'
      );
    const identifier = await buildReactionIdentifier(
      FORUM_NAMESPACE,
      targetId,
      publisherName,
      walletAddress
    );
    const envelope = buildReactionEnvelope(
      {
        operation: 'reaction',
        targetType: 'post',
        targetId,
        reaction: 'like',
        state,
        publisherName,
        walletAddress,
      },
      identifier
    );
    assertIdentifierLength(identifier);
    return publishReactionEnvelope(envelope, async (reactionEnvelope) => {
      await requestQortium<unknown>({
        action: 'PUBLISH_QDN_RESOURCE',
        service: FORUM_SERVICE,
        name: publisherName,
        identifier,
        tags: ['forum', 'qdb-v2', 'reaction', 'like'],
        data64: encodeBase64Json(reactionEnvelope),
      });
    });
  },

  async loadPostReactions(targetId: string) {
    const results = await searchByPrefix(
      await buildReactionTargetPrefix(FORUM_NAMESPACE, targetId)
    );
    return loadReactionState(targetId, results, {
      fetchPayload: (resource) =>
        fetchResource(resource.name ?? '', resource.identifier ?? ''),
      resolveWalletAddress: resolveNameWalletAddress,
      expectedIdentifier: (body) =>
        buildReactionIdentifier(
          FORUM_NAMESPACE,
          body.targetId,
          body.publisherName,
          body.walletAddress
        ),
    });
  },

  async applyPostReactionState(posts: Post[]) {
    return Promise.all(
      posts.map(async (post) => {
        try {
          const reactions = await this.loadPostReactions(post.id);
          const display = resolveReactionDisplay(
            post.likes,
            post.likedByAddresses,
            reactions
          );
          return {
            ...post,
            likes: display.count,
            likedByAddresses: display.actors,
          };
        } catch {
          // Reaction discovery is non-authoritative. Preserve readable legacy
          // display data when the independent reaction domain is unavailable.
          return post;
        }
      })
    );
  },

  async applyNativePollState(
    posts: Post[],
    currentWalletAddress?: string | null
  ) {
    return Promise.all(
      posts.map(async (post) =>
        isNativePostPoll(post.poll)
          ? {
              ...post,
              poll: await loadNativePostPoll(
                toPersistedNativePollReference(post.poll),
                currentWalletAddress
              ),
            }
          : post
      )
    );
  },

  async loadPostTipState(authority?: V2RuntimeState) {
    return forumTipsService.load(
      authority ?? (await this.loadV2AuthorityState())
    );
  },

  async applyPostTipState(posts: Post[]) {
    try {
      const authority = await this.loadV2AuthorityState();
      return await forumTipsService.apply(posts, authority);
    } catch {
      return posts.map((post) => ({
        ...post,
        tipSummary: {
          status: 'unavailable' as const,
          verifiedCount: 0,
          verifiedTotalQort: '0.00000000',
          legacyCount:
            Number.isSafeInteger(post.tips) && post.tips > 0 ? post.tips : 0,
          legacyIsUnverified: true as const,
          diagnostics: [
            {
              code: 'TIP_VERIFICATION_UNAVAILABLE',
              detail: 'verified tip references are temporarily unavailable',
            },
          ],
        },
      }));
    }
  },

  async resolvePostTipRecipient(postId: string) {
    const authority = await this.loadV2AuthorityState();
    return forumTipsService.resolveRecipient(authority, postId);
  },

  async submitPostTip(
    input: {
      postId: string;
      amountQort: string;
      senderName: string;
      senderAddress: string;
      recovery?: TipRecovery;
    },
    refreshDerived?: (
      state: Awaited<ReturnType<typeof forumTipsService.load>>
    ) => Promise<void>
  ) {
    const authority = await this.loadV2AuthorityState();
    const result = input.recovery
      ? forumTipsService.retry(input.recovery, authority)
      : forumTipsService.submit({ ...input, authority });
    const resolved = await result;
    return finalizeTipDerivedState(resolved, refreshDerived);
  },

  async applyPostOperationState(
    posts: Post[],
    currentWalletAddress?: string | null
  ) {
    const moderated = await this.applyPostModerationState(posts);
    const reactions = await this.applyPostReactionState(moderated);
    const polls = await this.applyNativePollState(
      reactions,
      currentWalletAddress
    );
    return this.applyPostTipState(polls);
  },

  async publishV2OwnerEdit(
    edit: OwnerEdit,
    ownerName: string,
    identity: IdentityValidator
  ) {
    const current = await this.loadV2AuthorityState(identity);
    const target = current.authoritative.entities[edit.targetId];
    if (!target)
      throw new Error(
        '[UNAUTHORIZED_PUBLISHER] target V2 entity is not authoritative'
      );
    const metadata: QdbV2ResourceMetadata = {
      service: FORUM_SERVICE,
      publisherName: ownerName,
      identifier: `${FORUM_IDENTIFIER_PREFIX}v2-operation-${edit.targetId}`,
      created: Date.now(),
      updated: Date.now(),
    };
    const quarantineCount = current.authoritative.quarantined.length;
    const checked = applyOwnerEdit(
      current.authoritative,
      metadata,
      edit,
      identity
    );
    const rejection =
      checked.quarantined.length > quarantineCount
        ? checked.quarantined[checked.quarantined.length - 1]
        : undefined;
    if (rejection) throw new Error(`[${rejection.code}] ${rejection.detail}`);
    const envelope = buildV2OwnerEditEnvelope(
      edit,
      `${FORUM_IDENTIFIER_PREFIX}v2-edit-${edit.targetId}-${Date.now()}`
    );
    await requestQortium<unknown>({
      action: 'PUBLISH_QDN_RESOURCE',
      service: FORUM_SERVICE,
      name: ownerName,
      identifier: envelope.recordId,
      tags: ['forum', 'qdb-v2', 'owner-edit'],
      data64: encodeBase64Json(envelope),
    });
    return envelope;
  },

  async publishV2Entity(body: V2EntityCreate, identity: IdentityValidator) {
    const envelope = buildV2Envelope(
      body,
      `${FORUM_IDENTIFIER_PREFIX}v2-${body.entityType}-${body.entityId}`
    );
    const now = Date.now();
    const metadata: QdbV2ResourceMetadata = {
      service: FORUM_SERVICE,
      publisherName: body.publisherName,
      identifier: envelope.recordId,
      created: now,
      updated: now,
    };
    const validation = validateEntityCreate(metadata, envelope, identity);
    if (validation.ok === false) {
      throw new Error(`[${validation.code}] ${validation.detail}`);
    }
    await requestQortium<unknown>({
      action: 'PUBLISH_QDN_RESOURCE',
      service: FORUM_SERVICE,
      name: body.publisherName,
      identifier: envelope.recordId,
      tags: ['forum', 'qdb-v2', body.entityType],
      data64: encodeBase64Json(envelope),
    });
    return envelope;
  },

  async loadV2AuthorityState(
    identity?: IdentityValidator
  ): Promise<V2RuntimeState> {
    const results = (
      await Promise.all(
        ['topic-', 'thread-', 'post-', 'edit-'].map((family) =>
          searchByPrefix(`${FORUM_IDENTIFIER_PREFIX}v2-${family}`)
        )
      )
    ).flat();
    const records: V2RuntimeRecord[] = [];
    const diagnostics: V2RuntimeState['diagnostics'] = [];
    const walletByName = new Map<string, string | null>();
    if (!identity) {
      await Promise.all(
        [
          ...new Set(results.map((item) => item.name.trim()).filter(Boolean)),
        ].map(async (name) => {
          try {
            walletByName.set(
              name.trim().toLowerCase(),
              await resolveNameWalletAddress(name)
            );
          } catch {
            walletByName.set(name.trim().toLowerCase(), null);
          }
        })
      );
    }
    for (const item of results) {
      if (
        typeof item.service !== 'string' ||
        typeof item.created !== 'number' ||
        (item.updated !== undefined &&
          item.updated !== null &&
          typeof item.updated !== 'number')
      ) {
        diagnostics.push({
          code: 'MISSING_TRUSTED_METADATA',
          identifier: item.identifier,
        });
        continue;
      }
      let payload: unknown;
      try {
        payload = await fetchResource(item.name, item.identifier);
      } catch {
        diagnostics.push({
          code: 'UNAVAILABLE_RESOURCE',
          identifier: item.identifier,
        });
        continue;
      }
      if (!isV2EntityEnvelope(payload)) {
        diagnostics.push({
          code: 'MALFORMED_ENVELOPE',
          identifier: item.identifier,
        });
        continue;
      }
      const metadata: QdbV2ResourceMetadata = {
        service: item.service,
        publisherName: item.name,
        identifier: item.identifier,
        created: item.created,
        updated: item.updated ?? null,
        latestSignature: item.latestSignature,
      };
      records.push(toV2RuntimeRecord(metadata, payload));
    }
    const resolvedIdentity: IdentityValidator = identity ?? {
      validatePublisher: (metadata, claimedPublisher) =>
        metadata.publisherName.trim().toLowerCase() ===
        claimedPublisher.trim().toLowerCase()
          ? { ok: true }
          : {
              ok: false,
              code: 'IDENTITY_UNVERIFIED',
              detail: 'QDN resource publisher does not match V2 claim',
            },
      validateWalletBinding: (publisherName, walletAddress) =>
        walletByName.get(publisherName.trim().toLowerCase())?.trim() ===
        walletAddress.trim()
          ? { ok: true }
          : {
              ok: false,
              code: 'IDENTITY_UNVERIFIED',
              detail: 'current QDN name-to-wallet binding is unavailable',
            },
    };
    const reduced = reduceV2RuntimeRecords(records, resolvedIdentity);
    return {
      authoritative: reduced.authoritative,
      diagnostics: [...diagnostics, ...reduced.diagnostics],
    };
  },

  async loadForumStructure() {
    const endTiming = perfDebugTimeStart('forum-structure-load');
    const [topicResult, subTopicResult] = await Promise.all([
      fetchTopicPayloads(),
      fetchSubTopicPayloads(),
    ]);
    const topicPayloads = topicResult.payloads;
    const subTopicPayloads = subTopicResult.payloads;
    const discoveredResourceCount =
      topicResult.resourceCount + subTopicResult.resourceCount;
    const failedResourceCount =
      topicResult.failedCount + subTopicResult.failedCount;

    if (
      discoveredResourceCount > 0 &&
      failedResourceCount === discoveredResourceCount
    ) {
      throw new Error(
        'Forum QDN resources were found but are not readable yet. This node may still be syncing or building QDN data.'
      );
    }

    const topicMap = mapLatestPayloads(
      topicPayloads,
      (payload) => payload.topic.id
    );
    const subTopicMap = mapLatestPayloads(
      subTopicPayloads,
      (payload) => payload.subTopic.id
    );

    const topics = [...topicMap.values()]
      .filter((payload) => payload.status !== 'deleted')
      .map((payload) => payload.topic)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const subTopics = [...subTopicMap.values()]
      .filter((payload) => payload.status !== 'deleted')
      .map((payload) => payload.subTopic)
      .filter((subTopic) =>
        topics.some((topic) => topic.id === subTopic.topicId)
      );

    const moderated = await this.applyForumModerationState(topics, subTopics);
    const result = {
      topics: moderated.topics,
      subTopics: moderated.subTopics,
      legacy: {
        authorityState: 'UNRESOLVED' as const,
        topicRecords: topicPayloads.filter(
          (payload): payload is TopicPayload => payload !== null
        ),
        subTopicRecords: subTopicPayloads.filter(
          (payload): payload is SubTopicPayload => payload !== null
        ),
        failedResourceCount,
      },
    };
    endTiming({
      topicCount: topics.length,
      subTopicCount: subTopics.length,
    });
    return result;
  },

  async loadForumStructureCached(options?: {
    force?: boolean;
    maxAgeMs?: number;
  }) {
    const force = options?.force === true;
    const maxAgeMs = options?.maxAgeMs ?? FORUM_STRUCTURE_CACHE_TTL_MS;
    const now = Date.now();

    if (
      !force &&
      forumStructureCache.value &&
      now - forumStructureCache.updatedAt <= maxAgeMs &&
      (forumStructureCache.value.topics.length > 0 ||
        forumStructureCache.value.subTopics.length > 0)
    ) {
      return forumStructureCache.value;
    }

    if (!force && forumStructureCache.inflight) {
      return forumStructureCache.inflight;
    }

    const loadPromise = this.loadForumStructure()
      .then((result) => {
        forumStructureCache = {
          value: result,
          updatedAt: Date.now(),
          inflight: null,
        };
        return result;
      })
      .catch((error) => {
        forumStructureCache = {
          ...forumStructureCache,
          inflight: null,
        };
        throw error;
      });

    forumStructureCache = {
      ...forumStructureCache,
      inflight: loadPromise,
    };

    return loadPromise;
  },

  invalidateForumStructureCache() {
    forumStructureCache = {
      value: null,
      updatedAt: 0,
      inflight: null,
    };
  },

  async loadPostsBySubTopic(
    subTopicId: string,
    currentWalletAddress?: string | null
  ) {
    const threadScopedPayloads = await fetchPostPayloadsByPrefix(
      toThreadPostPrefix(subTopicId)
    );
    const postPayloads =
      threadScopedPayloads.length > 0
        ? threadScopedPayloads
        : await fetchPostPayloadsByPrefix(toLegacyPostSearchPrefix());

    const postMap = mapLatestPayloads(
      postPayloads,
      (payload) => payload.post.id
    );
    const posts = [...postMap.values()]
      .filter((payload) => payload.status !== 'deleted')
      .map((payload) => payload.post)
      .filter((post) => post.subTopicId === subTopicId);

    return this.applyPostOperationState(posts, currentWalletAddress);
  },

  async publishTopic(topic: Topic, ownerName?: string) {
    const resolvedOwner = await resolveOwnerName(ownerName);
    const { identifier } = this.buildTopicPublishResource(topic, resolvedOwner);

    await publishPayload(
      resolvedOwner,
      identifier,
      {
        version: 1,
        type: 'topic',
        status: 'active',
        updatedAt: Date.now(),
        topic,
      },
      topic.title,
      topic.description,
      ['forum', 'topic', 'qforum']
    );

    await verifyPublication(resolvedOwner, identifier, 'topic');
  },

  buildTopicPublishResource(topic: Topic, ownerName: string) {
    const identifier = toTopicIdentifier(topic.id);
    const payload: TopicPayload = {
      version: 1,
      type: 'topic',
      status: 'active',
      updatedAt: Date.now(),
      topic,
    };

    return {
      identifier,
      resource: toPublishResource(
        ownerName,
        identifier,
        payload,
        topic.title,
        topic.description,
        ['forum', 'topic', 'qforum']
      ),
    };
  },

  async publishSubTopic(subTopic: SubTopic, ownerName?: string) {
    const resolvedOwner = await resolveOwnerName(ownerName);
    const { identifier } = this.buildSubTopicPublishResource(
      subTopic,
      resolvedOwner
    );

    await publishPayload(
      resolvedOwner,
      identifier,
      {
        version: 1,
        type: 'subtopic',
        status: 'active',
        updatedAt: Date.now(),
        subTopic,
      },
      subTopic.title,
      subTopic.description,
      ['forum', 'subtopic', 'qforum']
    );

    await verifyPublication(resolvedOwner, identifier, 'subtopic');
  },

  buildSubTopicPublishResource(subTopic: SubTopic, ownerName: string) {
    const identifier = toSubTopicIdentifier(subTopic.id);
    const payload: SubTopicPayload = {
      version: 1,
      type: 'subtopic',
      status: 'active',
      updatedAt: Date.now(),
      subTopic,
    };

    return {
      identifier,
      resource: toPublishResource(
        ownerName,
        identifier,
        payload,
        subTopic.title,
        subTopic.description,
        ['forum', 'subtopic', 'qforum']
      ),
    };
  },

  async publishPost(post: Post, ownerName?: string) {
    const resolvedOwner = await resolveOwnerName(ownerName);
    const { identifier } = this.buildPostPublishResource(post, resolvedOwner);

    await publishPayload(
      resolvedOwner,
      identifier,
      {
        version: 1,
        type: 'post',
        status: 'active',
        updatedAt: Date.now(),
        post: toPersistedPost(post),
      },
      `Forum post ${post.id}`,
      'Qortium discussion board post',
      ['forum', 'post', 'qforum']
    );

    await verifyPublication(resolvedOwner, identifier, 'post');
  },

  buildPostPublishResource(post: Post, ownerName: string) {
    const identifier = toPostIdentifier(post);
    const payload: PostPayload = {
      version: 1,
      type: 'post',
      status: 'active',
      updatedAt: Date.now(),
      post: toPersistedPost(post),
    };

    return {
      identifier,
      resource: toPublishResource(
        ownerName,
        identifier,
        payload,
        `Forum post ${post.id}`,
        'Qortium discussion board post',
        ['forum', 'post', 'qforum']
      ),
    };
  },

  async deletePost() {
    throw new Error(
      '[MODERATION_LEGACY_TARGET_BLOCKED] legacy full-snapshot deletion is disabled; use an owner tombstone or V2 moderation removal'
    );
  },

  async publishPostImage(
    file: File,
    ownerName?: string
  ): Promise<ForumPostImageReference> {
    const resolvedOwner = await resolveOwnerName(ownerName);
    const imageId = generateForumEntityId('image', resolvedOwner);
    const identifier = toImageIdentifier(imageId);
    assertIdentifierLength(identifier);

    await requestQortium<unknown>(
      {
        action: 'PUBLISH_QDN_RESOURCE',
        service: FORUM_IMAGE_SERVICE,
        name: resolvedOwner,
        identifier,
        filename: file.name,
        data64: await fileToBase64(file),
      },
      {
        timeoutMs: IMAGE_PUBLISH_TIMEOUT_MS,
      }
    );

    return {
      service: FORUM_IMAGE_SERVICE,
      name: resolvedOwner,
      identifier,
      filename: file.name,
    };
  },

  async publishPostAttachment(
    file: File,
    ownerName?: string
  ): Promise<ForumPostAttachmentReference> {
    const resolvedOwner = await resolveOwnerName(ownerName);
    const attachmentId = generateForumEntityId('attachment', resolvedOwner);
    const identifier = toAttachmentIdentifier(attachmentId);
    assertIdentifierLength(identifier);

    await requestQortium<unknown>(
      {
        action: 'PUBLISH_QDN_RESOURCE',
        service: 'FILE',
        name: resolvedOwner,
        identifier,
        filename: file.name,
        data64: await fileToBase64(file),
      },
      {
        timeoutMs: IMAGE_PUBLISH_TIMEOUT_MS,
      }
    );

    return {
      service: 'FILE',
      name: resolvedOwner,
      identifier,
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
    };
  },

  async publishPostVideo(
    file: File,
    ownerName?: string
  ): Promise<ForumPostVideoReference> {
    const resolvedOwner = await resolveOwnerName(ownerName);
    const videoId = generateForumEntityId('video', resolvedOwner);
    const identifier = toVideoIdentifier(videoId);
    assertIdentifierLength(identifier);

    await requestQortium<unknown>(
      {
        action: 'PUBLISH_QDN_RESOURCE',
        service: 'VIDEO',
        name: resolvedOwner,
        identifier,
        filename: file.name,
        data64: await fileToBase64(file),
      },
      {
        timeoutMs: IMAGE_PUBLISH_TIMEOUT_MS,
      }
    );

    return {
      service: 'VIDEO',
      name: resolvedOwner,
      identifier,
      filename: file.name,
      mimeType: file.type || 'video/mp4',
      size: file.size,
    };
  },

  async getQdnResourceUrl(reference: {
    service: string;
    name: string;
    identifier: string;
    filename?: string;
  }): Promise<string> {
    const cacheKey = `${reference.service}:${reference.name}:${reference.identifier}:${reference.filename ?? ''}`;
    const cached = imageUrlCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      await ensureQdnResourceReady(
        reference.service,
        reference.name,
        reference.identifier
      );
    } catch {
      // Continue with direct URL fetch when readiness polling fails.
    }

    const resourceUrl = await requestQortium<string>({
      action: 'GET_QDN_RESOURCE_URL',
      service: reference.service,
      name: reference.name,
      identifier: reference.identifier,
      path: reference.filename?.trim() || undefined,
    });
    imageUrlCache.set(cacheKey, resourceUrl);
    return resourceUrl;
  },

  async getPostImageResourceUrl(reference: {
    service: string;
    name: string;
    identifier: string;
    filename?: string;
  }): Promise<string> {
    return this.getQdnResourceUrl(reference);
  },
};
