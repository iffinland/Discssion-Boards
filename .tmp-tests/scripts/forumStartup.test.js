import { readFile } from 'node:fs/promises';
import { configureStartupDiagnosticsForTest, getStartupDiagnosticsReport, recordStartupEvent, resetStartupDiagnosticsForTest, } from '../src/services/perf/startupDiagnostics.js';
import { preserveStartupDebugQuery, selectReadyDerivedCopies, StartupTimeoutError, withStartupTimeout, } from '../src/services/perf/startupControl.js';
import { requestQortium } from '../src/services/qortium/qortiumClient.js';
const assert = (condition, detail) => {
    if (!condition)
        throw new Error(`Assertion failed: ${detail}`);
};
const tests = [];
const test = (name, run) => tests.push({ name, run });
test('startup diagnostics are disabled by default', () => {
    configureStartupDiagnosticsForTest(false);
    resetStartupDiagnosticsForTest();
    recordStartupEvent('APP_START', { detail: 'ignored' });
    assert(getStartupDiagnosticsReport().events.length === 0, 'disabled diagnostics must not retain events');
});
test('enabled diagnostics are bounded and ordered', () => {
    configureStartupDiagnosticsForTest(true);
    resetStartupDiagnosticsForTest();
    for (let index = 0; index < 405; index += 1) {
        recordStartupEvent('STARTUP_STATE', { detail: `state-${index}` });
    }
    const report = getStartupDiagnosticsReport();
    assert(report.events.length === 400, 'diagnostics must retain at most 400');
    assert(report.events.every((event, index, events) => index === 0 || event.sequence > events[index - 1].sequence), 'events must remain ordered');
});
test('diagnostics redact secret-like detail and group duplicate requests', () => {
    resetStartupDiagnosticsForTest();
    recordStartupEvent('REQUEST_END', {
        action: 'SEARCH_QDN_RESOURCES',
        service: 'DOCUMENT',
        identifier: 'qdbm-topic-',
        durationMs: 12,
        completion: 'success',
        detail: 'privateKey=do-not-copy signature=also-secret',
    });
    recordStartupEvent('REQUEST_END', {
        action: 'SEARCH_QDN_RESOURCES',
        service: 'DOCUMENT',
        identifier: 'qdbm-topic-',
        durationMs: 8,
        completion: 'success',
    });
    const report = getStartupDiagnosticsReport();
    const serialized = JSON.stringify(report);
    assert(!serialized.includes('do-not-copy'), 'private key leaked');
    assert(!serialized.includes('also-secret'), 'signature leaked');
    assert(report.duplicateRequests[0]?.count === 2 &&
        report.duplicateRequests[0].cumulativeDurationMs === 20, 'duplicate request summary is incorrect');
});
test('request instrumentation records safe mocked bridge metadata', async () => {
    resetStartupDiagnosticsForTest();
    const scope = globalThis;
    const previous = scope.qdnRequest;
    scope.qdnRequest = async () => [{ identifier: 'qdbm-topic-1' }];
    try {
        await requestQortium({
            action: 'SEARCH_QDN_RESOURCES',
            service: 'DOCUMENT',
            identifier: 'qdbm-topic-',
            limit: 100,
            offset: 0,
        });
    }
    finally {
        if (previous)
            scope.qdnRequest = previous;
        else
            Reflect.deleteProperty(scope, 'qdnRequest');
    }
    const requestEnd = getStartupDiagnosticsReport().events.find((event) => event.name === 'REQUEST_END');
    assert(requestEnd?.resultCount === 1, 'result count was not recorded');
    assert(requestEnd.limit === 100, 'request limit was not recorded');
    assert(requestEnd.offset === 0, 'request offset was not recorded');
});
test('startup timeout bounds a slow request', async () => {
    try {
        await withStartupTimeout(new Promise(() => undefined), 5, 'slow discovery');
    }
    catch (error) {
        assert(error instanceof StartupTimeoutError, 'wrong timeout error');
        return;
    }
    throw new Error('Assertion failed: slow request did not time out');
});
test('normal, partial, empty, and failed results preserve their values', async () => {
    const normal = await withStartupTimeout(Promise.resolve({ completeness: 'complete', items: ['topic'] }), 50, 'normal');
    const partial = await withStartupTimeout(Promise.resolve({ completeness: 'partial', items: ['topic'] }), 50, 'partial');
    const empty = await withStartupTimeout(Promise.resolve({ completeness: 'complete', items: [] }), 50, 'empty');
    assert(normal.items.length === 1, 'normal result changed');
    assert(partial.completeness === 'partial', 'partial result changed');
    assert(empty.items.length === 0, 'empty result changed');
    try {
        await withStartupTimeout(Promise.reject(new Error('node down')), 50, 'fail');
    }
    catch (error) {
        assert(error instanceof Error, 'failed request was not preserved');
        return;
    }
    throw new Error('Assertion failed: failed request was accepted');
});
test('ready derived copies exclude unavailable duplicates', () => {
    const ready = { id: 'ready', status: { status: 'READY' } };
    const unavailable = { id: 'slow', status: 'DOWNLOADING' };
    const selected = selectReadyDerivedCopies([unavailable, ready]);
    assert(selected.candidates.length === 1 && selected.candidates[0]?.id === 'ready', 'ready copy was not preferred');
    assert(selected.skippedUnavailableCount === 1, 'skipped copy was not counted');
});
test('non-ready copies remain candidates when no ready copy exists', () => {
    const selected = selectReadyDerivedCopies([
        { id: 'published', status: 'PUBLISHED' },
        { id: 'unknown' },
    ]);
    assert(selected.candidates.length === 2, 'fallback candidates were removed');
    assert(selected.skippedUnavailableCount === 0, 'fallback must not claim skipped copies');
});
test('debug query survives share and direct-route normalization', () => {
    assert(preserveStartupDebugQuery('?thread=t1&debugStartup=1', '?post=p1') ===
        '?post=p1&debugStartup=1', 'thread redirect lost debug gate');
    assert(preserveStartupDebugQuery('?debugStartup=1') === '?debugStartup=1', 'direct route lost debug gate');
    assert(preserveStartupDebugQuery('?thread=t1', '?post=p1') === '?post=p1', 'normal routing gained debug UI');
});
test('runtime startup keeps authoritative discovery foreground-only', async () => {
    const source = await readFile('src/features/forum/hooks/useForumDataQuery.ts', 'utf8');
    const indexStart = source.indexOf('.loadTopicDirectoryIndex()');
    const authoritativeAwait = source.indexOf('let remoteData = await structurePromise');
    const fallbackAwait = source.indexOf('const nextTopicDirectoryIndex = await withStartupTimeout');
    assert(indexStart >= 0, 'background derived index is missing');
    assert(authoritativeAwait > indexStart, 'authoritative discovery did not start');
    assert(fallbackAwait > authoritativeAwait, 'derived index is awaited before authoritative failure');
    assert(source.includes("setStartupState('ready-partial', 'partial')"), 'partial fallback state is missing');
});
test('runtime startup supports guest reads, cancellation, stale guards, and retry', async () => {
    const source = await readFile('src/features/forum/hooks/useForumDataQuery.ts', 'utf8');
    assert(source.includes("detail: 'guest-read-mode'"), 'identity failure does not enter guest read mode');
    assert(source.includes('if (!active) return') && source.includes('active = false'), 'cancelled/stale work is not guarded');
    assert(source.includes('setRetryGeneration((current) => current + 1)'), 'retry cannot force a new generation');
    assert(!source.includes('await forumSearchIndexService.loadTopicDirectoryIndex();'), 'derived index still blocks startup');
});
test('Home settings remain outside the forum readiness dependency graph', async () => {
    const root = await readFile('src/RootApp.tsx', 'utf8');
    const provider = await readFile('src/context/DisplaySettingsContext.tsx', 'utf8');
    assert(provider.includes('void loadHomeDisplaySettings'), 'Home settings became blocking');
    assert(root.indexOf('<DisplaySettingsProvider>') < root.indexOf('<ForumProvider>'), 'provider composition unexpectedly changed');
});
let passed = 0;
for (const item of tests) {
    await item.run();
    passed += 1;
    console.log(`PASS ${item.name}`);
}
console.log(`Startup diagnostics tests passed: ${passed}`);
