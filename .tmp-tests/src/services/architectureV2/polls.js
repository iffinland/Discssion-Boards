const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value, allowed) => Object.keys(value).every((key) => allowed.includes(key));
const codedError = (code, error, fallback) => {
    const detail = error instanceof Error ? error.message : fallback;
    return new Error(detail.startsWith('[') ? detail : `[${code}] ${detail || fallback}`);
};
const isNullableIsoDate = (value) => value === null ||
    (typeof value === 'string' &&
        value.trim().length > 0 &&
        !Number.isNaN(new Date(value).getTime()));
export const isNativePollReference = (value) => {
    if (!isRecord(value) || !isRecord(value.displayCache))
        return false;
    const cache = value.displayCache;
    if (!Array.isArray(cache.options))
        return false;
    return (hasOnlyKeys(value, [
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
        cache.options.every((option, offset) => isRecord(option) &&
            hasOnlyKeys(option, ['index', 'label']) &&
            option.index === offset + 1 &&
            typeof option.label === 'string' &&
            option.label.trim().length > 0) &&
        isNullableIsoDate(cache.startsAt) &&
        isNullableIsoDate(cache.closesAt));
};
export const classifyInvalidNativePollReference = (value) => {
    if (isRecord(value) &&
        value.schema === 'qdb-native-poll' &&
        (!Number.isSafeInteger(value.pollId) || Number(value.pollId) <= 0)) {
        return 'MISSING_POLL_ID';
    }
    return 'MALFORMED_POLL_REFERENCE';
};
export const isNativePostPoll = (value) => {
    if (!isRecord(value))
        return false;
    const reference = { ...value };
    delete reference.runtime;
    return isNativePollReference(reference);
};
export const sameNativePollReference = (left, right) => {
    if (!left || !right)
        return !left && !right;
    return (left.pollId === right.pollId &&
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
        left.displayCache.options.every((option, index) => option.index === right.displayCache.options[index]?.index &&
            option.label === right.displayCache.options[index]?.label));
};
export const toPersistedNativePollReference = (poll) => ({
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
export const encodeNativePollDefinition = (definition) => JSON.stringify({
    schema: 'qdb-native-poll-definition',
    schemaVersion: 1,
    question: definition.question,
    description: definition.description,
    selectionMode: definition.selectionMode,
});
export const decodeNativePollDefinition = (description) => {
    try {
        const value = JSON.parse(description);
        if (!isRecord(value))
            return null;
        if (value.schema !== 'qdb-native-poll-definition' ||
            value.schemaVersion !== 1 ||
            typeof value.question !== 'string' ||
            !value.question.trim() ||
            typeof value.description !== 'string' ||
            (value.selectionMode !== 'single' && value.selectionMode !== 'multiple')) {
            return null;
        }
        return {
            question: value.question,
            description: value.description,
            selectionMode: value.selectionMode,
        };
    }
    catch {
        return null;
    }
};
export const buildNativePollName = (postId) => `qdb-${postId}`;
export const buildNativePollRecovery = (input) => ({
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
export const referenceFromRecovery = (recovery, poll) => {
    const confirmedDefinition = decodeNativePollDefinition(poll.description);
    const expectedStart = recovery.definition.startsAt
        ? new Date(recovery.definition.startsAt).getTime()
        : null;
    const expectedEnd = recovery.definition.closesAt
        ? new Date(recovery.definition.closesAt).getTime()
        : null;
    const confirmedStart = poll.startTime ?? null;
    const confirmedEnd = poll.endTime ?? null;
    const definitionMatches = confirmedDefinition?.question === recovery.definition.question &&
        confirmedDefinition.description === recovery.definition.description &&
        confirmedDefinition.selectionMode === recovery.definition.selectionMode &&
        poll.pollOptions.length === recovery.definition.options.length &&
        poll.pollOptions.every((option, index) => option.optionName === recovery.definition.options[index]?.label) &&
        confirmedStart === expectedStart &&
        confirmedEnd === expectedEnd;
    if (poll.pollId <= 0 ||
        poll.pollName !== recovery.pollName ||
        poll.owner.trim() !== recovery.creatorAddress.trim() ||
        !definitionMatches) {
        throw new Error('[POLL_IDENTITY_MISMATCH] confirmed native poll identity or definition does not match its recovery record');
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
            startsAt: typeof poll.startTime === 'number'
                ? new Date(poll.startTime).toISOString()
                : null,
            closesAt: typeof poll.endTime === 'number'
                ? new Date(poll.endTime).toISOString()
                : null,
        },
    };
};
export const confirmNativePoll = async (recovery, gateway) => {
    const poll = recovery.pollId
        ? await gateway.getPollById(recovery.pollId)
        : await gateway.getPollByName(recovery.pollName);
    return poll ? referenceFromRecovery(recovery, poll) : null;
};
export const publishNativePollReference = async (reference, recovery, publish) => {
    if (reference.pollName !== recovery.pollName ||
        reference.creatorAddress !== recovery.creatorAddress ||
        reference.creationSignature !== recovery.creationSignature ||
        (recovery.pollId !== null && reference.pollId !== recovery.pollId)) {
        return {
            ok: false,
            code: 'POLL_REFERENCE_PUBLICATION_FAILED',
            detail: 'confirmed poll reference does not match its recovery evidence',
            recovery,
        };
    }
    try {
        return { ok: true, value: await publish(reference) };
    }
    catch (error) {
        return {
            ok: false,
            code: 'POLL_REFERENCE_PUBLICATION_FAILED',
            detail: error instanceof Error
                ? error.message
                : 'native poll Post reference publication failed',
            recovery,
        };
    }
};
export const createNativePoll = async (input, gateway) => {
    const pollName = buildNativePollName(input.postId);
    let created;
    try {
        created = await gateway.createPoll({
            pollName,
            owner: input.creatorAddress,
            definition: input.definition,
        });
    }
    catch (error) {
        throw codedError('POLL_CREATION_FAILED', error, 'native poll creation failed');
    }
    if (!created.transactionSignature.trim()) {
        throw new Error('[POLL_CREATION_FAILED] native poll transaction signature is missing');
    }
    const recovery = buildNativePollRecovery({
        ...input,
        pollName,
        creationSignature: created.transactionSignature,
        pollId: created.pollId,
    });
    let reference = null;
    try {
        reference = await confirmNativePoll(recovery, gateway);
    }
    catch {
        // Creation is already authoritative once Home returns its transaction
        // signature. A read failure must preserve recovery instead of risking a
        // duplicate CREATE_POLL on retry.
    }
    return {
        recovery: reference ? { ...recovery, pollId: reference.pollId } : recovery,
        reference,
    };
};
const toFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
export const reduceNativePollState = (reference, poll, votes, currentWalletAddress, now = Date.now()) => {
    const diagnostics = [];
    const definition = decodeNativePollDefinition(poll.description);
    if (poll.pollId !== reference.pollId ||
        poll.pollName !== reference.pollName ||
        poll.owner.trim() !== reference.creatorAddress.trim()) {
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
        const effectiveWeight = typeof weight === 'number'
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
    const currentVote = votes.voteDetails?.find((vote) => currentWalletAddress &&
        vote.voterAddress?.trim() === currentWalletAddress.trim());
    const currentUserOptionIndexes = currentVote
        ? Array.isArray(currentVote.optionIndexes)
            ? currentVote.optionIndexes
            : typeof currentVote.optionIndex === 'number'
                ? [currentVote.optionIndex]
                : []
        : [];
    const startsAt = typeof poll.startTime === 'number'
        ? new Date(poll.startTime).toISOString()
        : null;
    const closesAt = typeof poll.endTime === 'number'
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
export const unavailableNativePollState = (reference, detail) => ({
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
export const validateNativeOptionSelection = (reference, optionIndexes) => {
    const unique = [...new Set(optionIndexes)].sort((a, b) => a - b);
    const optionCount = reference.displayCache.options.length;
    if (unique.length === 0 ||
        unique.some((index) => !Number.isSafeInteger(index) || index < 1 || index > optionCount) ||
        (reference.displayCache.selectionMode === 'single' && unique.length !== 1)) {
        return {
            ok: false,
            code: 'INVALID_OPTION_SELECTION',
            detail: 'selected native poll option indexes are invalid',
        };
    }
    return { ok: true, optionIndexes: unique };
};
export const submitNativePollVote = async (reference, optionIndexes, gateway) => {
    const selection = validateNativeOptionSelection(reference, optionIndexes);
    if (selection.ok === false) {
        throw new Error(`[${selection.code}] ${selection.detail}`);
    }
    let transactionSignature;
    try {
        transactionSignature = await gateway.vote(reference.pollId, selection.optionIndexes);
    }
    catch (error) {
        throw codedError('POLL_VOTE_FAILED', error, 'native poll vote failed');
    }
    if (!transactionSignature.trim()) {
        throw new Error('[POLL_VOTE_FAILED] native vote signature is missing');
    }
    return { transactionSignature, optionIndexes: selection.optionIndexes };
};
