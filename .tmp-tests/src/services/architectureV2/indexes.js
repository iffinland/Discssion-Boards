import { toPartitionKey } from '../forum/forumId.js';
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value, allowed) => Object.keys(value).every((key) => allowed.includes(key));
const isEntityType = (value) => value === 'topic' || value === 'thread' || value === 'post';
const isSafeEntityId = (entityType, value) => {
    if (!/^[a-z0-9_]{3,48}$/.test(value))
        return false;
    if (entityType === 'topic')
        return value.startsWith('topic_');
    if (entityType === 'thread')
        return value.startsWith('subtopic_');
    return value.startsWith('post_');
};
export const isV2IndexFragmentEnvelope = (value) => {
    if (!isRecord(value) || !isRecord(value.body))
        return false;
    const body = value.body;
    if (!isRecord(body.authority) || !isRecord(body.hint))
        return false;
    return (hasOnlyKeys(value, [
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
        (body.hint.excerpt === undefined || typeof body.hint.excerpt === 'string'));
};
const typeCode = {
    topic: 't',
    thread: 'h',
    post: 'p',
};
export const buildV2IndexFragmentPrefix = (namespace, entityType) => `${namespace}-v2-idx-${typeCode[entityType]}-`;
const stableEntityKey = (entityId) => `${toPartitionKey(entityId, 7)}${toPartitionKey([...entityId].reverse().join(''), 7)}`;
export const buildV2IndexFragmentIdentifier = (namespace, entityType, entityId, parentId) => `${buildV2IndexFragmentPrefix(namespace, entityType)}${toPartitionKey(parentId ?? entityId, 8)}-${stableEntityKey(entityId)}`;
const parentIdOf = (entity) => {
    if (entity.entityType === 'topic')
        return null;
    if (entity.entityType === 'thread')
        return entity.parentTopicId;
    return entity.parentThreadId;
};
const expectedAuthorityIdentifier = (namespace, entity) => `${namespace}-v2-${entity.entityType}-${entity.entityId}`;
const hintFor = (entity, disclosure = 'content-hint') => {
    if (disclosure === 'locator-only')
        return {};
    if (entity.entityType === 'topic' || entity.entityType === 'thread')
        return { title: entity.title.slice(0, 240) };
    return { excerpt: entity.content.slice(0, 500) };
};
export const buildV2IndexFragmentEnvelope = (namespace, entity, disclosure = 'content-hint') => {
    const parentId = parentIdOf(entity);
    const recordId = buildV2IndexFragmentIdentifier(namespace, entity.entityType, entity.entityId, parentId);
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
            hint: hintFor(entity, disclosure),
        },
    };
};
const trustedOrder = (metadata) => [
    metadata.updated ?? metadata.created,
    metadata.latestSignature ?? '',
    metadata.publisherName.trim().toLowerCase(),
    metadata.identifier,
];
const compareTrusted = (left, right) => {
    const [leftTime, leftSignature, leftPublisher, leftIdentifier] = trustedOrder(left);
    const [rightTime, rightSignature, rightPublisher, rightIdentifier] = trustedOrder(right);
    return (leftTime - rightTime ||
        leftSignature.localeCompare(rightSignature) ||
        leftPublisher.localeCompare(rightPublisher) ||
        leftIdentifier.localeCompare(rightIdentifier));
};
const hintIsCurrent = (hint, entity) => {
    // An empty hint is an intentional locator-only disclosure, used for
    // restricted UI content. It remains current without copying content.
    if (hint.title === undefined && hint.excerpt === undefined)
        return true;
    const expected = hintFor(entity);
    return hint.title === expected.title && hint.excerpt === expected.excerpt;
};
export const reduceV2IndexFragments = (namespace, records, authority, availability = {}) => {
    const diagnostics = [];
    const selected = new Map();
    for (const record of [...records].sort((left, right) => compareTrusted(left.metadata, right.metadata))) {
        const fragment = record.envelope;
        if (!isV2IndexFragmentEnvelope(fragment)) {
            diagnostics.push({
                code: 'INVALID_INDEX_ENTRY',
                identifier: record.metadata.identifier,
                detail: 'index fragment does not satisfy the strict schema',
            });
            continue;
        }
        const expectedRecordId = buildV2IndexFragmentIdentifier(namespace, fragment.body.entityType, fragment.body.entityId, fragment.body.parentId);
        if (record.metadata.identifier !== fragment.recordId ||
            fragment.recordId !== expectedRecordId) {
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
        if (entity.entityType !== fragment.body.entityType ||
            record.metadata.publisherName.trim().toLowerCase() !==
                entity.publisherName.trim().toLowerCase() ||
            fragment.body.authority.publisherName.trim().toLowerCase() !==
                entity.publisherName.trim().toLowerCase() ||
            fragment.body.authority.identifier !==
                expectedAuthorityIdentifier(namespace, entity)) {
            diagnostics.push({
                code: 'INDEX_AUTHORITY_MISMATCH',
                identifier: record.metadata.identifier,
                detail: 'index resource publisher or authority locator disagrees with accepted V2 authority',
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
    const entries = [];
    for (const targetId of [...selected.keys()].sort()) {
        const record = selected.get(targetId);
        if (!record)
            continue;
        const fragment = record.envelope;
        const entity = authority.entities[targetId];
        if (!entity)
            continue;
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
export const searchValidatedV2Index = (entries, query, accessScope) => {
    const accessFiltered = accessScope
        ? entries.filter(({ entity }) => {
            if (entity.entityType === 'topic')
                return true;
            if (entity.entityType === 'thread')
                return accessScope.accessibleThreadIds.has(entity.entityId);
            return accessScope.accessibleThreadIds.has(entity.parentThreadId);
        })
        : entries;
    const normalized = query.trim().toLowerCase();
    if (!normalized)
        return [...accessFiltered].sort((left, right) => left.entity.entityId.localeCompare(right.entity.entityId));
    return accessFiltered
        .filter(({ entity }) => {
        const text = entity.entityType === 'post'
            ? entity.content
            : `${entity.title} ${entity.description}`;
        return text.toLowerCase().includes(normalized);
    })
        .sort((left, right) => left.entity.entityId.localeCompare(right.entity.entityId));
};
export const resolveLastKnownGood = (input) => {
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
                    detail: 'an index locator exists but authoritative data is unavailable',
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
