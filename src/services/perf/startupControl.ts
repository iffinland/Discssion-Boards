export class StartupTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs} ms.`);
    this.name = 'StartupTimeoutError';
  }
}

export const withStartupTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new StartupTimeoutError(label, timeoutMs)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
};

export const preserveStartupDebugQuery = (
  sourceSearch: string,
  targetSearch = ''
) => {
  const source = new URLSearchParams(sourceSearch);
  const target = new URLSearchParams(targetSearch);
  if (source.get('debugStartup') === '1') target.set('debugStartup', '1');
  const serialized = target.toString();
  return serialized ? `?${serialized}` : '';
};

const resourceStatus = (value: unknown) => {
  if (typeof value === 'string') return value.trim().toUpperCase();
  if (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    typeof value.status === 'string'
  ) {
    return value.status.trim().toUpperCase();
  }
  return '';
};

export const selectReadyDerivedCopies = <T extends { status?: unknown }>(
  resources: T[]
) => {
  const ready = resources.filter(
    (resource) => resourceStatus(resource.status) === 'READY'
  );
  return {
    candidates: ready.length > 0 ? ready : resources,
    skippedUnavailableCount:
      ready.length > 0 ? resources.length - ready.length : 0,
  };
};
