import i18n from '../../i18n/index.js';
import { beginStartupRequest } from '../perf/startupDiagnostics.js';
const isObject = (value) => {
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
    'GET_HOME_SETTINGS',
    'FETCH_NODE_API',
]);
export class QortiumRequestError extends Error {
    code;
    constructor(code, detail) {
        super(`[${code}] ${detail}`);
        this.name = 'QortiumRequestError';
        this.code = code;
    }
}
const parseRequestError = (response) => {
    if (response === null || response === undefined) {
        return 'Qortium request returned an empty response.';
    }
    if (typeof response === 'string') {
        const trimmed = response.trim();
        if (!trimmed) {
            return 'Qortium request returned an empty response.';
        }
        if (trimmed.toLowerCase() === 'false' ||
            trimmed.toLowerCase().startsWith('error')) {
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
const parseMultiResourcePublishError = (response) => {
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
const isBridgeRequestFunction = (value) => {
    return typeof value === 'function';
};
const readProperty = (target, property) => {
    if ((typeof target !== 'object' || target === null) &&
        typeof target !== 'function') {
        return { status: 'UNAVAILABLE' };
    }
    try {
        if (!Reflect.has(target, property)) {
            return { status: 'UNAVAILABLE' };
        }
        return { status: 'AVAILABLE', value: Reflect.get(target, property) };
    }
    catch {
        return { status: 'INACCESSIBLE' };
    }
};
const inspectBridgeProperty = (target, source) => {
    const result = readProperty(target, 'qdnRequest');
    if (result.status !== 'AVAILABLE') {
        return { status: result.status, source };
    }
    if (!isBridgeRequestFunction(result.value)) {
        return {
            status: result.value === null || result.value === undefined
                ? 'UNAVAILABLE'
                : 'MALFORMED',
            source,
        };
    }
    return {
        status: 'AVAILABLE',
        source,
        bridge: { request: result.value },
    };
};
const defaultBridgeEnvironment = () => ({
    globalScope: globalThis,
    windowScope: typeof window === 'undefined' ? undefined : window,
});
export const resolveQortiumRequestBridge = (environment = defaultBridgeEnvironment()) => {
    const candidates = [{ source: 'globalThis', target: environment.globalScope }];
    if (environment.windowScope !== undefined) {
        candidates.push({ source: 'window', target: environment.windowScope });
        for (const source of ['parent', 'top']) {
            const frame = readProperty(environment.windowScope, source);
            if (frame.status === 'AVAILABLE') {
                candidates.push({ source, target: frame.value });
            }
            else if (frame.status === 'INACCESSIBLE') {
                candidates.push({ source, inaccessible: true });
            }
        }
    }
    let failure = {
        status: 'UNAVAILABLE',
    };
    for (const candidate of candidates) {
        const resolution = candidate.inaccessible
            ? { status: 'INACCESSIBLE', source: candidate.source }
            : inspectBridgeProperty(candidate.target, candidate.source);
        if (resolution.status === 'AVAILABLE') {
            return resolution;
        }
        if (failure.status === 'UNAVAILABLE' &&
            resolution.status !== 'UNAVAILABLE') {
            failure = resolution;
        }
    }
    return failure;
};
export const isQortiumRequestAvailable = () => {
    return resolveQortiumRequestBridge().status === 'AVAILABLE';
};
const sleep = async (durationMs) => {
    await new Promise((resolve) => {
        setTimeout(resolve, durationMs);
    });
};
const waitForQortiumRequest = async () => {
    const immediate = resolveQortiumRequestBridge();
    if (immediate.status === 'AVAILABLE') {
        return immediate;
    }
    let latest = immediate;
    const startedAt = Date.now();
    while (Date.now() - startedAt < QORTIUM_REQUEST_WAIT_MS) {
        await sleep(QORTIUM_REQUEST_POLL_MS);
        latest = resolveQortiumRequestBridge();
        if (latest.status === 'AVAILABLE') {
            return latest;
        }
    }
    return latest;
};
const toBridgeError = (resolution) => {
    if (resolution.status === 'MALFORMED') {
        return new QortiumRequestError('BRIDGE_MALFORMED', i18n.t('bridge.malformed'));
    }
    if (resolution.status === 'INACCESSIBLE') {
        return new QortiumRequestError('BRIDGE_INACCESSIBLE', i18n.t('bridge.inaccessible'));
    }
    return new QortiumRequestError('BRIDGE_UNAVAILABLE', i18n.t('bridge.unavailable'));
};
export const requestQortium = async (payload, options) => {
    const action = typeof payload.action === 'string' ? payload.action : 'UNKNOWN_ACTION';
    const service = typeof payload.service === 'string' ? payload.service : undefined;
    const identifier = typeof payload.identifier === 'string' ? payload.identifier : undefined;
    const label = [action, service, identifier].filter(Boolean).join(':');
    const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const maxAttempts = READ_ACTIONS.has(action) ? READ_RETRY_COUNT + 1 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const endDiagnostic = beginStartupRequest({
            caller: 'requestQortium',
            action,
            service,
            nameFilter: typeof payload.name === 'string' ? payload.name : undefined,
            identifier,
            offset: typeof payload.offset === 'number' ? payload.offset : undefined,
            limit: typeof payload.limit === 'number' ? payload.limit : undefined,
            retry: attempt,
        });
        const resolution = await waitForQortiumRequest();
        if (resolution.status !== 'AVAILABLE') {
            endDiagnostic('error', { detail: resolution.status });
            throw toBridgeError(resolution);
        }
        let didTimeout = false;
        const baseRequestPromise = Promise.resolve().then(() => resolution.bridge.request(payload));
        baseRequestPromise.catch(() => {
            if (!didTimeout) {
                return;
            }
        });
        let timeoutHandle = null;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => {
                didTimeout = true;
                reject(new QortiumRequestError('REQUEST_TIMEOUT', `Qortium request timed out after ${timeoutMs / 1000} seconds (${label}).`));
            }, timeoutMs);
        });
        try {
            const response = (await Promise.race([
                baseRequestPromise,
                timeoutPromise,
            ]));
            const requestError = parseRequestError(response);
            if (requestError) {
                throw new Error(requestError);
            }
            endDiagnostic(Array.isArray(response) && response.length === 0 ? 'empty' : 'success', {
                resultCount: Array.isArray(response) ? response.length : undefined,
            });
            return response;
        }
        catch (error) {
            endDiagnostic(error instanceof QortiumRequestError && error.code === 'REQUEST_TIMEOUT'
                ? 'timeout'
                : 'error', {
                detail: error instanceof QortiumRequestError
                    ? error.code
                    : error instanceof Error
                        ? error.name
                        : 'unknown-error',
            });
            if (attempt >= maxAttempts) {
                throw error;
            }
            await sleep(READ_RETRY_DELAY_MS * attempt);
        }
        finally {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
        }
    }
    throw new Error(`QDN request failed (${label}).`);
};
export const publishMultipleQortiumResources = async (resources, options) => {
    if (resources.length === 0) {
        return [];
    }
    const response = await requestQortium({
        action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
        resources,
    }, options);
    const publishError = parseMultiResourcePublishError(response);
    if (publishError) {
        throw new Error(publishError);
    }
    return response;
};
