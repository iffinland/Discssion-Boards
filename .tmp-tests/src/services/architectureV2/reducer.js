import { validateEntityCreate } from './validation.js';
import { validateOwnerEditFields } from './fieldPolicy.js';
import { sameNativePollReference } from './polls.js';
export const emptyV2State = () => ({ entities: {}, quarantined: [] });
const order = (metadata) => `${metadata.created.toString().padStart(16, '0')}:${metadata.latestSignature ?? ''}:${metadata.identifier}`;
const reject = (state, code, id, detail) => ({
    ...state,
    quarantined: [...state.quarantined, { code, recordId: id, detail }],
});
const sameAttachmentReferences = (left, right) => {
    const leftReferences = left ?? [];
    const rightReferences = right ?? [];
    return (leftReferences.length === rightReferences.length &&
        leftReferences.every((reference, index) => {
            const other = rightReferences[index];
            return (other !== undefined &&
                reference.id === other.id &&
                reference.service === other.service &&
                reference.name === other.name &&
                reference.identifier === other.identifier &&
                reference.filename === other.filename &&
                reference.mimeType === other.mimeType &&
                reference.size === other.size);
        }));
};
const sameEntityCreate = (left, right) => {
    if (left.entityType !== right.entityType ||
        left.entityId !== right.entityId ||
        left.publisherName !== right.publisherName ||
        left.walletAddress !== right.walletAddress)
        return false;
    if (left.entityType === 'topic' && right.entityType === 'topic')
        return left.title === right.title && left.description === right.description;
    if (left.entityType === 'thread' && right.entityType === 'thread')
        return (left.parentTopicId === right.parentTopicId &&
            left.title === right.title &&
            left.description === right.description);
    if (left.entityType === 'post' && right.entityType === 'post')
        return (left.parentThreadId === right.parentThreadId &&
            left.parentPostId === right.parentPostId &&
            left.content === right.content &&
            sameAttachmentReferences(left.attachments, right.attachments) &&
            sameNativePollReference(left.pollReference, right.pollReference));
    return false;
};
export const reduceV2Creates = (records, identity) => {
    let state = emptyV2State();
    const sorted = [...records].sort((a, b) => order(a.metadata).localeCompare(order(b.metadata)));
    for (const record of sorted) {
        const valid = validateEntityCreate(record.metadata, record.envelope, identity);
        if (valid.ok === false) {
            state = reject(state, valid.code, record.envelope.recordId, valid.detail);
            continue;
        }
        const id = record.envelope.body.entityId;
        const existing = state.entities[id];
        if (existing && !sameEntityCreate(existing, record.envelope.body)) {
            state = reject(state, 'DUPLICATE_CONFLICT', id, 'conflicting V2 creation');
            continue;
        }
        if (!existing)
            state = {
                ...state,
                entities: { ...state.entities, [id]: record.envelope.body },
            };
    }
    return state;
};
export const applyOwnerEdit = (state, metadata, edit, identity) => {
    const entity = state.entities[edit.targetId];
    if (!entity)
        return reject(state, 'UNAUTHORIZED_PUBLISHER', edit.targetId, 'target entity is not authoritative');
    if (entity.entityType !== edit.targetType)
        return reject(state, 'MALFORMED_ENVELOPE', edit.targetId, 'owner edit target type mismatch');
    const publisher = identity.validatePublisher(metadata, entity.publisherName);
    if (publisher.ok === false)
        return reject(state, publisher.code, edit.targetId, publisher.detail);
    const wallet = identity.validateWalletBinding(edit.publisherName, edit.walletAddress);
    if (wallet.ok === false)
        return reject(state, wallet.code, edit.targetId, wallet.detail);
    if (edit.publisherName.trim().toLowerCase() !==
        entity.publisherName.trim().toLowerCase())
        return reject(state, 'UNAUTHORIZED_PUBLISHER', edit.targetId, 'owner edit publisher does not match authoritative owner');
    const fields = validateOwnerEditFields(edit.targetType, edit.changes);
    if (!fields.ok)
        return reject(state, 'FORBIDDEN_FIELD', edit.targetId, `forbidden fields: ${fields.forbidden.join(', ')}`);
    return {
        ...state,
        entities: {
            ...state.entities,
            [edit.targetId]: { ...entity, ...edit.changes },
        },
    };
};
export const legacyCanMutate = (entity) => entity.authorityState === 'APPROVED';
export const authorizeLegacyMutation = (authorityState) => authorityState === 'APPROVED'
    ? { ok: true }
    : {
        ok: false,
        code: 'LEGACY_AUTHORITY_BLOCKED',
        detail: `legacy authority state ${authorityState} cannot authorize mutation`,
    };
