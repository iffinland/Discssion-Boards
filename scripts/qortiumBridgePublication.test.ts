import {
  QortiumRequestError,
  requestQortium,
  resolveQortiumRequestBridge,
} from '../src/services/qortium/qortiumClient.js';
import {
  QDN_HOME_SOURCE_MAX_BYTES,
  QDN_INLINE_FILE_MAX_BYTES,
  QdnFilePublicationError,
  publishQdnFileResource,
  sanitizeQdnSourceFilename,
  type QdnFilePublicationRecovery,
  type QdnFilePublicationRecoveryStore,
  type QdnPublishFile,
} from '../src/services/qortium/qdnFilePublication.js';
import {
  encodeQdnImageTag,
  parseQdnImageTagPayload,
} from '../src/services/forum/richText.js';
import {
  createAttachmentSignature,
  getAttachmentSizeLimit,
  isAllowedAttachmentFile,
} from '../src/services/forum/attachments.js';
import {
  encodeQdnVideoTag,
  parseQdnVideoTagPayload,
} from '../src/services/forum/videoEmbed.js';
import { forumQdnService } from '../src/services/qdn/forumQdnService.js';
import {
  buildV2OwnerEditEnvelope,
  buildV2PostEnvelope,
  isV2EntityEnvelope,
  reduceV2RuntimeRecords,
} from '../src/services/architectureV2/runtime.js';
import type { IdentityValidator } from '../src/services/architectureV2/validation.js';

const assert: (condition: unknown, detail: string) => asserts condition = (
  condition,
  detail
) => {
  if (!condition) throw new Error(`Assertion failed: ${detail}`);
};

const assertEqual = <T>(actual: T, expected: T, detail: string) => {
  assert(
    Object.is(actual, expected),
    `${detail}; expected ${String(expected)}, received ${String(actual)}`
  );
};

const assertRejectsCode = async (
  operation: () => Promise<unknown>,
  code: string
) => {
  try {
    await operation();
  } catch (error) {
    assert(error instanceof Error, `${code} failure must be an Error`);
    assert(error.message.includes(`[${code}]`), `expected ${code}`);
    return error;
  }
  throw new Error(`Assertion failed: expected ${code}`);
};

const tests: Array<{ name: string; run: () => void | Promise<void> }> = [];
const test = (name: string, run: () => void | Promise<void>) =>
  tests.push({ name, run });

const requestFunction = async () => ({ ok: true });

test('bridge reports unavailable when no scope exposes qdnRequest', () => {
  assertEqual(
    resolveQortiumRequestBridge({ globalScope: {}, windowScope: {} }).status,
    'UNAVAILABLE',
    'empty scopes must be unavailable'
  );
});

test('bridge resolves callable globalThis first', () => {
  const resolution = resolveQortiumRequestBridge({
    globalScope: { qdnRequest: requestFunction },
    windowScope: { qdnRequest: async () => 'window' },
  });
  assert(resolution.status === 'AVAILABLE', 'global bridge must resolve');
  assertEqual(resolution.source, 'globalThis', 'global bridge has priority');
});

test('bridge resolves window when globalThis is unavailable', () => {
  const resolution = resolveQortiumRequestBridge({
    globalScope: {},
    windowScope: { qdnRequest: requestFunction },
  });
  assert(resolution.status === 'AVAILABLE', 'window bridge must resolve');
  assertEqual(resolution.source, 'window', 'window must be selected');
});

test('bridge resolves parent before top', () => {
  const resolution = resolveQortiumRequestBridge({
    globalScope: {},
    windowScope: {
      parent: { qdnRequest: requestFunction },
      top: { qdnRequest: async () => 'top' },
    },
  });
  assert(resolution.status === 'AVAILABLE', 'parent bridge must resolve');
  assertEqual(resolution.source, 'parent', 'parent must precede top');
});

test('bridge resolves top as final callable candidate', () => {
  const resolution = resolveQortiumRequestBridge({
    globalScope: {},
    windowScope: { parent: {}, top: { qdnRequest: requestFunction } },
  });
  assert(resolution.status === 'AVAILABLE', 'top bridge must resolve');
  assertEqual(resolution.source, 'top', 'top must be selected');
});

test('malformed earlier bridge does not hide a later callable bridge', () => {
  const resolution = resolveQortiumRequestBridge({
    globalScope: { qdnRequest: { request: requestFunction } },
    windowScope: { qdnRequest: requestFunction },
  });
  assert(resolution.status === 'AVAILABLE', 'later valid bridge must win');
  assertEqual(resolution.source, 'window', 'window bridge must be selected');
});

test('non-callable bridge is reported as malformed', () => {
  assertEqual(
    resolveQortiumRequestBridge({
      globalScope: { qdnRequest: { request: requestFunction } },
    }).status,
    'MALFORMED',
    'object-shaped bridge is not the Home contract'
  );
});

test('throwing bridge getter is reported as inaccessible', () => {
  const scope = Object.defineProperty({}, 'qdnRequest', {
    get() {
      throw new Error('denied');
    },
  });
  assertEqual(
    resolveQortiumRequestBridge({ globalScope: scope }).status,
    'INACCESSIBLE',
    'throwing bridge getter must be inaccessible'
  );
});

test('cross-origin parent failure does not hide a callable top bridge', () => {
  const windowScope = Object.defineProperties(
    {},
    {
      parent: {
        get() {
          throw new Error('cross-origin');
        },
      },
      top: { value: { qdnRequest: requestFunction } },
    }
  );
  const resolution = resolveQortiumRequestBridge({
    globalScope: {},
    windowScope,
  });
  assert(resolution.status === 'AVAILABLE', 'top must remain reachable');
  assertEqual(resolution.source, 'top', 'top bridge must be selected');
});

test('cross-origin top access failure is handled without throwing', () => {
  const windowScope = Object.defineProperties(
    {},
    {
      parent: { value: {} },
      top: {
        get() {
          throw new Error('cross-origin');
        },
      },
    }
  );
  assertEqual(
    resolveQortiumRequestBridge({ globalScope: {}, windowScope }).status,
    'INACCESSIBLE',
    'top access failure must be controlled'
  );
});

test('requestQortium invokes the documented callable bridge shape', async () => {
  const existing = Object.getOwnPropertyDescriptor(globalThis, 'qdnRequest');
  Object.defineProperty(globalThis, 'qdnRequest', {
    configurable: true,
    value: async (payload: Record<string, unknown>) => ({
      accepted: payload.action === 'TEST_ACTION',
    }),
  });
  try {
    const response = await requestQortium<{ accepted: boolean }>({
      action: 'TEST_ACTION',
    });
    assertEqual(response.accepted, true, 'bridge response must be returned');
  } finally {
    if (existing) Object.defineProperty(globalThis, 'qdnRequest', existing);
    else Reflect.deleteProperty(globalThis, 'qdnRequest');
  }
});

test('publishing outside Home fails with a stable bridge diagnostic', async () => {
  const existing = Object.getOwnPropertyDescriptor(globalThis, 'qdnRequest');
  Reflect.deleteProperty(globalThis, 'qdnRequest');
  try {
    const first = await assertRejectsCode(
      () => requestQortium({ action: 'PUBLISH_QDN_RESOURCE' }),
      'BRIDGE_UNAVAILABLE'
    );
    assert(
      first.message.includes('Open this app through Qortium Home'),
      'outside-Home error must tell the user how to publish'
    );
  } finally {
    if (existing) Object.defineProperty(globalThis, 'qdnRequest', existing);
  }
});

class MemoryRecoveryStore implements QdnFilePublicationRecoveryStore {
  readonly records = new Map<string, QdnFilePublicationRecovery>();

  get(fileKey: string) {
    return this.records.get(fileKey);
  }

  put(recovery: QdnFilePublicationRecovery) {
    this.records.set(recovery.fileKey, recovery);
  }

  remove(fileKey: string) {
    this.records.delete(fileKey);
  }
}

const fakeFile = (
  size: number,
  name = 'sample.zip',
  type = 'application/zip'
): QdnPublishFile => ({
  name,
  type,
  size,
  lastModified: 123456,
  arrayBuffer: async () => new Uint8Array(Math.min(size, 32)).buffer,
});

type HarnessOptions = {
  file?: QdnPublishFile;
  store?: MemoryRecoveryStore;
  confirmation?: 'found' | 'missing' | 'unavailable';
  selection?: unknown;
  publishResponse?: unknown;
  publishError?: Error;
  encodeInline?: (file: QdnPublishFile) => Promise<string>;
};

const createHarness = (options: HarnessOptions = {}) => {
  const file = options.file ?? fakeFile(64, 'small.txt', 'text/plain');
  const store = options.store ?? new MemoryRecoveryStore();
  const calls: Record<string, unknown>[] = [];
  let published = false;
  const resource = {
    service: 'FILE',
    name: 'Alice',
    identifier: 'qdbm-att-test',
    filename: file.name,
    mimeType: file.type,
    size: file.size,
  };
  const request = async (payload: Record<string, unknown>) => {
    calls.push(payload);
    if (payload.action === 'SELECT_QDN_PUBLISH_SOURCE') {
      return (
        options.selection ?? {
          canceled: false,
          sourceToken: 'source-token-1',
          fileName: sanitizeQdnSourceFilename(file.name, 'file'),
          mimeType: file.type,
          size: file.size,
        }
      );
    }
    if (payload.action === 'PUBLISH_QDN_RESOURCE') {
      if (options.publishError) throw options.publishError;
      published = true;
      return (
        options.publishResponse ?? {
          accepted: true,
          transactionSignature: 'signature-1',
        }
      );
    }
    if (payload.action === 'SEARCH_QDN_RESOURCES') {
      if (options.confirmation === 'unavailable') return { unavailable: true };
      if (options.confirmation === 'missing') return [];
      return published ? [resource] : [];
    }
    throw new Error(`Unexpected action ${String(payload.action)}`);
  };
  return {
    file,
    store,
    calls,
    resource,
    run: () =>
      publishQdnFileResource(
        {
          file,
          service: resource.service,
          name: resource.name,
          identifier: resource.identifier,
          timeoutMs: 1000,
        },
        {
          request,
          recoveryStore: store,
          encodeInline: options.encodeInline ?? (async () => 'Ym91bmRlZA=='),
          wait: async () => undefined,
          confirmationAttempts: 2,
          confirmationDelayMs: 0,
          now: () => 1000 + calls.length,
        }
      ),
  };
};

test('small file publishes through bounded inline base64', async () => {
  let encoded = 0;
  const harness = createHarness({
    file: fakeFile(QDN_INLINE_FILE_MAX_BYTES, 'boundary.zip'),
    encodeInline: async () => {
      encoded += 1;
      return 'aW5saW5l';
    },
  });
  const result = await harness.run();
  assertEqual(result.transport, 'inline-base64', 'boundary is inline');
  assertEqual(encoded, 1, 'inline encoder must run exactly once');
  const publish = harness.calls.find(
    (call) => call.action === 'PUBLISH_QDN_RESOURCE'
  );
  assert(publish?.data64 === 'aW5saW5l', 'inline payload must contain data64');
  assert(!('sourceToken' in publish), 'inline payload must omit sourceToken');
});

test('large file publishes through Home source token without inline encoding', async () => {
  const harness = createHarness({
    file: fakeFile(QDN_INLINE_FILE_MAX_BYTES + 1, 'large.zip'),
    encodeInline: async () => {
      throw new Error('large path must not encode inline');
    },
  });
  const result = await harness.run();
  assertEqual(result.transport, 'home-source-token', 'large path uses token');
  const publish = harness.calls.find(
    (call) => call.action === 'PUBLISH_QDN_RESOURCE'
  );
  assert(publish?.sourceToken === 'source-token-1', 'token must be forwarded');
  assert(!('data64' in publish), 'large payload must never contain data64');
});

test('100 MiB boundary is accepted by the token transport', async () => {
  const harness = createHarness({
    file: fakeFile(QDN_HOME_SOURCE_MAX_BYTES, 'max.webm', 'video/webm'),
  });
  assertEqual(
    (await harness.run()).transport,
    'home-source-token',
    'verified Home boundary must use token transport'
  );
});

test('resource over the verified Home cap is rejected before bridge use', async () => {
  const harness = createHarness({
    file: fakeFile(QDN_HOME_SOURCE_MAX_BYTES + 1, 'too-large.webm'),
  });
  await assertRejectsCode(harness.run, 'FILE_TOO_LARGE');
  assertEqual(
    harness.calls.length,
    0,
    'oversized resource must not use bridge'
  );
});

test('browser publication refuses to start without durable recovery storage', async () => {
  const existingWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: undefined },
  });
  try {
    await assertRejectsCode(
      () =>
        publishQdnFileResource({
          file: fakeFile(12, 'durability.txt', 'text/plain'),
          service: 'FILE',
          name: 'Alice',
          identifier: 'qdbm-att-durability',
        }),
      'RETRY_REQUIRED'
    );
  } finally {
    if (existingWindow)
      Object.defineProperty(globalThis, 'window', existingWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('Home source selection cancellation is controlled', async () => {
  const harness = createHarness({
    file: fakeFile(QDN_INLINE_FILE_MAX_BYTES + 1),
    selection: { canceled: true },
  });
  await assertRejectsCode(harness.run, 'USER_CANCELLED');
});

test('malformed Home source token response is rejected', async () => {
  const harness = createHarness({
    file: fakeFile(QDN_INLINE_FILE_MAX_BYTES + 1),
    selection: { canceled: false, fileName: 'sample.zip', size: 10 },
  });
  await assertRejectsCode(harness.run, 'SOURCE_TOKEN_FAILED');
});

test('source-token action failure never falls back to base64', async () => {
  const file = fakeFile(QDN_INLINE_FILE_MAX_BYTES + 1);
  const calls: Record<string, unknown>[] = [];
  await assertRejectsCode(
    () =>
      publishQdnFileResource(
        {
          file,
          service: 'FILE',
          name: 'Alice',
          identifier: 'qdbm-att-source-error',
        },
        {
          request: async (payload) => {
            calls.push(payload);
            if (payload.action === 'SEARCH_QDN_RESOURCES') return [];
            throw new Error('source selection unavailable');
          },
          encodeInline: async () => {
            throw new Error('must not encode');
          },
        }
      ),
    'SOURCE_TOKEN_FAILED'
  );
  assert(
    !calls.some((call) => 'data64' in call),
    'source-token failure must not create inline payload'
  );
});

test('Home selection must match the editor-selected file', async () => {
  const harness = createHarness({
    file: fakeFile(QDN_INLINE_FILE_MAX_BYTES + 1),
    selection: {
      canceled: false,
      sourceToken: 'wrong-file-token',
      fileName: 'different.zip',
      mimeType: 'application/zip',
      size: QDN_INLINE_FILE_MAX_BYTES + 1,
    },
  });
  await assertRejectsCode(harness.run, 'SOURCE_FILE_MISMATCH');
});

test('Home-compatible filename normalization is deterministic', () => {
  assertEqual(
    sanitizeQdnSourceFilename(' bad:*  name?.zip '),
    'bad__ name_.zip',
    'filename must match Home normalization'
  );
});

test('an unaccepted publication response is rejected', async () => {
  const harness = createHarness({ publishResponse: { accepted: false } });
  await assertRejectsCode(harness.run, 'PUBLICATION_REJECTED');
  assertEqual(harness.store.records.size, 0, 'known rejection clears recovery');
});

test('malformed publication response is a recoverable publication failure', async () => {
  const harness = createHarness({ publishResponse: 'unexpected-success' });
  const error = await assertRejectsCode(harness.run, 'PUBLICATION_FAILED');
  assert(
    error instanceof QdnFilePublicationError && Boolean(error.recovery),
    'malformed result must preserve the identifier for safe retry'
  );
});

test('explicit Home rejection is not treated as an ambiguous submit', async () => {
  const harness = createHarness({
    publishError: new Error('User denied request'),
  });
  await assertRejectsCode(harness.run, 'PUBLICATION_REJECTED');
  assertEqual(
    harness.store.records.size,
    0,
    'explicit rejection clears recovery'
  );
});

test('ambiguous publication failure preserves identifier recovery', async () => {
  const harness = createHarness({ publishError: new Error('connection lost') });
  const error = await assertRejectsCode(
    harness.run,
    'POSSIBLE_ALREADY_PUBLISHED'
  );
  assert(
    error instanceof QdnFilePublicationError && Boolean(error.recovery),
    'ambiguous failure must expose recovery'
  );
  assertEqual(harness.store.records.size, 1, 'recovery must be persisted');
});

test('accepted but unconfirmed publication returns recoverable state', async () => {
  const harness = createHarness({ confirmation: 'missing' });
  const error = await assertRejectsCode(
    harness.run,
    'CONFIRMATION_UNAVAILABLE'
  );
  assert(
    error instanceof QdnFilePublicationError &&
      error.recovery?.stage === 'CONFIRMATION_UNAVAILABLE',
    'accepted publication must preserve confirmation recovery'
  );
});

test('retry confirms the stored identifier without republishing', async () => {
  const store = new MemoryRecoveryStore();
  const first = createHarness({ store, confirmation: 'missing' });
  await assertRejectsCode(first.run, 'CONFIRMATION_UNAVAILABLE');
  const secondCalls: Record<string, unknown>[] = [];
  const second = await publishQdnFileResource(
    {
      file: first.file,
      service: first.resource.service,
      name: first.resource.name,
      identifier: 'a-new-identifier-that-must-not-win',
    },
    {
      recoveryStore: store,
      request: async (payload) => {
        secondCalls.push(payload);
        return payload.action === 'SEARCH_QDN_RESOURCES'
          ? [first.resource]
          : { accepted: true };
      },
      wait: async () => undefined,
      confirmationAttempts: 1,
      confirmationDelayMs: 0,
      now: () => 2000,
    }
  );
  assertEqual(second.reused, true, 'retry must reuse confirmed resource');
  assertEqual(
    second.resource.identifier,
    first.resource.identifier,
    'stored identifier must remain stable'
  );
  assert(
    !secondCalls.some((call) => call.action === 'PUBLISH_QDN_RESOURCE'),
    'confirmed retry must not republish'
  );
});

test('ambiguous recovery with a missing exact resource never republishes automatically', async () => {
  const store = new MemoryRecoveryStore();
  const failed = createHarness({ store, publishError: new Error('offline') });
  await assertRejectsCode(failed.run, 'POSSIBLE_ALREADY_PUBLISHED');
  const retry = createHarness({ store });
  const error = await assertRejectsCode(
    retry.run,
    'POSSIBLE_ALREADY_PUBLISHED'
  );
  assert(error instanceof QdnFilePublicationError, 'recovery must be exposed');
  assertEqual(
    error.recovery?.resource.identifier,
    failed.resource.identifier,
    'recovery must retain the same QDN identifier'
  );
  assert(
    !retry.calls.some((call) => call.action === 'PUBLISH_QDN_RESOURCE'),
    'ambiguous recovery must not republish automatically'
  );
});

test('unavailable preflight fails before first publication', async () => {
  const harness = createHarness({ confirmation: 'unavailable' });
  await assertRejectsCode(harness.run, 'CONFIRMATION_UNAVAILABLE');
  assert(
    !harness.calls.some((call) => call.action === 'PUBLISH_QDN_RESOURCE'),
    'unavailable preflight must fail closed'
  );
});

test('bridge errors remain distinct from QDN confirmation errors', async () => {
  const harness = createHarness();
  const bridgeError = new QortiumRequestError(
    'BRIDGE_UNAVAILABLE',
    'Open through Home.'
  );
  await assertRejectsCode(
    () =>
      publishQdnFileResource(
        {
          file: harness.file,
          service: harness.resource.service,
          name: harness.resource.name,
          identifier: harness.resource.identifier,
        },
        { request: async () => Promise.reject(bridgeError) }
      ),
    'BRIDGE_UNAVAILABLE'
  );
});

test('legacy image tag format remains parseable', () => {
  const tag = encodeQdnImageTag({
    name: 'Alice',
    identifier: 'qdbm-img-existing',
    filename: 'old.png',
  });
  const parsed = parseQdnImageTagPayload(tag.slice(5, -6));
  assertEqual(parsed?.identifier, 'qdbm-img-existing', 'image id must survive');
});

test('legacy attachment references remain readable without migration', () => {
  const legacyAttachment = {
    id: 'legacy-att-1',
    service: 'FILE',
    name: 'Alice',
    identifier: 'qdbm-att-existing',
    filename: 'archive.zip',
    mimeType: 'application/zip',
    size: 512,
  };
  assertEqual(
    createAttachmentSignature(legacyAttachment),
    'qdbm-att-existing:archive.zip',
    'legacy attachment signature must remain unchanged'
  );
});

test('legacy video tag format remains parseable', () => {
  const tag = encodeQdnVideoTag({
    service: 'VIDEO',
    name: 'Alice',
    identifier: 'qdbm-video-existing',
    title: 'Existing video',
    source: 'qdn',
  });
  const parsed = parseQdnVideoTagPayload(tag.slice(10, -11));
  assertEqual(
    parsed?.identifier,
    'qdbm-video-existing',
    'video id must survive'
  );
});

test('attachment type and product-size rules remain explicit', () => {
  const supported = new File(['text'], 'notes.txt', { type: 'text/plain' });
  const unsupported = new File(['image'], 'photo.png', { type: 'image/png' });
  const zip = new File(['zip'], 'archive.zip', { type: 'application/zip' });
  assert(isAllowedAttachmentFile(supported), 'TXT must remain supported');
  assert(
    !isAllowedAttachmentFile(unsupported),
    'PNG attachment is unsupported'
  );
  assertEqual(
    getAttachmentSizeLimit(zip),
    10 * 1024 * 1024,
    'ZIP product limit must remain 10 MiB'
  );
});

test('file publication payload cannot carry post authority or snapshot fields', async () => {
  const harness = createHarness();
  await harness.run();
  const publish = harness.calls.find(
    (call) => call.action === 'PUBLISH_QDN_RESOURCE'
  );
  assert(publish, 'file resource must be published');
  for (const forbidden of [
    'post',
    'author',
    'creator',
    'updatedAt',
    'owner',
    'authority',
  ]) {
    assert(!(forbidden in publish), `${forbidden} must not enter file publish`);
  }
});

test('confirmed attachment references enter Post state only through V2 owner policy', () => {
  const attachment = {
    id: 'attachment-1',
    service: 'FILE',
    name: 'Alice',
    identifier: 'qdbm-att-authoritative',
    filename: 'notes.txt',
    mimeType: 'text/plain',
    size: 12,
  };
  const post = buildV2PostEnvelope({
    entityType: 'post',
    entityId: 'post-with-attachment',
    parentThreadId: 'thread-1',
    parentPostId: null,
    publisherName: 'Alice',
    walletAddress: 'wallet-1',
    content: 'Post',
  });
  const edit = buildV2OwnerEditEnvelope(
    {
      operation: 'owner-edit',
      targetType: 'post',
      targetId: post.targetId,
      publisherName: 'Alice',
      walletAddress: 'wallet-1',
      changes: { attachments: [attachment] },
    },
    'qdbm-v2-edit-attachment'
  );
  const identity: IdentityValidator = {
    validatePublisher: (
      metadata: { publisherName: string },
      claimed: string
    ) =>
      metadata.publisherName === claimed
        ? { ok: true }
        : {
            ok: false,
            code: 'IDENTITY_UNVERIFIED',
            detail: 'publisher mismatch',
          },
    validateWalletBinding: (_name: string, wallet: string) =>
      wallet === 'wallet-1'
        ? { ok: true }
        : {
            ok: false,
            code: 'IDENTITY_UNVERIFIED',
            detail: 'wallet mismatch',
          },
  };
  const reduced = reduceV2RuntimeRecords(
    [
      {
        metadata: {
          service: 'DOCUMENT',
          publisherName: 'Alice',
          identifier: post.recordId,
          created: 1,
          updated: 1,
          latestSignature: 'create-signature',
        },
        envelope: post,
      },
      {
        metadata: {
          service: 'DOCUMENT',
          publisherName: 'Alice',
          identifier: edit.recordId,
          created: 2,
          updated: 2,
          latestSignature: 'edit-signature',
        },
        envelope: edit,
      },
    ],
    identity
  );
  const authoritative = reduced.authoritative.entities[post.targetId];
  assert(
    authoritative?.entityType === 'post' &&
      authoritative.attachments?.[0]?.identifier === attachment.identifier,
    'validated owner edit must establish the attachment reference'
  );
  assert(
    !isV2EntityEnvelope({
      ...post,
      body: {
        ...post.body,
        attachments: [{ ...attachment, size: 10 * 1024 * 1024 + 1 }],
      },
    }),
    'oversized V2 attachment reference must be malformed'
  );
  const forbidden = buildV2OwnerEditEnvelope(
    {
      ...edit.body,
      changes: { attachments: [{ ...attachment, unexpected: true }] },
    },
    'qdbm-v2-edit-malformed-attachment'
  );
  const rejected = reduceV2RuntimeRecords(
    [
      {
        metadata: {
          service: 'DOCUMENT',
          publisherName: 'Alice',
          identifier: post.recordId,
          created: 1,
          updated: 1,
          latestSignature: 'create-signature',
        },
        envelope: post,
      },
      {
        metadata: {
          service: 'DOCUMENT',
          publisherName: 'Alice',
          identifier: forbidden.recordId,
          created: 2,
          updated: 2,
          latestSignature: 'bad-edit-signature',
        },
        envelope: forbidden,
      },
    ],
    identity
  );
  assert(
    rejected.diagnostics.some((item) => item.code === 'FORBIDDEN_FIELD'),
    'malformed attachment owner edit must be rejected by field policy'
  );
});

test('forum image, attachment, and video services use the centralized transport', async () => {
  const existing = Object.getOwnPropertyDescriptor(globalThis, 'qdnRequest');
  const bridgeCalls: Record<string, unknown>[] = [];
  const published = new Map<string, Record<string, unknown>>();
  const largeFiles = [
    new File([new Uint8Array(QDN_INLINE_FILE_MAX_BYTES + 1)], 'large.zip', {
      type: 'application/zip',
    }),
    new File([new Uint8Array(QDN_INLINE_FILE_MAX_BYTES + 1)], 'large.webm', {
      type: 'video/webm',
    }),
  ];
  let selectionIndex = 0;
  Object.defineProperty(globalThis, 'qdnRequest', {
    configurable: true,
    value: async (payload: Record<string, unknown>) => {
      bridgeCalls.push(payload);
      if (payload.action === 'SEARCH_QDN_RESOURCES') {
        const key = `${String(payload.service)}:${String(payload.name)}:${String(payload.identifier)}`;
        const match = published.get(key);
        return match ? [match] : [];
      }
      if (payload.action === 'SELECT_QDN_PUBLISH_SOURCE') {
        const file = largeFiles[selectionIndex];
        selectionIndex += 1;
        return {
          canceled: false,
          sourceToken: `service-token-${selectionIndex}`,
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
        };
      }
      if (payload.action === 'PUBLISH_QDN_RESOURCE') {
        const key = `${String(payload.service)}:${String(payload.name)}:${String(payload.identifier)}`;
        published.set(key, {
          service: payload.service,
          name: payload.name,
          identifier: payload.identifier,
        });
        return {
          accepted: true,
          transactionSignature: `service-signature-${published.size}`,
        };
      }
      throw new Error(`Unexpected action ${String(payload.action)}`);
    },
  });

  try {
    const image = new File([new Uint8Array(32)], 'small.png', {
      type: 'image/png',
    });
    const imageReference = await forumQdnService.publishPostImage(
      image,
      'Alice'
    );
    const attachmentReference = await forumQdnService.publishPostAttachment(
      largeFiles[0],
      'Alice'
    );
    const videoReference = await forumQdnService.publishPostVideo(
      largeFiles[1],
      'Alice'
    );

    assert(
      imageReference.identifier.includes('-img-'),
      'image service must return its media identifier'
    );
    assert(
      attachmentReference.identifier.includes('-att-'),
      'attachment service must return its media identifier'
    );
    assert(
      videoReference.identifier.includes('-video-'),
      'video service must return its media identifier'
    );
    const mediaPublishes = bridgeCalls.filter(
      (call) => call.action === 'PUBLISH_QDN_RESOURCE'
    );
    assertEqual(mediaPublishes.length, 3, 'all three service paths publish');
    assert('data64' in mediaPublishes[0], 'small image stays bounded inline');
    assert(
      mediaPublishes.slice(1).every((call) => 'sourceToken' in call),
      'large attachment and video use source tokens'
    );
    assert(
      mediaPublishes.slice(1).every((call) => !('data64' in call)),
      'large service paths never include inline data'
    );
  } finally {
    if (existing) Object.defineProperty(globalThis, 'qdnRequest', existing);
    else Reflect.deleteProperty(globalThis, 'qdnRequest');
  }
});

test('bridge diagnostics are stable across repeated resolution', () => {
  const environment = { globalScope: { qdnRequest: 'invalid' } };
  assertEqual(
    resolveQortiumRequestBridge(environment).status,
    resolveQortiumRequestBridge(environment).status,
    'bridge classification must not change across retry/reload'
  );
});

let passed = 0;
for (const entry of tests) {
  await entry.run();
  passed += 1;
  console.log(`ok ${passed} - ${entry.name}`);
}
console.log(`Qortium bridge/publication tests passed (${passed}).`);
