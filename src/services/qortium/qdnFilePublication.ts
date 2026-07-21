import { QortiumRequestError, requestQortium } from './qortiumClient.js';

export const QDN_INLINE_FILE_MAX_BYTES = 2 * 1024 * 1024;
export const QDN_HOME_SOURCE_MAX_BYTES = 100 * 1024 * 1024;

const RECOVERY_STORAGE_KEY = 'qdb-qdn-file-publication-recovery-v1';
const DEFAULT_CONFIRMATION_ATTEMPTS = 5;
const DEFAULT_CONFIRMATION_DELAY_MS = 1500;

export type QdnFilePublicationErrorCode =
  | 'USER_CANCELLED'
  | 'FILE_TOO_LARGE'
  | 'SOURCE_TOKEN_FAILED'
  | 'SOURCE_FILE_MISMATCH'
  | 'FILE_PREPARATION_FAILED'
  | 'PUBLICATION_REJECTED'
  | 'PUBLICATION_FAILED'
  | 'CONFIRMATION_UNAVAILABLE'
  | 'RETRY_REQUIRED'
  | 'POSSIBLE_ALREADY_PUBLISHED';

export type QdnFileTransport = 'inline-base64' | 'home-source-token';

export type QdnFileResourceReference = {
  service: string;
  name: string;
  identifier: string;
  filename: string;
  mimeType: string;
  size: number;
};

export type QdnFilePublicationRecovery = {
  schemaVersion: 1;
  fileKey: string;
  resource: QdnFileResourceReference;
  lastModified: number;
  stage:
    | 'PREPARED'
    | 'POSSIBLE_ALREADY_PUBLISHED'
    | 'SUBMITTED'
    | 'CONFIRMATION_UNAVAILABLE'
    | 'CONFIRMED';
  transport?: QdnFileTransport;
  transactionSignature?: string;
  createdAt: number;
  updatedAt: number;
};

export type QdnFilePublicationResult = {
  status: 'CONFIRMED';
  resource: QdnFileResourceReference;
  transport: QdnFileTransport;
  transactionSignature?: string;
  reused: boolean;
};

export type QdnPublishFile = {
  name: string;
  type: string;
  size: number;
  lastModified: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export class QdnFilePublicationError extends Error {
  readonly code: QdnFilePublicationErrorCode;
  readonly recovery?: QdnFilePublicationRecovery;

  constructor(
    code: QdnFilePublicationErrorCode,
    detail: string,
    recovery?: QdnFilePublicationRecovery
  ) {
    super(`[${code}] ${detail}`);
    this.name = 'QdnFilePublicationError';
    this.code = code;
    this.recovery = recovery;
  }
}

export type QdnFilePublicationRecoveryStore = {
  get: (fileKey: string) => QdnFilePublicationRecovery | undefined;
  put: (recovery: QdnFilePublicationRecovery) => void;
  remove: (fileKey: string) => void;
  isDurable?: () => boolean;
};

type QdnFilePublicationDependencies = {
  request: (
    payload: Record<string, unknown>,
    options?: { timeoutMs?: number }
  ) => Promise<unknown>;
  encodeInline: (file: QdnPublishFile) => Promise<string>;
  wait: (durationMs: number) => Promise<void>;
  now: () => number;
  recoveryStore: QdnFilePublicationRecoveryStore;
  confirmationAttempts: number;
  confirmationDelayMs: number;
};

type QdnFilePublicationInput = {
  file: QdnPublishFile;
  service: string;
  name: string;
  identifier: string;
  timeoutMs?: number;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const RECOVERY_STAGES: ReadonlySet<string> = new Set([
  'PREPARED',
  'POSSIBLE_ALREADY_PUBLISHED',
  'SUBMITTED',
  'CONFIRMATION_UNAVAILABLE',
  'CONFIRMED',
]);

const isRecoveryRecord = (
  value: unknown
): value is QdnFilePublicationRecovery => {
  if (!isObject(value) || !isObject(value.resource)) return false;
  const resource = value.resource;
  return (
    value.schemaVersion === 1 &&
    typeof value.fileKey === 'string' &&
    typeof value.lastModified === 'number' &&
    Number.isFinite(value.lastModified) &&
    typeof value.stage === 'string' &&
    RECOVERY_STAGES.has(value.stage) &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt) &&
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt) &&
    typeof resource.service === 'string' &&
    Boolean(resource.service) &&
    typeof resource.name === 'string' &&
    Boolean(resource.name) &&
    typeof resource.identifier === 'string' &&
    Boolean(resource.identifier) &&
    typeof resource.filename === 'string' &&
    typeof resource.mimeType === 'string' &&
    typeof resource.size === 'number' &&
    Number.isSafeInteger(resource.size) &&
    resource.size >= 0 &&
    (value.transport === undefined ||
      value.transport === 'inline-base64' ||
      value.transport === 'home-source-token') &&
    (value.transactionSignature === undefined ||
      typeof value.transactionSignature === 'string')
  );
};

const sleep = async (durationMs: number) => {
  await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
};

const fileToBoundedBase64 = async (file: QdnPublishFile) => {
  if (file.size > QDN_INLINE_FILE_MAX_BYTES) {
    throw new QdnFilePublicationError(
      'FILE_PREPARATION_FAILED',
      'Large resources must use a Qortium Home source token; inline encoding was refused.'
    );
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const chunkSize = 0x8000;
    let binary = '';
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(
        ...bytes.subarray(index, index + chunkSize)
      );
    }
    return btoa(binary);
  } catch (error) {
    if (error instanceof QdnFilePublicationError) throw error;
    throw new QdnFilePublicationError(
      'FILE_PREPARATION_FAILED',
      'The selected file could not be prepared for bounded inline publication.'
    );
  }
};

const parseRecoveryMap = (raw: string | null) => {
  if (!raw) return {} as Record<string, QdnFilePublicationRecovery>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, QdnFilePublicationRecovery] =>
          isRecoveryRecord(entry[1]) && entry[1].fileKey === entry[0]
      )
    );
  } catch {
    return {};
  }
};

const memoryRecoveryRecords = new Map<string, QdnFilePublicationRecovery>();

const browserRecoveryStore: QdnFilePublicationRecoveryStore = {
  get(fileKey) {
    const memory = memoryRecoveryRecords.get(fileKey);
    if (memory) return memory;
    if (typeof window === 'undefined') return undefined;
    try {
      const stored = parseRecoveryMap(
        window.localStorage.getItem(RECOVERY_STORAGE_KEY)
      )[fileKey];
      if (stored) memoryRecoveryRecords.set(fileKey, stored);
      return stored;
    } catch {
      return undefined;
    }
  },
  put(recovery) {
    memoryRecoveryRecords.set(recovery.fileKey, recovery);
    if (typeof window === 'undefined') return;
    try {
      const records = parseRecoveryMap(
        window.localStorage.getItem(RECOVERY_STORAGE_KEY)
      );
      records[recovery.fileKey] = recovery;
      window.localStorage.setItem(
        RECOVERY_STORAGE_KEY,
        JSON.stringify(records)
      );
    } catch {
      // Recovery persistence is best effort; the resource identifier remains
      // stable for the lifetime of the active command.
    }
  },
  remove(fileKey) {
    memoryRecoveryRecords.delete(fileKey);
    if (typeof window === 'undefined') return;
    try {
      const records = parseRecoveryMap(
        window.localStorage.getItem(RECOVERY_STORAGE_KEY)
      );
      delete records[fileKey];
      window.localStorage.setItem(
        RECOVERY_STORAGE_KEY,
        JSON.stringify(records)
      );
    } catch {
      // Ignore unavailable browser storage.
    }
  },
  isDurable() {
    if (typeof window === 'undefined') return false;
    const probeKey = `${RECOVERY_STORAGE_KEY}-probe`;
    try {
      window.localStorage.setItem(probeKey, '1');
      window.localStorage.removeItem(probeKey);
      return true;
    } catch {
      return false;
    }
  },
};

const defaultDependencies: QdnFilePublicationDependencies = {
  request: (payload, options) => requestQortium<unknown>(payload, options),
  encodeInline: fileToBoundedBase64,
  wait: sleep,
  now: Date.now,
  recoveryStore: browserRecoveryStore,
  confirmationAttempts: DEFAULT_CONFIRMATION_ATTEMPTS,
  confirmationDelayMs: DEFAULT_CONFIRMATION_DELAY_MS,
};

const toFileKey = (input: QdnFilePublicationInput) =>
  [
    input.service,
    input.name.trim().toLowerCase(),
    input.file.name,
    input.file.type,
    input.file.size,
    input.file.lastModified,
  ].join('\u0000');

export const sanitizeQdnSourceFilename = (
  value: string,
  fallback = 'resource'
) => {
  const normalized = [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || '<>:"/\\|?*'.includes(character) ? '_' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return normalized || fallback;
};

const isExactResource = (value: unknown, resource: QdnFileResourceReference) =>
  isObject(value) &&
  typeof value.name === 'string' &&
  value.name.trim().toLowerCase() === resource.name.trim().toLowerCase() &&
  value.identifier === resource.identifier &&
  (typeof value.service !== 'string' || value.service === resource.service);

const findExistingResource = async (
  resource: QdnFileResourceReference,
  dependencies: QdnFilePublicationDependencies
): Promise<'FOUND' | 'MISSING' | 'UNAVAILABLE'> => {
  try {
    const response = await dependencies.request({
      action: 'SEARCH_QDN_RESOURCES',
      service: resource.service,
      name: resource.name,
      exactMatchNames: true,
      identifier: resource.identifier,
      prefix: false,
      mode: 'ALL',
      includeMetadata: true,
      includeStatus: true,
      limit: 20,
      offset: 0,
    });
    if (!Array.isArray(response)) return 'UNAVAILABLE';
    return response.some((entry) => isExactResource(entry, resource))
      ? 'FOUND'
      : 'MISSING';
  } catch (error) {
    if (error instanceof QortiumRequestError) throw error;
    return 'UNAVAILABLE';
  }
};

const confirmPublication = async (
  resource: QdnFileResourceReference,
  dependencies: QdnFilePublicationDependencies
) => {
  let sawAvailableSearch = false;
  for (
    let attempt = 0;
    attempt < dependencies.confirmationAttempts;
    attempt += 1
  ) {
    const result = await findExistingResource(resource, dependencies);
    if (result === 'FOUND') return 'FOUND' as const;
    if (result === 'MISSING') sawAvailableSearch = true;
    if (attempt < dependencies.confirmationAttempts - 1) {
      await dependencies.wait(dependencies.confirmationDelayMs);
    }
  }
  return sawAvailableSearch ? ('MISSING' as const) : ('UNAVAILABLE' as const);
};

const parseSourceSelection = (
  response: unknown,
  file: QdnPublishFile
): {
  sourceToken: string;
  filename: string;
  mimeType: string;
  size: number;
} => {
  if (isObject(response) && response.canceled === true) {
    throw new QdnFilePublicationError(
      'USER_CANCELLED',
      'Large-file selection was canceled in Qortium Home.'
    );
  }
  if (
    !isObject(response) ||
    response.canceled !== false ||
    typeof response.sourceToken !== 'string' ||
    !response.sourceToken.trim() ||
    typeof response.fileName !== 'string' ||
    typeof response.size !== 'number' ||
    !Number.isSafeInteger(response.size)
  ) {
    throw new QdnFilePublicationError(
      'SOURCE_TOKEN_FAILED',
      'Qortium Home did not return a valid file source token.'
    );
  }

  const expectedName = sanitizeQdnSourceFilename(file.name, 'file');
  const selectedMime =
    typeof response.mimeType === 'string' ? response.mimeType.trim() : '';
  if (
    response.fileName !== expectedName ||
    response.size !== file.size ||
    (file.type && selectedMime && file.type !== selectedMime)
  ) {
    throw new QdnFilePublicationError(
      'SOURCE_FILE_MISMATCH',
      'The Qortium Home selection does not match the file selected in the editor.'
    );
  }

  return {
    sourceToken: response.sourceToken,
    filename: response.fileName,
    mimeType: selectedMime || file.type || 'application/octet-stream',
    size: response.size,
  };
};

const parsePublishResponse = (response: unknown) => {
  if (isObject(response) && response.accepted === false) {
    throw new QdnFilePublicationError(
      'PUBLICATION_REJECTED',
      'Qortium Home rejected the QDN publication.'
    );
  }
  if (!isObject(response) || response.accepted !== true) {
    throw new QdnFilePublicationError(
      'PUBLICATION_FAILED',
      'Qortium Home returned an invalid publication result.'
    );
  }
  return typeof response.transactionSignature === 'string'
    ? response.transactionSignature
    : undefined;
};

const isKnownCancellation = (error: unknown) =>
  error instanceof Error && /cancel(?:ed|led)/i.test(error.message);

const isKnownRejection = (error: unknown) =>
  error instanceof Error &&
  /\b(?:denied|declined|rejected|not authorized|not approved)\b/i.test(
    error.message
  );

const isKnownSourceTokenFailure = (error: unknown) =>
  error instanceof Error &&
  /(?:source token|selected source).*(?:expired|invalid|missing|not found|unavailable)/i.test(
    error.message
  );

const makeRecovery = (
  input: QdnFilePublicationInput,
  resource: QdnFileResourceReference,
  dependencies: QdnFilePublicationDependencies,
  existing?: QdnFilePublicationRecovery
): QdnFilePublicationRecovery => {
  const now = dependencies.now();
  return {
    schemaVersion: 1,
    fileKey: toFileKey(input),
    resource,
    lastModified: input.file.lastModified,
    stage: 'PREPARED',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
};

export const publishQdnFileResource = async (
  input: QdnFilePublicationInput,
  dependencyOverrides: Partial<QdnFilePublicationDependencies> = {}
): Promise<QdnFilePublicationResult> => {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  if (input.file.size > QDN_HOME_SOURCE_MAX_BYTES) {
    throw new QdnFilePublicationError(
      'FILE_TOO_LARGE',
      'The selected file exceeds the verified 100 MiB Qortium Home publication limit.'
    );
  }
  if (
    typeof window !== 'undefined' &&
    dependencies.recoveryStore.isDurable?.() === false
  ) {
    throw new QdnFilePublicationError(
      'RETRY_REQUIRED',
      'Durable browser recovery storage is unavailable. Publication was not started because an ambiguous result could not be recovered safely after reload.'
    );
  }

  const fileKey = toFileKey(input);
  const stored = dependencies.recoveryStore.get(fileKey);
  const resource: QdnFileResourceReference = stored?.resource ?? {
    service: input.service,
    name: input.name,
    identifier: input.identifier,
    filename: input.file.name,
    mimeType: input.file.type || 'application/octet-stream',
    size: input.file.size,
  };
  const transport: QdnFileTransport =
    input.file.size <= QDN_INLINE_FILE_MAX_BYTES
      ? 'inline-base64'
      : 'home-source-token';

  const existing = await findExistingResource(resource, dependencies);
  if (existing === 'FOUND') {
    const confirmed: QdnFilePublicationRecovery = {
      ...(stored ?? makeRecovery(input, resource, dependencies)),
      stage: 'CONFIRMED',
      transport: stored?.transport ?? transport,
      updatedAt: dependencies.now(),
    };
    dependencies.recoveryStore.put(confirmed);
    return {
      status: 'CONFIRMED',
      resource,
      transport: confirmed.transport ?? transport,
      transactionSignature: confirmed.transactionSignature,
      reused: true,
    };
  }
  if (existing === 'UNAVAILABLE' && stored) {
    throw new QdnFilePublicationError(
      'RETRY_REQUIRED',
      'A prior publication attempt exists, but QDN cannot currently confirm it. No duplicate publication was attempted.',
      stored
    );
  }
  if (existing === 'MISSING' && stored && stored.stage !== 'PREPARED') {
    throw new QdnFilePublicationError(
      'POSSIBLE_ALREADY_PUBLISHED',
      'A prior submit may still be propagating even though exact discovery is currently empty. No automatic republication was attempted.',
      stored
    );
  }
  if (existing === 'UNAVAILABLE') {
    throw new QdnFilePublicationError(
      'CONFIRMATION_UNAVAILABLE',
      'QDN availability could not be checked before publication. Retry when resource discovery is available.'
    );
  }

  let data64: string | undefined;
  let sourceToken: string | undefined;
  if (transport === 'inline-base64') {
    data64 = await dependencies.encodeInline(input.file);
  } else {
    let selection: unknown;
    try {
      selection = await dependencies.request({
        action: 'SELECT_QDN_PUBLISH_SOURCE',
        kind: 'file',
      });
    } catch (error) {
      if (isKnownCancellation(error)) {
        throw new QdnFilePublicationError(
          'USER_CANCELLED',
          'Large-file selection was canceled in Qortium Home.'
        );
      }
      if (error instanceof QortiumRequestError) throw error;
      throw new QdnFilePublicationError(
        'SOURCE_TOKEN_FAILED',
        'Qortium Home could not prepare the selected large file.'
      );
    }
    const selected = parseSourceSelection(selection, input.file);
    sourceToken = selected.sourceToken;
    resource.filename = selected.filename;
    resource.mimeType = selected.mimeType;
    resource.size = selected.size;
  }

  let recovery = makeRecovery(input, resource, dependencies, stored);
  recovery = {
    ...recovery,
    stage: 'POSSIBLE_ALREADY_PUBLISHED',
    transport,
    updatedAt: dependencies.now(),
  };
  dependencies.recoveryStore.put(recovery);

  let transactionSignature: string | undefined;
  try {
    const response = await dependencies.request(
      {
        action: 'PUBLISH_QDN_RESOURCE',
        service: resource.service,
        name: resource.name,
        identifier: resource.identifier,
        filename: resource.filename,
        ...(data64 !== undefined ? { data64 } : { sourceToken }),
      },
      { timeoutMs: input.timeoutMs }
    );
    transactionSignature = parsePublishResponse(response);
  } catch (error) {
    if (isKnownCancellation(error)) {
      dependencies.recoveryStore.remove(fileKey);
      throw new QdnFilePublicationError(
        'USER_CANCELLED',
        'QDN publication was canceled in Qortium Home.'
      );
    }
    if (
      error instanceof QortiumRequestError &&
      error.code !== 'REQUEST_TIMEOUT'
    ) {
      dependencies.recoveryStore.remove(fileKey);
      throw error;
    }
    if (isKnownSourceTokenFailure(error)) {
      dependencies.recoveryStore.remove(fileKey);
      throw new QdnFilePublicationError(
        'SOURCE_TOKEN_FAILED',
        'Qortium Home could not use the selected file source token.'
      );
    }
    if (isKnownRejection(error)) {
      dependencies.recoveryStore.remove(fileKey);
      throw new QdnFilePublicationError(
        'PUBLICATION_REJECTED',
        'Qortium Home rejected the QDN publication.'
      );
    }
    if (
      error instanceof QdnFilePublicationError &&
      error.code === 'PUBLICATION_REJECTED'
    ) {
      dependencies.recoveryStore.remove(fileKey);
      throw error;
    }
    recovery = { ...recovery, updatedAt: dependencies.now() };
    dependencies.recoveryStore.put(recovery);
    if (
      error instanceof QdnFilePublicationError &&
      error.code === 'PUBLICATION_FAILED'
    ) {
      throw new QdnFilePublicationError(
        'PUBLICATION_FAILED',
        `${error.message.slice(error.message.indexOf(']') + 1).trim()} Retry will check the same identifier before sending anything again.`,
        recovery
      );
    }
    throw new QdnFilePublicationError(
      'POSSIBLE_ALREADY_PUBLISHED',
      'The publication result is unknown. Retry will check the same identifier before sending anything again.',
      recovery
    );
  }

  recovery = {
    ...recovery,
    stage: 'SUBMITTED',
    transactionSignature,
    updatedAt: dependencies.now(),
  };
  dependencies.recoveryStore.put(recovery);

  const confirmation = await confirmPublication(resource, dependencies);
  if (confirmation !== 'FOUND') {
    recovery = {
      ...recovery,
      stage: 'CONFIRMATION_UNAVAILABLE',
      updatedAt: dependencies.now(),
    };
    dependencies.recoveryStore.put(recovery);
    throw new QdnFilePublicationError(
      'CONFIRMATION_UNAVAILABLE',
      'Publication was accepted, but QDN has not confirmed the resource. Select the same file again later; the existing identifier will be checked before any retry.',
      recovery
    );
  }

  recovery = {
    ...recovery,
    stage: 'CONFIRMED',
    updatedAt: dependencies.now(),
  };
  dependencies.recoveryStore.put(recovery);
  return {
    status: 'CONFIRMED',
    resource,
    transport,
    transactionSignature,
    reused: false,
  };
};
