import type {
  NativePollRecovery,
  NativePollReference,
  NativePollSelectionMode,
} from './types.js';

export type NativePollDiagnosticCode =
  | 'MALFORMED_POLL_REFERENCE'
  | 'MISSING_POLL_ID'
  | 'NATIVE_POLL_UNAVAILABLE'
  | 'INVALID_OPTION_SELECTION'
  | 'UNSUPPORTED_CAPABILITY'
  | 'POLL_CREATION_FAILED'
  | 'POLL_REFERENCE_PUBLICATION_FAILED'
  | 'POLL_VOTE_FAILED'
  | 'POLL_UPDATE_REJECTED'
  | 'POLL_IDENTITY_MISMATCH'
  | 'INCONSISTENT_LEGACY_NATIVE_POLL';

export type NativePollDiagnostic = {
  code: NativePollDiagnosticCode;
  detail: string;
};

export type NativePollCoreData = {
  pollId: number;
  creatorPublicKey?: string;
  owner: string;
  pollName: string;
  description: string;
  pollOptions: Array<{ optionName: string }>;
  published: number;
  startTime?: number | null;
  endTime?: number | null;
};

export type NativePollCoreVotes = {
  totalVotes: number;
  totalVoters: number;
  totalWeight?: number;
  rawTotalWeight?: number;
  voteCounts?: Record<string, number>;
  voteWeights?: Record<string, number | { effective?: number; raw?: number }>;
  voteDetails?: Array<{
    voterAddress?: string;
    optionIndexes?: number[];
    optionIndex?: number;
  }>;
};

export type NativePollRuntime = {
  availability: 'available' | 'unavailable' | 'inconsistent';
  question: string;
  description: string;
  selectionMode: NativePollSelectionMode;
  options: Array<{
    index: number;
    id: string;
    label: string;
    rawVoteCount: number;
    effectiveWeight: number | null;
    rawWeight: number | null;
  }>;
  startsAt: string | null;
  closesAt: string | null;
  isStarted: boolean;
  isClosed: boolean;
  totalSelections: number;
  totalVoters: number;
  totalEffectiveWeight: number | null;
  totalRawWeight: number | null;
  currentUserOptionIndexes: number[];
  diagnostics: NativePollDiagnostic[];
};

export type NativePostPoll = NativePollReference & {
  runtime?: NativePollRuntime;
};

export type NativePollDefinition = NativePollReference['displayCache'];

export type NativePollCreateResult = {
  pollId: number | null;
  transactionSignature: string;
};

export type NativePollGateway = {
  createPoll: (input: {
    pollName: string;
    owner: string;
    definition: NativePollDefinition;
  }) => Promise<NativePollCreateResult>;
  getPollByName: (pollName: string) => Promise<NativePollCoreData | null>;
  getPollById: (pollId: number) => Promise<NativePollCoreData | null>;
  getPollVotes: (pollId: number) => Promise<NativePollCoreVotes>;
  vote: (pollId: number, optionIndexes: number[]) => Promise<string>;
  updatePoll: (input: {
    poll: NativePollCoreData;
    endTime: number;
  }) => Promise<string>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

const codedError = (
  code: NativePollDiagnosticCode,
  error: unknown,
  fallback: string
) => {
  const detail = error instanceof Error ? error.message : fallback;
  return new Error(
    detail.startsWith('[') ? detail : `[${code}] ${detail || fallback}`
  );
};

const isNullableIsoDate = (value: unknown) =>
  value === null ||
  (typeof value === 'string' &&
    value.trim().length > 0 &&
    !Number.isNaN(new Date(value).getTime()));

export const isNativePollReference = (
  value: unknown
): value is NativePollReference => {
  if (!isRecord(value) || !isRecord(value.displayCache)) return false;
  const cache = value.displayCache;
  if (!Array.isArray(cache.options)) return false;
  return (
    hasOnlyKeys(value, [
      'kind',
      'schema',
      'schemaVersion',
      'pollId',
      'pollName',
      'creatorName',
      'creatorAddress',
      'creationSignature',
      'provenance',
      'status',
      'displayCache',
    ]) &&
    value.kind === 'native' &&
    value.schema === 'qdb-native-poll' &&
    value.schemaVersion === 1 &&
    Number.isSafeInteger(value.pollId) &&
    Number(value.pollId) > 0 &&
    typeof value.pollName === 'string' &&
    value.pollName.trim().length > 0 &&
    typeof value.creatorName === 'string' &&
    value.creatorName.trim().length > 0 &&
    typeof value.creatorAddress === 'string' &&
    value.creatorAddress.trim().length > 0 &&
    typeof value.creationSignature === 'string' &&
    value.creationSignature.trim().length > 0 &&
    value.provenance === 'qortium-core' &&
    value.status === 'confirmed' &&
    hasOnlyKeys(cache, [
      'question',
      'description',
      'selectionMode',
      'options',
      'startsAt',
      'closesAt',
    ]) &&
    typeof cache.question === 'string' &&
    cache.question.trim().length > 0 &&
    typeof cache.description === 'string' &&
    (cache.selectionMode === 'single' || cache.selectionMode === 'multiple') &&
    cache.options.length >= 2 &&
    cache.options.every(
      (option, offset) =>
        isRecord(option) &&
        hasOnlyKeys(option, ['index', 'label']) &&
        option.index === offset + 1 &&
        typeof option.label === 'string' &&
        option.label.trim().length > 0
    ) &&
    isNullableIsoDate(cache.startsAt) &&
    isNullableIsoDate(cache.closesAt)
  );
};

export const classifyInvalidNativePollReference = (
  value: unknown
): NativePollDiagnosticCode => {
  if (
    isRecord(value) &&
    value.schema === 'qdb-native-poll' &&
    (!Number.isSafeInteger(value.pollId) || Number(value.pollId) <= 0)
  ) {
    return 'MISSING_POLL_ID';
  }
  return 'MALFORMED_POLL_REFERENCE';
};

export const isNativePostPoll = (value: unknown): value is NativePostPoll => {
  if (!isRecord(value)) return false;
  const reference = { ...value };
  delete reference.runtime;
  return isNativePollReference(reference);
};

export const sameNativePollReference = (
  left: NativePollReference | null | undefined,
  right: NativePollReference | null | undefined
) => {
  if (!left || !right) return !left && !right;
  return (
    left.pollId === right.pollId &&
    left.pollName === right.pollName &&
    left.creatorName === right.creatorName &&
    left.creatorAddress === right.creatorAddress &&
    left.creationSignature === right.creationSignature &&
    left.provenance === right.provenance &&
    left.status === right.status &&
    left.displayCache.question === right.displayCache.question &&
    left.displayCache.description === right.displayCache.description &&
    left.displayCache.selectionMode === right.displayCache.selectionMode &&
    left.displayCache.startsAt === right.displayCache.startsAt &&
    left.displayCache.closesAt === right.displayCache.closesAt &&
    left.displayCache.options.length === right.displayCache.options.length &&
    left.displayCache.options.every(
      (option, index) =>
        option.index === right.displayCache.options[index]?.index &&
        option.label === right.displayCache.options[index]?.label
    )
  );
};

export const toPersistedNativePollReference = (
  poll: NativePostPoll
): NativePollReference => ({
  kind: poll.kind,
  schema: poll.schema,
  schemaVersion: poll.schemaVersion,
  pollId: poll.pollId,
  pollName: poll.pollName,
  creatorName: poll.creatorName,
  creatorAddress: poll.creatorAddress,
  creationSignature: poll.creationSignature,
  provenance: poll.provenance,
  status: poll.status,
  displayCache: poll.displayCache,
});

export const encodeNativePollDefinition = (definition: NativePollDefinition) =>
  JSON.stringify({
    schema: 'qdb-native-poll-definition',
    schemaVersion: 1,
    question: definition.question,
    description: definition.description,
    selectionMode: definition.selectionMode,
  });

export const decodeNativePollDefinition = (
  description: string
): Omit<NativePollDefinition, 'options' | 'startsAt' | 'closesAt'> | null => {
  try {
    const value: unknown = JSON.parse(description);
    if (!isRecord(value)) return null;
    if (
      value.schema !== 'qdb-native-poll-definition' ||
      value.schemaVersion !== 1 ||
      typeof value.question !== 'string' ||
      !value.question.trim() ||
      typeof value.description !== 'string' ||
      (value.selectionMode !== 'single' && value.selectionMode !== 'multiple')
    ) {
      return null;
    }
    return {
      question: value.question,
      description: value.description,
      selectionMode: value.selectionMode,
    };
  } catch {
    return null;
  }
};

export const buildNativePollName = (postId: string) => `qdb-${postId}`;

export const buildNativePollRecovery = (input: {
  postId: string;
  pollName: string;
  creatorName: string;
  creatorAddress: string;
  creationSignature: string;
  pollId?: number | null;
  definition: NativePollDefinition;
}): NativePollRecovery => ({
  schema: 'qdb-native-poll-recovery',
  schemaVersion: 1,
  postId: input.postId,
  pollName: input.pollName,
  creatorName: input.creatorName,
  creatorAddress: input.creatorAddress,
  creationSignature: input.creationSignature,
  pollId: input.pollId ?? null,
  definition: input.definition,
});

export const referenceFromRecovery = (
  recovery: NativePollRecovery,
  poll: NativePollCoreData
): NativePollReference => {
  const confirmedDefinition = decodeNativePollDefinition(poll.description);
  const expectedStart = recovery.definition.startsAt
    ? new Date(recovery.definition.startsAt).getTime()
    : null;
  const expectedEnd = recovery.definition.closesAt
    ? new Date(recovery.definition.closesAt).getTime()
    : null;
  const confirmedStart = poll.startTime ?? null;
  const confirmedEnd = poll.endTime ?? null;
  const definitionMatches =
    confirmedDefinition?.question === recovery.definition.question &&
    confirmedDefinition.description === recovery.definition.description &&
    confirmedDefinition.selectionMode === recovery.definition.selectionMode &&
    poll.pollOptions.length === recovery.definition.options.length &&
    poll.pollOptions.every(
      (option, index) =>
        option.optionName === recovery.definition.options[index]?.label
    ) &&
    confirmedStart === expectedStart &&
    confirmedEnd === expectedEnd;
  if (
    poll.pollId <= 0 ||
    poll.pollName !== recovery.pollName ||
    poll.owner.trim() !== recovery.creatorAddress.trim() ||
    !definitionMatches
  ) {
    throw new Error(
      '[POLL_IDENTITY_MISMATCH] confirmed native poll identity or definition does not match its recovery record'
    );
  }
  return {
    kind: 'native',
    schema: 'qdb-native-poll',
    schemaVersion: 1,
    pollId: poll.pollId,
    pollName: poll.pollName,
    creatorName: recovery.creatorName,
    creatorAddress: recovery.creatorAddress,
    creationSignature: recovery.creationSignature,
    provenance: 'qortium-core',
    status: 'confirmed',
    displayCache: {
      ...recovery.definition,
      startsAt:
        typeof poll.startTime === 'number'
          ? new Date(poll.startTime).toISOString()
          : null,
      closesAt:
        typeof poll.endTime === 'number'
          ? new Date(poll.endTime).toISOString()
          : null,
    },
  };
};

export const confirmNativePoll = async (
  recovery: NativePollRecovery,
  gateway: Pick<NativePollGateway, 'getPollByName' | 'getPollById'>
) => {
  const poll = recovery.pollId
    ? await gateway.getPollById(recovery.pollId)
    : await gateway.getPollByName(recovery.pollName);
  return poll ? referenceFromRecovery(recovery, poll) : null;
};

export const publishNativePollReference = async <T>(
  reference: NativePollReference,
  recovery: NativePollRecovery,
  publish: (reference: NativePollReference) => Promise<T>
): Promise<
  | { ok: true; value: T }
  | {
      ok: false;
      code: 'POLL_REFERENCE_PUBLICATION_FAILED';
      detail: string;
      recovery: NativePollRecovery;
    }
> => {
  if (
    reference.pollName !== recovery.pollName ||
    reference.creatorAddress !== recovery.creatorAddress ||
    reference.creationSignature !== recovery.creationSignature ||
    (recovery.pollId !== null && reference.pollId !== recovery.pollId)
  ) {
    return {
      ok: false,
      code: 'POLL_REFERENCE_PUBLICATION_FAILED',
      detail: 'confirmed poll reference does not match its recovery evidence',
      recovery,
    };
  }
  try {
    return { ok: true, value: await publish(reference) };
  } catch (error) {
    return {
      ok: false,
      code: 'POLL_REFERENCE_PUBLICATION_FAILED',
      detail:
        error instanceof Error
          ? error.message
          : 'native poll Post reference publication failed',
      recovery,
    };
  }
};

export const createNativePoll = async (
  input: {
    postId: string;
    creatorName: string;
    creatorAddress: string;
    definition: NativePollDefinition;
  },
  gateway: Pick<
    NativePollGateway,
    'createPoll' | 'getPollByName' | 'getPollById'
  >
): Promise<{
  reference: NativePollReference | null;
  recovery: NativePollRecovery;
}> => {
  const pollName = buildNativePollName(input.postId);
  let created: NativePollCreateResult;
  try {
    created = await gateway.createPoll({
      pollName,
      owner: input.creatorAddress,
      definition: input.definition,
    });
  } catch (error) {
    throw codedError(
      'POLL_CREATION_FAILED',
      error,
      'native poll creation failed'
    );
  }
  if (!created.transactionSignature.trim()) {
    throw new Error(
      '[POLL_CREATION_FAILED] native poll transaction signature is missing'
    );
  }
  const recovery = buildNativePollRecovery({
    ...input,
    pollName,
    creationSignature: created.transactionSignature,
    pollId: created.pollId,
  });
  let reference: NativePollReference | null = null;
  try {
    reference = await confirmNativePoll(recovery, gateway);
  } catch {
    // Creation is already authoritative once Home returns its transaction
    // signature. A read failure must preserve recovery instead of risking a
    // duplicate CREATE_POLL on retry.
  }
  return {
    recovery: reference ? { ...recovery, pollId: reference.pollId } : recovery,
    reference,
  };
};

const toFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const reduceNativePollState = (
  reference: NativePollReference,
  poll: NativePollCoreData,
  votes: NativePollCoreVotes,
  currentWalletAddress?: string | null,
  now = Date.now()
): NativePollRuntime => {
  const diagnostics: NativePollDiagnostic[] = [];
  const definition = decodeNativePollDefinition(poll.description);
  if (
    poll.pollId !== reference.pollId ||
    poll.pollName !== reference.pollName ||
    poll.owner.trim() !== reference.creatorAddress.trim()
  ) {
    diagnostics.push({
      code: 'POLL_IDENTITY_MISMATCH',
      detail: 'Core poll identity does not match the Post poll reference',
    });
  }
  if (!definition) {
    diagnostics.push({
      code: 'INCONSISTENT_LEGACY_NATIVE_POLL',
      detail: 'Core poll does not contain a valid Discussion Boards definition',
    });
  }
  const source = definition ?? reference.displayCache;
  const counts = votes.voteCounts ?? {};
  const weights = votes.voteWeights ?? {};
  const options = poll.pollOptions.map((option, offset) => {
    const weight = weights[option.optionName];
    const effectiveWeight =
      typeof weight === 'number'
        ? weight
        : isRecord(weight)
          ? toFiniteNumber(weight.effective)
          : null;
    const rawWeight = isRecord(weight) ? toFiniteNumber(weight.raw) : null;
    return {
      index: offset + 1,
      id: `native:${offset + 1}`,
      label: option.optionName,
      rawVoteCount: toFiniteNumber(counts[option.optionName]) ?? 0,
      effectiveWeight,
      rawWeight,
    };
  });
  const currentVote = votes.voteDetails?.find(
    (vote) =>
      currentWalletAddress &&
      vote.voterAddress?.trim() === currentWalletAddress.trim()
  );
  const currentUserOptionIndexes = currentVote
    ? Array.isArray(currentVote.optionIndexes)
      ? currentVote.optionIndexes
      : typeof currentVote.optionIndex === 'number'
        ? [currentVote.optionIndex]
        : []
    : [];
  const startsAt =
    typeof poll.startTime === 'number'
      ? new Date(poll.startTime).toISOString()
      : null;
  const closesAt =
    typeof poll.endTime === 'number'
      ? new Date(poll.endTime).toISOString()
      : null;
  return {
    availability: diagnostics.length === 0 ? 'available' : 'inconsistent',
    question: source.question,
    description: source.description,
    selectionMode: source.selectionMode,
    options,
    startsAt,
    closesAt,
    isStarted: poll.startTime == null || poll.startTime <= now,
    isClosed: poll.endTime != null && poll.endTime <= now,
    totalSelections: toFiniteNumber(votes.totalVotes) ?? 0,
    totalVoters: toFiniteNumber(votes.totalVoters) ?? 0,
    totalEffectiveWeight: toFiniteNumber(votes.totalWeight),
    totalRawWeight: toFiniteNumber(votes.rawTotalWeight),
    currentUserOptionIndexes: [...new Set(currentUserOptionIndexes)]
      .filter((index) => Number.isSafeInteger(index) && index > 0)
      .sort((a, b) => a - b),
    diagnostics,
  };
};

export const unavailableNativePollState = (
  reference: NativePollReference,
  detail: string
): NativePollRuntime => ({
  availability: 'unavailable',
  question: reference.displayCache.question,
  description: reference.displayCache.description,
  selectionMode: reference.displayCache.selectionMode,
  options: reference.displayCache.options.map((option) => ({
    ...option,
    id: `native:${option.index}`,
    rawVoteCount: 0,
    effectiveWeight: null,
    rawWeight: null,
  })),
  startsAt: reference.displayCache.startsAt,
  closesAt: reference.displayCache.closesAt,
  isStarted: false,
  isClosed: false,
  totalSelections: 0,
  totalVoters: 0,
  totalEffectiveWeight: null,
  totalRawWeight: null,
  currentUserOptionIndexes: [],
  diagnostics: [{ code: 'NATIVE_POLL_UNAVAILABLE', detail }],
});

export const validateNativeOptionSelection = (
  reference: NativePollReference,
  optionIndexes: number[]
) => {
  const unique = [...new Set(optionIndexes)].sort((a, b) => a - b);
  const optionCount = reference.displayCache.options.length;
  if (
    unique.length === 0 ||
    unique.some(
      (index) =>
        !Number.isSafeInteger(index) || index < 1 || index > optionCount
    ) ||
    (reference.displayCache.selectionMode === 'single' && unique.length !== 1)
  ) {
    return {
      ok: false as const,
      code: 'INVALID_OPTION_SELECTION' as const,
      detail: 'selected native poll option indexes are invalid',
    };
  }
  return { ok: true as const, optionIndexes: unique };
};

export const submitNativePollVote = async (
  reference: NativePollReference,
  optionIndexes: number[],
  gateway: Pick<NativePollGateway, 'vote'>
) => {
  const selection = validateNativeOptionSelection(reference, optionIndexes);
  if (selection.ok === false) {
    throw new Error(`[${selection.code}] ${selection.detail}`);
  }
  let transactionSignature: string;
  try {
    transactionSignature = await gateway.vote(
      reference.pollId,
      selection.optionIndexes
    );
  } catch (error) {
    throw codedError('POLL_VOTE_FAILED', error, 'native poll vote failed');
  }
  if (!transactionSignature.trim()) {
    throw new Error('[POLL_VOTE_FAILED] native vote signature is missing');
  }
  return { transactionSignature, optionIndexes: selection.optionIndexes };
};
