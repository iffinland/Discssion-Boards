import { isV2AttachmentReferenceList } from './fieldPolicy.js';
export const normalizeName = (name) => name.trim().toLowerCase();
export const validateMetadata = (metadata) => {
    if (!metadata.service || !metadata.publisherName || !metadata.identifier)
        return {
            ok: false,
            code: 'INVALID_METADATA',
            detail: 'missing trusted resource metadata',
        };
    if (!Number.isSafeInteger(metadata.created) ||
        (metadata.updated !== null &&
            (!Number.isSafeInteger(metadata.updated) ||
                metadata.created > metadata.updated)))
        return {
            ok: false,
            code: 'INVALID_METADATA',
            detail: 'invalid Core ordering metadata',
        };
    return { ok: true };
};
export const validateEnvelope = (envelope) => {
    if (envelope.schema !== 'qdb-v2' ||
        envelope.schemaVersion !== 2 ||
        !envelope.recordId ||
        !envelope.targetId ||
        !envelope.recordType)
        return {
            ok: false,
            code: 'MALFORMED_ENVELOPE',
            detail: 'invalid qdb-v2 envelope',
        };
    return { ok: true };
};
export const validateEntityCreate = (metadata, envelope, identity) => {
    const checks = [validateMetadata(metadata), validateEnvelope(envelope)];
    const failed = checks.find((check) => !check.ok);
    if (failed && !failed.ok)
        return failed;
    if (envelope.kind !== 'entity-create' ||
        envelope.targetId !== envelope.body.entityId ||
        envelope.body.entityType !== envelope.recordType)
        return {
            ok: false,
            code: 'MALFORMED_ENVELOPE',
            detail: 'entity envelope target mismatch',
        };
    if (envelope.body.entityType === 'post' &&
        envelope.body.attachments !== undefined &&
        !isV2AttachmentReferenceList(envelope.body.attachments))
        return {
            ok: false,
            code: 'MALFORMED_ENVELOPE',
            detail: 'invalid post attachment references',
        };
    const publisher = identity.validatePublisher(metadata, envelope.body.publisherName);
    if (!publisher.ok)
        return publisher;
    return identity.validateWalletBinding(envelope.body.publisherName, envelope.body.walletAddress);
};
export const legacyAuthorityAllowsOwnerMutation = (state) => state === 'APPROVED';
