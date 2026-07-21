import { buildV2OwnerEditEnvelope, buildV2PostEnvelope, buildV2ThreadEnvelope, buildV2TopicEnvelope, isV2CreateRuntimeRecord, isV2EntityEnvelope, isV2OwnerEditRuntimeRecord, reduceV2RuntimeRecords, toV2RuntimeRecord } from '../src/services/architectureV2/runtime.js';
import { applyOwnerEdit, emptyV2State } from '../src/services/architectureV2/reducer.js';
const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
const identity = { validatePublisher: (metadata: { publisherName: string }, claimed: string) => metadata.publisherName === claimed ? { ok: true as const } : { ok: false as const, code: 'IDENTITY_UNVERIFIED' as const, detail: 'publisher mismatch' }, validateWalletBinding: (_name: string, wallet: string) => wallet ? { ok: true as const } : { ok: false as const, code: 'IDENTITY_UNVERIFIED' as const, detail: 'wallet unavailable' } };
const metadata = (id: string, publisher = 'alice', created = 1) => ({ service: 'DOCUMENT', publisherName: publisher, identifier: id, created, updated: created, latestSignature: `sig-${created}` });
const topic = buildV2TopicEnvelope({ entityType: 'topic', entityId: 'topic-1', publisherName: 'alice', walletAddress: 'wallet', title: 'Topic', description: 'Description' });
const thread = buildV2ThreadEnvelope({ entityType: 'thread', entityId: 'thread-1', parentTopicId: 'topic-1', publisherName: 'alice', walletAddress: 'wallet', title: 'Thread', description: 'Description' });
const post = buildV2PostEnvelope({ entityType: 'post', entityId: 'post-1', parentThreadId: 'thread-1', parentPostId: null, publisherName: 'alice', walletAddress: 'wallet', content: 'Post' });
const records = [
  { metadata: metadata(topic.recordId, 'alice', 1), envelope: topic },
  { metadata: metadata(thread.recordId, 'alice', 2), envelope: thread },
  { metadata: metadata(post.recordId, 'alice', 3), envelope: post },
];
const forward = reduceV2RuntimeRecords(records, identity);
const reverse = reduceV2RuntimeRecords([...records].reverse(), identity);
assert(Object.keys(forward.authoritative.entities).length === 3, 'native records reduce');
assert(JSON.stringify(forward.authoritative) === JSON.stringify(reverse.authoritative), 'reduction is order independent');
const topicEdit = buildV2OwnerEditEnvelope({ operation: 'owner-edit', targetType: 'topic', targetId: 'topic-1', publisherName: 'alice', walletAddress: 'wallet', changes: { title: 'Changed' } }, 'edit-topic-1');
const edited = reduceV2RuntimeRecords([...records, { metadata: metadata(topicEdit.recordId, 'alice', 4), envelope: topicEdit }], identity);
assert(edited.authoritative.entities['topic-1']?.entityType === 'topic' && edited.authoritative.entities['topic-1'].title === 'Changed', 'owner edit survives reduction');
const unrelated = applyOwnerEdit(forward.authoritative, metadata('edit', 'mallory', 4), { operation: 'owner-edit', targetType: 'post', targetId: 'post-1', publisherName: 'mallory', walletAddress: 'wallet', changes: { content: 'forged' } }, identity);
assert(unrelated.quarantined[unrelated.quarantined.length - 1]?.code === 'IDENTITY_UNVERIFIED', 'unrelated publisher rejected');
const forbidden = applyOwnerEdit(forward.authoritative, metadata('edit', 'alice', 4), { operation: 'owner-edit', targetType: 'post', targetId: 'post-1', publisherName: 'alice', walletAddress: 'wallet', changes: { likes: 9 } }, identity);
assert(forbidden.quarantined[forbidden.quarantined.length - 1]?.code === 'FORBIDDEN_FIELD', 'forbidden fields rejected');
const edit = buildV2OwnerEditEnvelope({ operation: 'owner-edit', targetType: 'topic', targetId: 'topic-1', publisherName: 'alice', walletAddress: 'wallet', changes: { title: 'Changed' } }, 'edit-1');
assert(edit.kind === 'operation' && edit.targetId === 'topic-1', 'owner edit envelope built');
assert(isV2CreateRuntimeRecord(toV2RuntimeRecord(metadata(topic.recordId), topic)), 'create runtime record discriminates');
assert(isV2OwnerEditRuntimeRecord(toV2RuntimeRecord(metadata(edit.recordId, 'alice', 4), edit)), 'owner-edit runtime record discriminates');
assert(!isV2EntityEnvelope({ ...edit, targetId: 'different', body: { ...edit.body } }), 'mixed owner-edit envelope rejected');
assert(emptyV2State().quarantined.length === 0, 'empty state is clean');
console.log('Architecture V2 runtime integration tests passed');
