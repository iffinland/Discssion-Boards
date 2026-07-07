declare const qdnRequest: unknown;

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const REQUEST_TIMEOUT_MS = 120_000;
const QORTIUM_REQUEST_WAIT_MS = 4000;
const QORTIUM_REQUEST_POLL_MS = 200;
const READ_RETRY_COUNT = 2;
const READ_RETRY_DELAY_MS = 500;
const READ_ACTIONS = new Set([
  'FETCH_QDN_RESOURCE',
  'SEARCH_QDN_RESOURCES',
  'GET_QDN_RESOURCE_STATUS',
  'GET_QDN_RESOURCE_PROPERTIES',
  'GET_QDN_RESOURCE_METADATA',
  'GET_QDN_RESOURCE_URL',
  'GET_SELECTED_ACCOUNT',
  'GET_ACCOUNT_NAMES',
  'GET_NAME_DATA',
  'GET_LIST',
  'GET_BALANCE',
]);

type RequestBridge = {
  request: (payload: Record<string, unknown>) => Promise<unknown> | unknown;
};

type BridgeRequestFunction = RequestBridge['request'];

interface QortiumRequestOptions {
  timeoutMs?: number;
}

export type QortiumResourceToPublish = {
  service: string;
  identifier: string;
  name?: string;
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  data64: string;
  filename?: string;
  disableEncrypt?: boolean;
};

const parseRequestError = (response: unknown): string | null => {
  if (response === null || response === undefined) {
    return 'Qortium request returned an empty response.';
  }

  if (typeof response === 'string') {
    const trimmed = response.trim();

    if (!trimmed) {
      return 'Qortium request returned an empty response.';
    }

    if (
      trimmed.toLowerCase() === 'false' ||
      trimmed.toLowerCase().startsWith('error')
    ) {
      return trimmed;
    }

    return null;
  }

  if (!isObject(response)) {
    return null;
  }

  if (typeof response.error === 'string' && response.error.trim()) {
    return response.error;
  }

  if (typeof response.message === 'string' && response.message.trim()) {
    return response.message;
  }

  if (response.error === true || response.success === false) {
    return 'Qortium request failed.';
  }

  return null;
};

const parseMultiResourcePublishError = (response: unknown): string | null => {
  if (!Array.isArray(response)) {
    return null;
  }

  const failedIndex = response.findIndex((entry) => parseRequestError(entry));
  if (failedIndex === -1) {
    return null;
  }

  const entryError = parseRequestError(response[failedIndex]);
  return entryError
    ? `Qortium resource publish failed at item ${failedIndex + 1}: ${entryError}`
    : `Qortium resource publish failed at item ${failedIndex + 1}.`;
};

const isBridgeRequestFunction = (
  value: unknown
): value is BridgeRequestFunction => {
  return typeof value === 'function';
};

const getWindowBridge = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const localRequest = (window as unknown as { qdnRequest?: unknown })
    .qdnRequest;
  if (isBridgeRequestFunction(localRequest)) {
    return localRequest;
  }

  let parentRequest: unknown = null;
  try {
    parentRequest = (window as unknown as { parent?: { qdnRequest?: unknown } })
      .parent?.qdnRequest;
  } catch {
    parentRequest = null;
  }

  if (isBridgeRequestFunction(parentRequest)) {
    return parentRequest;
  }

  let topRequest: unknown = null;
  try {
    topRequest = (window as unknown as { top?: { qdnRequest?: unknown } }).top
      ?.qdnRequest;
  } catch {
    topRequest = null;
  }

  if (isBridgeRequestFunction(topRequest)) {
    return topRequest;
  }

  return null;
};

const getRequestBridge = (): RequestBridge | null => {
  if (isBridgeRequestFunction(qdnRequest)) {
    return { request: qdnRequest };
  }

  const globalQdnRequest = (
    globalThis as typeof globalThis & { qdnRequest?: unknown }
  ).qdnRequest;
  if (isBridgeRequestFunction(globalQdnRequest)) {
    return { request: globalQdnRequest };
  }

  const windowQdnRequest = getWindowBridge();
  if (isBridgeRequestFunction(windowQdnRequest)) {
    return { request: windowQdnRequest };
  }

  return null;
};

export const isQortiumRequestAvailable = () => {
  return getRequestBridge() !== null;
};

const sleep = async (durationMs: number) => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
};

const waitForQortiumRequest = async () => {
  const immediate = getRequestBridge();
  if (immediate) {
    return immediate;
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < QORTIUM_REQUEST_WAIT_MS) {
    await sleep(QORTIUM_REQUEST_POLL_MS);
    const bridge = getRequestBridge();
    if (bridge) {
      return bridge;
    }
  }

  return null;
};

export const requestQortium = async <TResponse>(
  payload: Record<string, unknown>,
  options?: QortiumRequestOptions
): Promise<TResponse> => {
  const action =
    typeof payload.action === 'string' ? payload.action : 'UNKNOWN_ACTION';
  const service =
    typeof payload.service === 'string' ? payload.service : undefined;
  const identifier =
    typeof payload.identifier === 'string' ? payload.identifier : undefined;
  const label = [action, service, identifier].filter(Boolean).join(':');
  const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const maxAttempts = READ_ACTIONS.has(action) ? READ_RETRY_COUNT + 1 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const bridge = await waitForQortiumRequest();

    if (!bridge) {
      throw new Error(
        'QDN request interface is not available in this environment.'
      );
    }

    let didTimeout = false;
    const baseRequestPromise = Promise.resolve(bridge.request(payload));
    baseRequestPromise.catch(() => {
      if (!didTimeout) {
        return;
      }
    });

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        didTimeout = true;
        reject(
          new Error(
            `Qortium request timed out after ${timeoutMs / 1000} seconds (${label}).`
          )
        );
      }, timeoutMs);
    });

    try {
      const response = (await Promise.race([
        baseRequestPromise,
        timeoutPromise,
      ])) as unknown;

      const requestError = parseRequestError(response);
      if (requestError) {
        throw new Error(requestError);
      }

      return response as TResponse;
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }

      await sleep(READ_RETRY_DELAY_MS * attempt);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  throw new Error(`QDN request failed (${label}).`);
};

export const publishMultipleQortiumResources = async (
  resources: QortiumResourceToPublish[],
  options?: QortiumRequestOptions
) => {
  if (resources.length === 0) {
    return [];
  }

  const response = await requestQortium<unknown>(
    {
      action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
      resources,
    },
    options
  );

  const publishError = parseMultiResourcePublishError(response);
  if (publishError) {
    throw new Error(publishError);
  }

  return response;
};
