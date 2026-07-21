import { applyOwnerEdit, reduceV2Creates, type V2State } from './reducer.js';
import type {
  PostCreate,
  QdbV2CreateEnvelope,
  QdbV2ResourceMetadata,
  ThreadCreate,
  TopicCreate,
  V2EntityCreate,
  OwnerEdit,
  V2OwnerEditEnvelope,
  RejectionCode,
} from './types.js';
import type { IdentityValidator } from './validation.js';
import { validateEntityCreate, validateMetadata } from './validation.js';
import { isNativePollReference } from './polls.js';
import { isV2AttachmentReferenceList } from './fieldPolicy.js';

export type V2CreateRuntimeRecord = {
  metadata: QdbV2ResourceMetadata;
  envelope: QdbV2CreateEnvelope<V2EntityCreate>;
};

export type V2OwnerEditRuntimeRecord = {
  metadata: QdbV2ResourceMetadata;
  envelope: V2OwnerEditEnvelope;
};

export type V2RuntimeRecord = V2CreateRuntimeRecord | V2OwnerEditRuntimeRecord;

export const isV2CreateRuntimeRecord = (
  record: V2RuntimeRecord
): record is V2CreateRuntimeRecord => record.envelope.kind === 'entity-create';

export const isV2OwnerEditRuntimeRecord = (
  record: V2RuntimeRecord
): record is V2OwnerEditRuntimeRecord => record.envelope.kind === 'operation';

export const toV2RuntimeRecord = (
  metadata: QdbV2ResourceMetadata,
  envelope: QdbV2CreateEnvelope<V2EntityCreate> | V2OwnerEditEnvelope
): V2RuntimeRecord =>
  envelope.kind === 'entity-create'
    ? { metadata, envelope }
    : { metadata, envelope };

export type V2RuntimeDiagnostics = {
  code:
    | RejectionCode
    | 'UNAVAILABLE_RESOURCE'
    | 'MISSING_TRUSTED_METADATA'
    | 'PAGINATION_INCOMPLETE'
    | 'PAGINATION_BUDGET_REACHED'
    | 'PAGINATION_LOOP_DETECTED'
    | 'PAGINATION_REQUEST_FAILED'
    | 'DUPLICATE_RESOURCE'
    | 'PARTIAL_DISCOVERY'
    | 'NAMESPACE_BUDGET_PRESSURE'
    | 'AUTHORITATIVE_RESOURCE_UNAVAILABLE'
    | 'CACHED_LAST_KNOWN_GOOD';
  identifier: string;
  detail?: string;
};

export type V2RuntimeState = {
  authoritative: V2State;
  diagnostics: V2RuntimeDiagnostics[];
  discovery: {
    completeness: 'complete' | 'partial' | 'unavailable';
    pagesFetched: number;
    resourcesSeen: number;
    stoppedReason: string;
    source: 'network' | 'cache' | 'provided-record-set';
  };
};

export const buildV2OwnerEditEnvelope = (
  edit: OwnerEdit,
  operationId: string,
  clientCreatedAt = new Date().toISOString()
): V2OwnerEditEnvelope => ({
  schema: 'qdb-v2',
  schemaVersion: 2,
  kind: 'operation',
  recordType: 'owner-edit',
  recordId: operationId,
  targetId: edit.targetId,
  body: edit,
  clientCreatedAt,
});

export const V2_IDENTIFIER_PREFIX = 'qdbm-v2-';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isEntityType = (value: unknown): value is V2EntityCreate['entityType'] =>
  value === 'topic' || value === 'thread' || value === 'post';

export const isV2EntityEnvelope = (
  value: unknown
): value is QdbV2CreateEnvelope<V2EntityCreate> | V2OwnerEditEnvelope => {
  if (!isRecord(value)) return false;
  const candidate = value;
  const body = candidate.body;
  if (
    candidate.schema !== 'qdb-v2' ||
    candidate.schemaVersion !== 2 ||
    typeof candidate.recordType !== 'string' ||
    typeof candidate.recordId !== 'string' ||
    typeof candidate.targetId !== 'string' ||
    !isRecord(body)
  )
    return false;
  if (candidate.kind === 'entity-create') {
    if (
      !isEntityType(body.entityType) ||
      body.entityType !== candidate.recordType ||
      body.entityId !== candidate.targetId ||
      typeof body.publisherName !== 'string' ||
      typeof body.walletAddress !== 'string'
    )
      return false;
    if (body.entityType === 'topic')
      return (
        typeof body.title === 'string' && typeof body.description === 'string'
      );
    if (body.entityType === 'thread')
      return (
        typeof body.parentTopicId === 'string' &&
        typeof body.title === 'string' &&
        typeof body.description === 'string'
      );
    return (
      typeof body.parentThreadId === 'string' &&
      (typeof body.parentPostId === 'string' || body.parentPostId === null) &&
      typeof body.content === 'string' &&
      (body.attachments === undefined ||
        isV2AttachmentReferenceList(body.attachments)) &&
      (body.pollReference === undefined ||
        body.pollReference === null ||
        isNativePollReference(body.pollReference))
    );
  }
  if (candidate.kind === 'operation') {
    return (
      candidate.recordType === 'owner-edit' &&
      body.operation === 'owner-edit' &&
      body.targetId === candidate.targetId &&
      isEntityType(body.targetType) &&
      typeof body.publisherName === 'string' &&
      typeof body.walletAddress === 'string' &&
      isRecord(body.changes)
    );
  }
  return false;
};

export const buildV2Envelope = <T extends V2EntityCreate>(
  body: T,
  recordId: string,
  clientCreatedAt = new Date().toISOString()
): QdbV2CreateEnvelope<T> => ({
  schema: 'qdb-v2',
  schemaVersion: 2,
  kind: 'entity-create',
  recordType: body.entityType,
  recordId,
  targetId: body.entityId,
  body,
  clientCreatedAt,
});

export const buildV2TopicEnvelope = (body: TopicCreate) =>
  buildV2Envelope(body, `${V2_IDENTIFIER_PREFIX}topic-${body.entityId}`);
export const buildV2ThreadEnvelope = (body: ThreadCreate) =>
  buildV2Envelope(body, `${V2_IDENTIFIER_PREFIX}thread-${body.entityId}`);
export const buildV2PostEnvelope = (body: PostCreate) =>
  buildV2Envelope(body, `${V2_IDENTIFIER_PREFIX}post-${body.entityId}`);

export const reduceV2RuntimeRecords = (
  records: V2RuntimeRecord[],
  identity: IdentityValidator
): V2RuntimeState => {
  const diagnostics: V2RuntimeDiagnostics[] = [];
  const creates: V2CreateRuntimeRecord[] = [];
  const operations: V2OwnerEditRuntimeRecord[] = [];
  for (const record of records) {
    if (isV2OwnerEditRuntimeRecord(record)) {
      const metadataValidation = validateMetadata(record.metadata);
      if (metadataValidation.ok === false) {
        diagnostics.push({
          code: metadataValidation.code,
          identifier: record.metadata.identifier,
          detail: metadataValidation.detail,
        });
        continue;
      }
      operations.push(record);
      continue;
    }
    const validation = validateEntityCreate(
      record.metadata,
      record.envelope,
      identity
    );
    if (validation.ok === false) {
      diagnostics.push({
        code: validation.code,
        identifier: record.metadata.identifier,
        detail: validation.detail,
      });
      continue;
    }
    creates.push(record);
  }
  let authoritative = reduceV2Creates(creates, identity);
  for (const record of [...operations].sort((a, b) => {
    if (a.metadata.created !== b.metadata.created)
      return a.metadata.created - b.metadata.created;
    const signatureOrder = (a.metadata.latestSignature ?? '').localeCompare(
      b.metadata.latestSignature ?? ''
    );
    return (
      signatureOrder ||
      a.metadata.identifier.localeCompare(b.metadata.identifier)
    );
  })) {
    const before = authoritative.quarantined.length;
    authoritative = applyOwnerEdit(
      authoritative,
      record.metadata,
      record.envelope.body,
      identity
    );
    if (
      authoritative.quarantined.length === before &&
      !authoritative.entities[record.envelope.targetId]
    ) {
      diagnostics.push({
        code: 'UNAUTHORIZED_PUBLISHER',
        identifier: record.metadata.identifier,
        detail: 'owner edit target is not authoritative',
      });
    }
  }
  return {
    authoritative,
    diagnostics: [
      ...diagnostics,
      ...authoritative.quarantined.map((record) => ({
        code: record.code,
        identifier: record.recordId,
        detail: record.detail,
      })),
    ],
    discovery: {
      completeness: 'complete',
      pagesFetched: 0,
      resourcesSeen: records.length,
      stoppedReason: 'provided-record-set',
      source: 'provided-record-set',
    },
  };
};
