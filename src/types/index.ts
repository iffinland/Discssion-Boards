export type UserRole =
  | 'SysOp'
  | 'SuperAdmin'
  | 'Admin'
  | 'Moderator'
  | 'Member';
export type TopicStatus = 'open' | 'locked';
export type TopicVisibility = 'visible' | 'hidden';
export type TopicAccess = 'everyone' | 'moderators' | 'admins' | 'custom';
export type SubTopicStatus = 'open' | 'locked';
export type SubTopicVisibility = 'visible' | 'hidden';
export type PostPollMode = 'single' | 'multiple';
export type ForumDataAvailability =
  | 'verified-current'
  | 'partial'
  | 'cached-last-known-good'
  | 'index-only'
  | 'unavailable';
export type ForumDataProvenance =
  | 'authoritative-qdn'
  | 'legacy-v1'
  | 'legacy-index'
  | 'v2-index-fragment'
  | 'local-cache';

export interface PostAttachment {
  id: string;
  service: string;
  name: string;
  identifier: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface PostPollOption {
  id: string;
  label: string;
}

export interface PostPollVote {
  voterId: string;
  optionIds: string[];
  votedAt: string;
}

export interface PostPoll {
  kind?: 'legacy';
  id: string;
  question: string;
  description: string;
  mode: PostPollMode;
  options: PostPollOption[];
  votes: PostPollVote[];
  closesAt: string | null;
  closedAt: string | null;
  closedByUserId: string | null;
}

export type NativePostPoll =
  import('../services/architectureV2/polls').NativePostPoll;

export interface User {
  id: string;
  username: string;
  displayName: string;
  address?: string | null;
  avatarUrl?: string | null;
  role: UserRole;
  avatarColor: string;
  joinedAt: string;
}

export interface Topic {
  id: string;
  title: string;
  description: string;
  createdByUserId: string;
  createdAt: string;
  sortOrder: number;
  status: TopicStatus;
  visibility: TopicVisibility;
  subTopicAccess: TopicAccess;
  allowedAddresses: string[];
  dataAvailability?: ForumDataAvailability;
  dataProvenance?: ForumDataProvenance;
}

export interface SubTopic {
  id: string;
  topicId: string;
  title: string;
  description: string;
  authorUserId: string;
  createdAt: string;
  lastPostAt: string;
  lastPostAuthorUserId: string;
  isPinned: boolean;
  pinnedAt: string | null;
  isSolved: boolean;
  solvedAt: string | null;
  solvedByUserId: string | null;
  isPoll: boolean;
  access: TopicAccess;
  allowedAddresses: string[];
  status: SubTopicStatus;
  visibility: SubTopicVisibility;
  lastModerationAction?: string | null;
  lastModerationReason?: string | null;
  lastModeratedByUserId?: string | null;
  lastModeratedAt?: string | null;
  moderationOrder?: number | null;
  dataAvailability?: ForumDataAvailability;
  dataProvenance?: ForumDataProvenance;
}

export interface Post {
  id: string;
  subTopicId: string;
  authorUserId: string;
  parentPostId: string | null;
  content: string;
  attachments: PostAttachment[];
  poll?: PostPoll | NativePostPoll | null;
  createdAt: string;
  updatedAt?: string | null;
  editedAt?: string | null;
  isPinned?: boolean;
  pinnedAt?: string | null;
  pinnedByUserId?: string | null;
  likes: number;
  tips: number;
  tipSummary?: {
    status: 'verified' | 'unavailable';
    verifiedCount: number;
    verifiedTotalQort: string;
    legacyCount: number;
    legacyIsUnverified: true;
    diagnostics: Array<{ code: string; detail: string }>;
  };
  likedByAddresses: string[];
  moderationHidden?: boolean;
  moderationRemoved?: boolean;
  dataAvailability?: ForumDataAvailability;
  dataProvenance?: ForumDataProvenance;
}

export interface ForumRoleRegistry {
  primarySysOpAddress: string;
  sysOps: string[];
  admins: string[];
  moderators: string[];
  updatedAt: number | null;
}
