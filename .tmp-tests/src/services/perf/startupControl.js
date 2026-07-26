export class StartupTimeoutError extends Error {
    constructor(label, timeoutMs) {
        super(`${label} timed out after ${timeoutMs} ms.`);
        this.name = 'StartupTimeoutError';
    }
}
export const withStartupTimeout = async (promise, timeoutMs, label) => {
    let timeoutHandle;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timeoutHandle = setTimeout(() => reject(new StartupTimeoutError(label, timeoutMs)), timeoutMs);
            }),
        ]);
    }
    finally {
        if (timeoutHandle !== undefined)
            clearTimeout(timeoutHandle);
    }
};
export const preserveStartupDebugQuery = (sourceSearch, targetSearch = '') => {
    const source = new URLSearchParams(sourceSearch);
    const target = new URLSearchParams(targetSearch);
    if (source.get('debugStartup') === '1')
        target.set('debugStartup', '1');
    const serialized = target.toString();
    return serialized ? `?${serialized}` : '';
};
const resourceStatus = (value) => {
    if (typeof value === 'string')
        return value.trim().toUpperCase();
    if (typeof value === 'object' &&
        value !== null &&
        'status' in value &&
        typeof value.status === 'string') {
        return value.status.trim().toUpperCase();
    }
    return '';
};
export const selectReadyDerivedCopies = (resources) => {
    const ready = resources.filter((resource) => resourceStatus(resource.status) === 'READY');
    return {
        candidates: ready.length > 0 ? ready : resources,
        skippedUnavailableCount: ready.length > 0 ? resources.length - ready.length : 0,
    };
};
