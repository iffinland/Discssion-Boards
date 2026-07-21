export type V2EntityType = 'topic' | 'thread' | 'post';
export type LegacyAuthorityState = 'APPROVED' | 'UNRESOLVED' | 'QUARANTINED';

export type QdbV2ResourceMetadata = {
  service: string;
  publisherName: string;
  identifier: string;
  created: number;
  updated: number;
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

export type V2Identity = { publisherName: string; walletAddress: string };
export type TopicCreate = V2Identity & { entityType: 'topic'; entityId: string; title: string; description: string };
export type ThreadCreate = V2Identity & { entityType: 'thread'; entityId: string; parentTopicId: string; title: string; description: string };
export type PostCreate = V2Identity & { entityType: 'post'; entityId: string; parentThreadId: string; parentPostId: string | null; content: string };
export type V2EntityCreate = TopicCreate | ThreadCreate | PostCreate;

export type OwnerEdit = {
  operation: 'owner-edit';
  targetType: V2EntityType;
  targetId: string;
  changes: Record<string, unknown>;
};

export type RejectionCode =
  | 'MALFORMED_ENVELOPE'
  | 'INVALID_METADATA'
  | 'IDENTITY_UNVERIFIED'
  | 'LEGACY_AUTHORITY_BLOCKED'
  | 'UNAUTHORIZED_PUBLISHER'
  | 'FORBIDDEN_FIELD'
  | 'DUPLICATE_CONFLICT'
  | 'V2_OVERRIDES_LEGACY';

export type QuarantineRecord = { code: RejectionCode; recordId: string; detail: string };

