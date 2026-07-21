import type { LegacyNormalizedEntity } from './legacy.js';
import type { LegacyAuthorityState, OwnerEdit, QdbV2Envelope, QdbV2ResourceMetadata, QuarantineRecord, V2EntityCreate } from './types.js';
import { validateEntityCreate } from './validation.js';
import type { IdentityValidator } from './validation.js';
import { validateOwnerEditFields } from './fieldPolicy.js';

export type V2State = { entities: Record<string, V2EntityCreate>; quarantined: QuarantineRecord[] };
export const emptyV2State = (): V2State => ({ entities: {}, quarantined: [] });
const order = (metadata: QdbV2ResourceMetadata) => `${metadata.created.toString().padStart(16, '0')}:${metadata.latestSignature ?? ''}:${metadata.identifier}`;
const reject = (state: V2State, code: QuarantineRecord['code'], id: string, detail: string) => ({ ...state, quarantined: [...state.quarantined, { code, recordId: id, detail }] });
const sameEntityCreate = (left: V2EntityCreate, right: V2EntityCreate) => {
  if (left.entityType !== right.entityType || left.entityId !== right.entityId || left.publisherName !== right.publisherName || left.walletAddress !== right.walletAddress) return false;
  if (left.entityType === 'topic' && right.entityType === 'topic') return left.title === right.title && left.description === right.description;
  if (left.entityType === 'thread' && right.entityType === 'thread') return left.parentTopicId === right.parentTopicId && left.title === right.title && left.description === right.description;
  if (left.entityType === 'post' && right.entityType === 'post') return left.parentThreadId === right.parentThreadId && left.parentPostId === right.parentPostId && left.content === right.content;
  return false;
};

export const reduceV2Creates = (records: Array<{ metadata: QdbV2ResourceMetadata; envelope: QdbV2Envelope<V2EntityCreate> }>, identity: IdentityValidator): V2State => {
  let state = emptyV2State();
  const sorted = [...records].sort((a, b) => order(a.metadata).localeCompare(order(b.metadata)));
  for (const record of sorted) {
    const valid = validateEntityCreate(record.metadata, record.envelope, identity);
    if (valid.ok === false) { state = reject(state, valid.code, record.envelope.recordId, valid.detail); continue; }
    const id = record.envelope.body.entityId;
    const existing = state.entities[id];
    if (existing && !sameEntityCreate(existing, record.envelope.body)) { state = reject(state, 'DUPLICATE_CONFLICT', id, 'conflicting V2 creation'); continue; }
    if (!existing) state = { ...state, entities: { ...state.entities, [id]: record.envelope.body } };
  }
  return state;
};

export const applyOwnerEdit = (state: V2State, metadata: QdbV2ResourceMetadata, edit: OwnerEdit, identity: IdentityValidator): V2State => {
  const entity = state.entities[edit.targetId];
  if (!entity) return reject(state, 'UNAUTHORIZED_PUBLISHER', edit.targetId, 'target entity is not authoritative');
  if (entity.entityType !== edit.targetType) return reject(state, 'MALFORMED_ENVELOPE', edit.targetId, 'owner edit target type mismatch');
  const publisher = identity.validatePublisher(metadata, entity.publisherName);
  if (publisher.ok === false) return reject(state, publisher.code, edit.targetId, publisher.detail);
  const wallet = identity.validateWalletBinding(edit.publisherName, edit.walletAddress);
  if (wallet.ok === false) return reject(state, wallet.code, edit.targetId, wallet.detail);
  if (edit.publisherName.trim().toLowerCase() !== entity.publisherName.trim().toLowerCase()) return reject(state, 'UNAUTHORIZED_PUBLISHER', edit.targetId, 'owner edit publisher does not match authoritative owner');
  const fields = validateOwnerEditFields(edit.targetType, edit.changes);
  if (!fields.ok) return reject(state, 'FORBIDDEN_FIELD', edit.targetId, `forbidden fields: ${fields.forbidden.join(', ')}`);
  return { ...state, entities: { ...state.entities, [edit.targetId]: { ...entity, ...edit.changes } as V2EntityCreate } };
};

export const legacyCanMutate = (entity: LegacyNormalizedEntity) => entity.authorityState === 'APPROVED';

export const authorizeLegacyMutation = (authorityState: LegacyAuthorityState) =>
  authorityState === 'APPROVED'
    ? { ok: true as const }
    : {
        ok: false as const,
        code: 'LEGACY_AUTHORITY_BLOCKED' as const,
        detail: `legacy authority state ${authorityState} cannot authorize mutation`,
      };
