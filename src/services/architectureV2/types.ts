export type V2EntityType = 'topic' | 'thread' | 'post';
export type LegacyAuthorityState = 'APPROVED' | 'UNRESOLVED' | 'QUARANTINED';

export type QdbV2ResourceMetadata = {
  service: string;
  publisherName: string;
  identifier: string;
  created: number;
  updated: number | null;
  latestSignature?: string;
};

export type QdbV2Envelope<TBody> = {
  schema: 'qdb-v2';
  schemaVersion: 2;
  kind: 'entity-create' | 'operation';
  recordType: string;
  recordId: string;
  targetId: string;
  body: TBody;
  clientCreatedAt?: string;
};
export type QdbV2CreateEnvelope<TBody> = Omit<QdbV2Envelope<TBody>, 'kind'> & {
  kind: 'entity-create';
};
export type QdbV2OperationEnvelope<TBody> = Omit<
  QdbV2Envelope<TBody>,
  'kind'
> & { kind: 'operation' };

export type V2Identity = { publisherName: string; walletAddress: string };
export type NativePollSelectionMode = 'single' | 'multiple';
export type NativePollReference = {
  kind: 'native';
  schema: 'qdb-native-poll';
  schemaVersion: 1;
  pollId: number;
  pollName: string;
  creatorName: string;
  creatorAddress: string;
  creationSignature: string;
  provenance: 'qortium-core';
  status: 'confirmed';
  displayCache: {
    question: string;
    description: string;
    selectionMode: NativePollSelectionMode;
    options: Array<{ index: number; label: string }>;
    startsAt: string | null;
    closesAt: string | null;
  };
};

export type NativePollRecovery = {
  schema: 'qdb-native-poll-recovery';
  schemaVersion: 1;
  postId: string;
  pollName: string;
  creatorName: string;
  creatorAddress: string;
  creationSignature: string;
  pollId: number | null;
  definition: NativePollReference['displayCache'];
};

export type TopicCreate = V2Identity & {
  entityType: 'topic';
  entityId: string;
  title: string;
  description: string;
};
export type ThreadCreate = V2Identity & {
  entityType: 'thread';
  entityId: string;
  parentTopicId: string;
  title: string;
  description: string;
};
export type V2AttachmentReference = {
  id: string;
  service: string;
  name: string;
  identifier: string;
  filename: string;
  mimeType: string;
  size: number;
};
export type PostCreate = V2Identity & {
  entityType: 'post';
  entityId: string;
  parentThreadId: string;
  parentPostId: string | null;
  content: string;
  attachments?: V2AttachmentReference[];
  pollReference?: NativePollReference | null;
};
export type V2EntityCreate = TopicCreate | ThreadCreate | PostCreate;

export type OwnerEdit = {
  operation: 'owner-edit';
  targetType: V2EntityType;
  targetId: string;
  publisherName: string;
  walletAddress: string;
  changes: Record<string, unknown>;
};

export type V2OwnerEditEnvelope = QdbV2OperationEnvelope<OwnerEdit>;

export type RejectionCode =
  | 'MALFORMED_ENVELOPE'
  | 'INVALID_METADATA'
  | 'IDENTITY_UNVERIFIED'
  | 'LEGACY_AUTHORITY_BLOCKED'
  | 'UNAUTHORIZED_PUBLISHER'
  | 'FORBIDDEN_FIELD'
  | 'DUPLICATE_CONFLICT'
  | 'V2_OVERRIDES_LEGACY';

export type QuarantineRecord = {
  code: RejectionCode;
  recordId: string;
  detail: string;
};
