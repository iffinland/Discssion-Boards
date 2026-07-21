import { toPartitionKey } from '../forum/forumId.js';
import type { V2State } from './reducer.js';
import type {
  QdbV2ResourceMetadata,
  V2EntityCreate,
  V2EntityType,
} from './types.js';

export type V2IndexDiagnosticCode =
  | 'INVALID_INDEX_ENTRY'
  | 'STALE_INDEX_ENTRY'
  | 'INDEX_TARGET_UNAVAILABLE'
  | 'INDEX_AUTHORITY_MISMATCH'
  | 'INVALID_PARENT_RELATION'
  | 'DUPLICATE_RESOURCE'
  | 'CACHED_LAST_KNOWN_GOOD'
  | 'AUTHORITATIVE_RESOURCE_UNAVAILABLE'
  | 'PAGINATION_INCOMPLETE'
  | 'PAGINATION_BUDGET_REACHED'
  | 'PAGINATION_LOOP_DETECTED'
  | 'PAGINATION_REQUEST_FAILED'
  | 'PARTIAL_DISCOVERY'
  | 'NAMESPACE_BUDGET_PRESSURE';

export type V2IndexDiagnostic = {
  code: V2IndexDiagnosticCode;
  identifier: string;
  detail: string;
};

export type V2IndexFragmentBody = {
  entityType: V2EntityType;
  entityId: string;
  parentId: string | null;
  authority: {
    publisherName: string;
    identifier: string;
  };
  hint: {
    title?: string;
    excerpt?: string;
  };
};

export type V2IndexFragmentEnvelope = {
  schema: 'qdb-v2-index';
  schemaVersion: 1;
  kind: 'derived-index-fragment';
  recordType: 'entity-locator';
  recordId: string;
  targetId: string;
  body: V2IndexFragmentBody;
};

export type V2IndexFragmentRecord = {
  metadata: QdbV2ResourceMetadata;
  envelope: V2IndexFragmentEnvelope;
};

export type V2IndexTargetAvailability =
  | 'available'
  | 'unavailable'
  | 'tombstoned'
  | 'invalid';

export type ValidatedV2IndexEntry = {
  entity: V2EntityCreate;
  fragment: V2IndexFragmentEnvelope;
  metadata: QdbV2ResourceMetadata;
  freshness: 'current' | 'stale';
};

export type ReducedV2Index = {
  entries: ValidatedV2IndexEntry[];
  diagnostics: V2IndexDiagnostic[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

const isEntityType = (value: unknown): value is V2EntityType =>
  value === 'topic' || value === 'thread' || value === 'post';

const isSafeEntityId = (entityType: V2EntityType, value: string) => {
  if (!/^[a-z0-9_]{3,48}$/.test(value)) return false;
  if (entityType === 'topic') return value.startsWith('topic_');
  if (entityType === 'thread') return value.startsWith('subtopic_');
  return value.startsWith('post_');
};

export const isV2IndexFragmentEnvelope = (
  value: unknown
): value is V2IndexFragmentEnvelope => {
  if (!isRecord(value) || !isRecord(value.body)) return false;
  const body = value.body;
  if (!isRecord(body.authority) || !isRecord(body.hint)) return false;
  return (
    hasOnlyKeys(value, [
      'schema',
      'schemaVersion',
      'kind',
      'recordType',
      'recordId',
      'targetId',
      'body',
    ]) &&
    value.schema === 'qdb-v2-index' &&
    value.schemaVersion === 1 &&
    value.kind === 'derived-index-fragment' &&
    value.recordType === 'entity-locator' &&
    typeof value.recordId === 'string' &&
    typeof value.targetId === 'string' &&
    hasOnlyKeys(body, [
      'entityType',
      'entityId',
      'parentId',
      'authority',
      'hint',
    ]) &&
    isEntityType(body.entityType) &&
    typeof body.entityId === 'string' &&
    isSafeEntityId(body.entityType, body.entityId) &&
    body.entityId === value.targetId &&
    (typeof body.parentId === 'string' || body.parentId === null) &&
    hasOnlyKeys(body.authority, ['publisherName', 'identifier']) &&
    typeof body.authority.publisherName === 'string' &&
    typeof body.authority.identifier === 'string' &&
    hasOnlyKeys(body.hint, ['title', 'excerpt']) &&
    (body.hint.title === undefined || typeof body.hint.title === 'string') &&
    (body.hint.excerpt === undefined || typeof body.hint.excerpt === 'string')
  );
};

const typeCode: Record<V2EntityType, string> = {
  topic: 't',
  thread: 'h',
  post: 'p',
};

export const buildV2IndexFragmentPrefix = (
  namespace: string,
  entityType: V2EntityType
) => `${namespace}-v2-idx-${typeCode[entityType]}-`;

const stableEntityKey = (entityId: string) =>
  `${toPartitionKey(entityId, 7)}${toPartitionKey(
    [...entityId].reverse().join(''),
    7
  )}`;

export const buildV2IndexFragmentIdentifier = (
  namespace: string,
  entityType: V2EntityType,
  entityId: string,
  parentId: string | null
) =>
  `${buildV2IndexFragmentPrefix(namespace, entityType)}${toPartitionKey(
    parentId ?? entityId,
    8
  )}-${stableEntityKey(entityId)}`;

const parentIdOf = (entity: V2EntityCreate): string | null => {
  if (entity.entityType === 'topic') return null;
  if (entity.entityType === 'thread') return entity.parentTopicId;
  return entity.parentThreadId;
};

const expectedAuthorityIdentifier = (
  namespace: string,
  entity: V2EntityCreate
) => `${namespace}-v2-${entity.entityType}-${entity.entityId}`;

const hintFor = (entity: V2EntityCreate): V2IndexFragmentBody['hint'] => {
  if (entity.entityType === 'topic' || entity.entityType === 'thread')
    return { title: entity.title.slice(0, 240) };
  return { excerpt: entity.content.slice(0, 500) };
};

export const buildV2IndexFragmentEnvelope = (
  namespace: string,
  entity: V2EntityCreate
): V2IndexFragmentEnvelope => {
  const parentId = parentIdOf(entity);
  const recordId = buildV2IndexFragmentIdentifier(
    namespace,
    entity.entityType,
    entity.entityId,
    parentId
  );
  return {
    schema: 'qdb-v2-index',
    schemaVersion: 1,
    kind: 'derived-index-fragment',
    recordType: 'entity-locator',
    recordId,
    targetId: entity.entityId,
    body: {
      entityType: entity.entityType,
      entityId: entity.entityId,
      parentId,
      authority: {
        publisherName: entity.publisherName,
        identifier: expectedAuthorityIdentifier(namespace, entity),
      },
      hint: hintFor(entity),
    },
  };
};

const trustedOrder = (metadata: QdbV2ResourceMetadata) =>
  [
    metadata.updated ?? metadata.created,
    metadata.latestSignature ?? '',
    metadata.publisherName.trim().toLowerCase(),
    metadata.identifier,
  ] as const;

const compareTrusted = (
  left: QdbV2ResourceMetadata,
  right: QdbV2ResourceMetadata
) => {
  const [leftTime, leftSignature, leftPublisher, leftIdentifier] =
    trustedOrder(left);
  const [rightTime, rightSignature, rightPublisher, rightIdentifier] =
    trustedOrder(right);
  return (
    leftTime - rightTime ||
    leftSignature.localeCompare(rightSignature) ||
    leftPublisher.localeCompare(rightPublisher) ||
    leftIdentifier.localeCompare(rightIdentifier)
  );
};

const hintIsCurrent = (
  hint: V2IndexFragmentBody['hint'],
  entity: V2EntityCreate
) => {
  const expected = hintFor(entity);
  return hint.title === expected.title && hint.excerpt === expected.excerpt;
};

export const reduceV2IndexFragments = (
  namespace: string,
  records: V2IndexFragmentRecord[],
  authority: V2State,
  availability: Record<string, V2IndexTargetAvailability> = {}
): ReducedV2Index => {
  const diagnostics: V2IndexDiagnostic[] = [];
  const selected = new Map<string, V2IndexFragmentRecord>();
  for (const record of [...records].sort((left, right) =>
    compareTrusted(left.metadata, right.metadata)
  )) {
    const fragment = record.envelope;
    if (!isV2IndexFragmentEnvelope(fragment)) {
      diagnostics.push({
        code: 'INVALID_INDEX_ENTRY',
        identifier: record.metadata.identifier,
        detail: 'index fragment does not satisfy the strict schema',
      });
      continue;
    }
    const expectedRecordId = buildV2IndexFragmentIdentifier(
      namespace,
      fragment.body.entityType,
      fragment.body.entityId,
      fragment.body.parentId
    );
    if (
      record.metadata.identifier !== fragment.recordId ||
      fragment.recordId !== expectedRecordId
    ) {
      diagnostics.push({
        code: 'INVALID_INDEX_ENTRY',
        identifier: record.metadata.identifier,
        detail: 'index fragment identifier does not match its target partition',
      });
      continue;
    }
    const targetState = availability[fragment.targetId];
    if (targetState === 'unavailable') {
      diagnostics.push({
        code: 'INDEX_TARGET_UNAVAILABLE',
        identifier: record.metadata.identifier,
        detail: 'index target is unavailable and remains a locator only',
      });
      continue;
    }
    if (targetState === 'tombstoned') {
      diagnostics.push({
        code: 'STALE_INDEX_ENTRY',
        identifier: record.metadata.identifier,
        detail: 'index target is tombstoned and is excluded',
      });
      continue;
    }
    const entity = authority.entities[fragment.targetId];
    if (!entity || targetState === 'invalid') {
      diagnostics.push({
        code: 'INVALID_INDEX_ENTRY',
        identifier: record.metadata.identifier,
        detail: 'index target has no accepted authoritative V2 entity',
      });
      continue;
    }
    if (
      entity.entityType !== fragment.body.entityType ||
      record.metadata.publisherName.trim().toLowerCase() !==
        entity.publisherName.trim().toLowerCase() ||
      fragment.body.authority.publisherName.trim().toLowerCase() !==
        entity.publisherName.trim().toLowerCase() ||
      fragment.body.authority.identifier !==
        expectedAuthorityIdentifier(namespace, entity)
    ) {
      diagnostics.push({
        code: 'INDEX_AUTHORITY_MISMATCH',
        identifier: record.metadata.identifier,
        detail:
          'index resource publisher or authority locator disagrees with accepted V2 authority',
      });
      continue;
    }
    if (fragment.body.parentId !== parentIdOf(entity)) {
      diagnostics.push({
        code: 'INVALID_PARENT_RELATION',
        identifier: record.metadata.identifier,
        detail: 'index parent relation disagrees with accepted V2 authority',
      });
      continue;
    }
    const existing = selected.get(fragment.targetId);
    if (existing)
      diagnostics.push({
        code: 'DUPLICATE_RESOURCE',
        identifier: record.metadata.identifier,
        detail: 'a newer trusted index fragment supersedes this target entry',
      });
    selected.set(fragment.targetId, record);
  }

  const entries: ValidatedV2IndexEntry[] = [];
  for (const targetId of [...selected.keys()].sort()) {
    const record = selected.get(targetId);
    if (!record) continue;
    const fragment = record.envelope;
    const entity = authority.entities[targetId];
    if (!entity) continue;
    const freshness = hintIsCurrent(fragment.body.hint, entity)
      ? 'current'
      : 'stale';
    if (freshness === 'stale')
      diagnostics.push({
        code: 'STALE_INDEX_ENTRY',
        identifier: record.metadata.identifier,
        detail: 'index hint is stale; authoritative entity content is used',
      });
    entries.push({ entity, fragment, metadata: record.metadata, freshness });
  }
  return { entries, diagnostics };
};

export const searchValidatedV2Index = (
  entries: ValidatedV2IndexEntry[],
  query: string
) => {
  const normalized = query.trim().toLowerCase();
  if (!normalized)
    return [...entries].sort((left, right) =>
      left.entity.entityId.localeCompare(right.entity.entityId)
    );
  return entries
    .filter(({ entity }) => {
      const text =
        entity.entityType === 'post'
          ? entity.content
          : `${entity.title} ${entity.description}`;
      return text.toLowerCase().includes(normalized);
    })
    .sort((left, right) =>
      left.entity.entityId.localeCompare(right.entity.entityId)
    );
};

export type LastKnownGoodResult<T> =
  | {
      availability: 'verified-current';
      value: T;
      diagnostics: V2IndexDiagnostic[];
    }
  | {
      availability: 'cached-last-known-good';
      value: T;
      diagnostics: V2IndexDiagnostic[];
    }
  | {
      availability: 'index-only';
      value: null;
      diagnostics: V2IndexDiagnostic[];
    }
  | {
      availability: 'unavailable';
      value: null;
      diagnostics: V2IndexDiagnostic[];
    };

export const resolveLastKnownGood = <T>(input: {
  current?: T | null;
  cached?: T | null;
  hasIndexHint?: boolean;
  authorityUnavailable?: boolean;
}): LastKnownGoodResult<T> => {
  if (input.current !== undefined && input.current !== null)
    return {
      availability: 'verified-current',
      value: input.current,
      diagnostics: [],
    };
  if (input.cached !== undefined && input.cached !== null)
    return {
      availability: 'cached-last-known-good',
      value: input.cached,
      diagnostics: [
        {
          code: 'CACHED_LAST_KNOWN_GOOD',
          identifier: '<cache>',
          detail: 'authoritative refresh failed; cached data is read-only',
        },
      ],
    };
  if (input.hasIndexHint)
    return {
      availability: 'index-only',
      value: null,
      diagnostics: [
        {
          code: 'INDEX_TARGET_UNAVAILABLE',
          identifier: '<index>',
          detail:
            'an index locator exists but authoritative data is unavailable',
        },
      ],
    };
  return {
    availability: 'unavailable',
    value: null,
    diagnostics: input.authorityUnavailable
      ? [
          {
            code: 'AUTHORITATIVE_RESOURCE_UNAVAILABLE',
            identifier: '<authority>',
            detail: 'authoritative resource is unavailable',
          },
        ]
      : [],
  };
};
