const PERF_QUERY_PARAM = 'perf';
const PERF_STORAGE_KEY = 'forum-perf-debug';

const canUseWindow = typeof window !== 'undefined';
const isDevelopment = import.meta.env.DEV;

const canMeasurePerformance = () => {
  return canUseWindow && typeof window.performance?.now === 'function';
};

const shouldLogPerf = () => {
  return isDevelopment && isPerfDebugEnabled();
};

export const isPerfDebugEnabled = () => {
  if (!canUseWindow) {
    return false;
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get(PERF_QUERY_PARAM) === '1') {
    return true;
  }

  try {
    return window.localStorage.getItem(PERF_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

export const setPerfDebugEnabled = (enabled: boolean) => {
  if (!canUseWindow) {
    return;
  }

  try {
    if (enabled) {
      window.localStorage.setItem(PERF_STORAGE_KEY, '1');
      return;
    }

    window.localStorage.removeItem(PERF_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
};

export const perfDebugLog = (
  scope: string,
  payload: Record<string, unknown>
) => {
  if (!shouldLogPerf()) {
    return;
  }

  const timestamp = new Date().toISOString();
  console.info(`[perf][${scope}]`, { timestamp, ...payload });
};

export const perfDebugTimeStart = (
  scope: string,
  payload: Record<string, unknown> = {}
) => {
  if (!shouldLogPerf() || !canMeasurePerformance()) {
    return () => undefined;
  }

  const startedAt = window.performance.now();
  perfDebugLog(`${scope}:start`, payload);

  return (resultPayload: Record<string, unknown> = {}) => {
    const durationMs = Number(
      (window.performance.now() - startedAt).toFixed(1)
    );
    perfDebugLog(`${scope}:end`, {
      ...payload,
      ...resultPayload,
      durationMs,
    });
  };
};
