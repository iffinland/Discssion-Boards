import {
  emptyV2State,
  reduceV2Creates,
  applyOwnerEdit,
  legacyCanMutate,
  authorizeLegacyMutation,
} from '../src/services/architectureV2/reducer.js';

import { normalizeLegacyEntity } from '../src/services/architectureV2/legacy.js';
import { buildV2PostEnvelope, buildV2ThreadEnvelope, buildV2TopicEnvelope, reduceV2RuntimeRecords } from '../src/services/architectureV2/runtime.js';

import type { IdentityValidator } from '../src/services/architectureV2/validation.js';
const assert = { equal: (a: unknown, b: unknown) => { if (a !== b) throw new Error(`expected ${String(b)}, got ${String(a)}`); }, deepEqual: (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('values differ'); } };

const identity: IdentityValidator = {
  validatePublisher: (metadata, claimed) => metadata.publisherName.toLowerCase() === claimed.toLowerCase() ? { ok: true } : { ok: false, code: 'IDENTITY_UNVERIFIED', detail: 'publisher mismatch' },
  validateWalletBinding: (_name, wallet) => wallet ? { ok: true } : { ok: false, code: 'IDENTITY_UNVERIFIED', detail: 'wallet binding unavailable' },
};
const record = (created: number, publisher = 'alice') => ({ metadata: { service: 'DOCUMENT', publisherName: publisher, identifier: `qdb-v2-topic-${created}`, created, updated: created, latestSignature: `sig-${created}` }, envelope: { schema: 'qdb-v2' as const, schemaVersion: 2 as const, kind: 'entity-create' as const, recordType: 'topic', recordId: `topic-${created}`, targetId: `topic-${created}`, body: { entityType: 'topic' as const, entityId: `topic-${created}`, publisherName: publisher, walletAddress: 'Qwallet', title: 'title', description: 'description' }, clientCreatedAt: '9999-01-01' } });

const created = reduceV2Creates([record(2), record(1, 'mallory')], identity);
assert.equal(Object.keys(created.entities).length, 2);
assert.equal(created.quarantined.length, 0);
const edited = applyOwnerEdit(created, record(2).metadata, { operation: 'owner-edit', targetType: 'topic', targetId: 'topic-2', publisherName: 'alice', walletAddress: 'Qwallet', changes: { title: 'changed' } }, identity);
const editedTopic = edited.entities['topic-2'];
assert.equal(editedTopic?.entityType === 'topic' ? editedTopic.title : undefined, 'changed');
const forbidden = applyOwnerEdit(edited, record(2).metadata, { operation: 'owner-edit', targetType: 'topic', targetId: 'topic-2', publisherName: 'alice', walletAddress: 'Qwallet', changes: { likes: 99 } }, identity);
assert.equal(forbidden.quarantined[forbidden.quarantined.length - 1]?.code, 'FORBIDDEN_FIELD');
const legacy = normalizeLegacyEntity({ entityType: 'post', entityId: 'legacy-1', legacyStatus: 'available', payload: { author: 'alice' } });
assert.equal(legacyCanMutate(legacy), false);
assert.equal(authorizeLegacyMutation('UNRESOLVED').ok, false);
assert.equal(authorizeLegacyMutation('QUARANTINED').ok, false);
assert.equal(authorizeLegacyMutation('APPROVED').ok, true);
const topicEnvelope = buildV2TopicEnvelope({ entityType: 'topic', entityId: 'native-topic', publisherName: 'alice', walletAddress: 'Qwallet', title: 'Native', description: 'Native topic' });
const threadEnvelope = buildV2ThreadEnvelope({ entityType: 'thread', entityId: 'native-thread', parentTopicId: 'native-topic', publisherName: 'alice', walletAddress: 'Qwallet', title: 'Thread', description: 'Native thread' });
const postEnvelope = buildV2PostEnvelope({ entityType: 'post', entityId: 'native-post', parentThreadId: 'native-thread', parentPostId: null, publisherName: 'alice', walletAddress: 'Qwallet', content: 'Native post' });
const runtime = reduceV2RuntimeRecords([
  { metadata: { service: 'DOCUMENT', publisherName: 'alice', identifier: topicEnvelope.recordId, created: 1, updated: 1, latestSignature: 'a' }, envelope: topicEnvelope },
  { metadata: { service: 'DOCUMENT', publisherName: 'alice', identifier: threadEnvelope.recordId, created: 2, updated: 2, latestSignature: 'b' }, envelope: threadEnvelope },
  { metadata: { service: 'DOCUMENT', publisherName: 'alice', identifier: postEnvelope.recordId, created: 3, updated: 3, latestSignature: 'c' }, envelope: postEnvelope },
], identity);
assert.equal(Object.keys(runtime.authoritative.entities).length, 3);
assert.deepEqual(emptyV2State().entities, {});
console.log('Architecture V2 foundation tests passed');
