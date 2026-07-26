import { applyOwnerEdit, reduceV2Creates } from './reducer.js';
import { validateEntityCreate, validateMetadata } from './validation.js';
import { isNativePollReference } from './polls.js';
import { isV2AttachmentReferenceList } from './fieldPolicy.js';
export const isV2CreateRuntimeRecord = (record) => record.envelope.kind === 'entity-create';
export const isV2OwnerEditRuntimeRecord = (record) => record.envelope.kind === 'operation';
export const toV2RuntimeRecord = (metadata, envelope) => envelope.kind === 'entity-create'
    ? { metadata, envelope }
    : { metadata, envelope };
export const buildV2OwnerEditEnvelope = (edit, operationId, clientCreatedAt = new Date().toISOString()) => ({
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
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isEntityType = (value) => value === 'topic' || value === 'thread' || value === 'post';
export const isV2EntityEnvelope = (value) => {
    if (!isRecord(value))
        return false;
    const candidate = value;
    const body = candidate.body;
    if (candidate.schema !== 'qdb-v2' ||
        candidate.schemaVersion !== 2 ||
        typeof candidate.recordType !== 'string' ||
        typeof candidate.recordId !== 'string' ||
        typeof candidate.targetId !== 'string' ||
        !isRecord(body))
        return false;
    if (candidate.kind === 'entity-create') {
        if (!isEntityType(body.entityType) ||
            body.entityType !== candidate.recordType ||
            body.entityId !== candidate.targetId ||
            typeof body.publisherName !== 'string' ||
            typeof body.walletAddress !== 'string')
            return false;
        if (body.entityType === 'topic')
            return (typeof body.title === 'string' && typeof body.description === 'string');
        if (body.entityType === 'thread')
            return (typeof body.parentTopicId === 'string' &&
                typeof body.title === 'string' &&
                typeof body.description === 'string');
        return (typeof body.parentThreadId === 'string' &&
            (typeof body.parentPostId === 'string' || body.parentPostId === null) &&
            typeof body.content === 'string' &&
            (body.attachments === undefined ||
                isV2AttachmentReferenceList(body.attachments)) &&
            (body.pollReference === undefined ||
                body.pollReference === null ||
                isNativePollReference(body.pollReference)));
    }
    if (candidate.kind === 'operation') {
        return (candidate.recordType === 'owner-edit' &&
            body.operation === 'owner-edit' &&
            body.targetId === candidate.targetId &&
            isEntityType(body.targetType) &&
            typeof body.publisherName === 'string' &&
            typeof body.walletAddress === 'string' &&
            isRecord(body.changes));
    }
    return false;
};
export const buildV2Envelope = (body, recordId, clientCreatedAt = new Date().toISOString()) => ({
    schema: 'qdb-v2',
    schemaVersion: 2,
    kind: 'entity-create',
    recordType: body.entityType,
    recordId,
    targetId: body.entityId,
    body,
    clientCreatedAt,
});
export const buildV2TopicEnvelope = (body) => buildV2Envelope(body, `${V2_IDENTIFIER_PREFIX}topic-${body.entityId}`);
export const buildV2ThreadEnvelope = (body) => buildV2Envelope(body, `${V2_IDENTIFIER_PREFIX}thread-${body.entityId}`);
export const buildV2PostEnvelope = (body) => buildV2Envelope(body, `${V2_IDENTIFIER_PREFIX}post-${body.entityId}`);
export const reduceV2RuntimeRecords = (records, identity) => {
    const diagnostics = [];
    const creates = [];
    const operations = [];
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
        const validation = validateEntityCreate(record.metadata, record.envelope, identity);
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
        const signatureOrder = (a.metadata.latestSignature ?? '').localeCompare(b.metadata.latestSignature ?? '');
        return (signatureOrder ||
            a.metadata.identifier.localeCompare(b.metadata.identifier));
    })) {
        const before = authoritative.quarantined.length;
        authoritative = applyOwnerEdit(authoritative, record.metadata, record.envelope.body, identity);
        if (authoritative.quarantined.length === before &&
            !authoritative.entities[record.envelope.targetId]) {
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
