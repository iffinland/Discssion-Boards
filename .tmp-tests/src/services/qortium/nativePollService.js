import { encodeNativePollDefinition, reduceNativePollState, unavailableNativePollState, } from '../architectureV2/polls.js';
import { requestQortium } from './qortiumClient.js';
export const buildCreatePollRequest = (input) => ({
    action: 'CREATE_POLL',
    pollName: input.pollName,
    owner: input.owner,
    description: encodeNativePollDefinition(input.definition),
    pollOptions: input.definition.options.map((option) => ({
        optionName: option.label,
    })),
    ...(input.definition.startsAt
        ? { startTime: new Date(input.definition.startsAt).getTime() }
        : {}),
    ...(input.definition.closesAt
        ? { endTime: new Date(input.definition.closesAt).getTime() }
        : {}),
    fee: 0,
});
export const buildVoteOnPollRequest = (pollId, optionIndexes) => ({
    action: 'VOTE_ON_POLL',
    pollId,
    optionIndexes,
    fee: 0,
});
export const buildUpdatePollRequest = (poll, endTime) => ({
    action: 'UPDATE_POLL',
    pollId: poll.pollId,
    newPollName: poll.pollName,
    newDescription: poll.description,
    newPollOptions: poll.pollOptions,
    ...(typeof poll.startTime === 'number'
        ? { newStartTime: poll.startTime }
        : {}),
    newEndTime: endTime,
    fee: 0,
});
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const parseSignature = (value, code) => {
    if (!isRecord(value) ||
        typeof value.transactionSignature !== 'string' ||
        !value.transactionSignature.trim()) {
        throw new Error(`[${code}] Qortium did not return a transaction signature`);
    }
    return value.transactionSignature;
};
const parseCorePoll = (value) => {
    if (!isRecord(value) || !Array.isArray(value.pollOptions))
        return null;
    const pollOptions = value.pollOptions
        .map((option) => isRecord(option) && typeof option.optionName === 'string'
        ? { optionName: option.optionName }
        : null)
        .filter((option) => option !== null);
    if (!Number.isSafeInteger(value.pollId) ||
        Number(value.pollId) <= 0 ||
        typeof value.owner !== 'string' ||
        typeof value.pollName !== 'string' ||
        typeof value.description !== 'string' ||
        typeof value.published !== 'number' ||
        pollOptions.length !== value.pollOptions.length) {
        return null;
    }
    return {
        pollId: Number(value.pollId),
        creatorPublicKey: typeof value.creatorPublicKey === 'string'
            ? value.creatorPublicKey
            : undefined,
        owner: value.owner,
        pollName: value.pollName,
        description: value.description,
        pollOptions,
        published: value.published,
        startTime: typeof value.startTime === 'number' ? value.startTime : null,
        endTime: typeof value.endTime === 'number' ? value.endTime : null,
    };
};
const parseCoreVotes = (value) => {
    if (!isRecord(value) ||
        typeof value.totalVotes !== 'number' ||
        typeof value.totalVoters !== 'number') {
        return null;
    }
    const voteCounts = {};
    if (Array.isArray(value.voteCounts)) {
        value.voteCounts.forEach((entry) => {
            if (isRecord(entry) &&
                typeof entry.optionName === 'string' &&
                typeof entry.voteCount === 'number') {
                voteCounts[entry.optionName] = entry.voteCount;
            }
        });
    }
    const voteWeights = {};
    if (Array.isArray(value.voteWeights)) {
        value.voteWeights.forEach((entry) => {
            if (isRecord(entry) && typeof entry.optionName === 'string') {
                voteWeights[entry.optionName] = {
                    effective: typeof entry.voteWeight === 'number' ? entry.voteWeight : undefined,
                    raw: typeof entry.rawVoteWeight === 'number'
                        ? entry.rawVoteWeight
                        : undefined,
                };
            }
        });
    }
    const voteDetails = Array.isArray(value.voteDetails)
        ? value.voteDetails
            .map((entry) => {
            if (!isRecord(entry))
                return null;
            return {
                voterAddress: typeof entry.voterAddress === 'string'
                    ? entry.voterAddress
                    : undefined,
                optionIndexes: Array.isArray(entry.optionIndexes)
                    ? entry.optionIndexes.filter((index) => typeof index === 'number' && Number.isSafeInteger(index))
                    : undefined,
                optionIndex: typeof entry.optionIndex === 'number'
                    ? entry.optionIndex
                    : undefined,
            };
        })
            .filter((entry) => entry !== null)
        : [];
    return {
        totalVotes: value.totalVotes,
        totalVoters: value.totalVoters,
        totalWeight: typeof value.totalWeight === 'number' ? value.totalWeight : undefined,
        rawTotalWeight: typeof value.rawTotalWeight === 'number'
            ? value.rawTotalWeight
            : undefined,
        voteCounts,
        voteWeights,
        voteDetails,
    };
};
const coreApiUrl = (path) => {
    const configured = import.meta.env?.VITE_QORTIUM_CORE_API_URL?.trim();
    if (configured)
        return new URL(path, configured).toString();
    if (typeof window === 'undefined') {
        throw new Error('[NATIVE_POLL_UNAVAILABLE] Qortium Core URL is unavailable outside the application runtime');
    }
    return new URL(path, window.location.origin).toString();
};
const fetchCoreJson = async (path) => {
    const response = await fetch(coreApiUrl(path), {
        method: 'GET',
        headers: { Accept: 'application/json' },
    });
    if (response.status === 404)
        return null;
    if (!response.ok) {
        throw new Error(`[NATIVE_POLL_UNAVAILABLE] Core poll request failed (${response.status})`);
    }
    return (await response.json());
};
export const qortiumNativePollGateway = {
    async createPoll(input) {
        const response = await requestQortium(buildCreatePollRequest(input));
        return {
            pollId: null,
            transactionSignature: parseSignature(response, 'POLL_CREATION_FAILED'),
        };
    },
    async getPollByName(pollName) {
        const value = await fetchCoreJson(`/polls/${encodeURIComponent(pollName)}`);
        return value === null ? null : parseCorePoll(value);
    },
    async getPollById(pollId) {
        const value = await fetchCoreJson(`/polls/id/${pollId}`);
        return value === null ? null : parseCorePoll(value);
    },
    async getPollVotes(pollId) {
        const value = await fetchCoreJson(`/polls/votes/id/${pollId}`);
        const parsed = parseCoreVotes(value);
        if (!parsed) {
            throw new Error('[NATIVE_POLL_UNAVAILABLE] Core poll results are malformed');
        }
        return parsed;
    },
    async vote(pollId, optionIndexes) {
        const response = await requestQortium(buildVoteOnPollRequest(pollId, optionIndexes));
        return parseSignature(response, 'POLL_VOTE_FAILED');
    },
    async updatePoll({ poll, endTime }) {
        const response = await requestQortium(buildUpdatePollRequest(poll, endTime));
        return parseSignature(response, 'POLL_UPDATE_REJECTED');
    },
};
export const loadNativePostPoll = async (reference, currentWalletAddress, gateway = qortiumNativePollGateway) => {
    try {
        const poll = await gateway.getPollById(reference.pollId);
        if (!poll) {
            return {
                ...reference,
                runtime: unavailableNativePollState(reference, 'Native poll is not currently available from Core'),
            };
        }
        const votes = await gateway.getPollVotes(reference.pollId);
        return {
            ...reference,
            runtime: reduceNativePollState(reference, poll, votes, currentWalletAddress),
        };
    }
    catch (error) {
        return {
            ...reference,
            runtime: unavailableNativePollState(reference, error instanceof Error ? error.message : 'Native poll is unavailable'),
        };
    }
};
export const closeNativePoll = async (reference, actorAddress, gateway = qortiumNativePollGateway) => {
    if (reference.creatorAddress.trim() !== actorAddress.trim()) {
        throw new Error('[POLL_IDENTITY_MISMATCH] only the native poll owner can update its schedule');
    }
    let poll;
    let votes;
    try {
        poll = await gateway.getPollById(reference.pollId);
        if (!poll)
            throw new Error('[NATIVE_POLL_UNAVAILABLE] native poll not found');
        votes = await gateway.getPollVotes(reference.pollId);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : '';
        throw new Error(detail.startsWith('[')
            ? detail
            : `[NATIVE_POLL_UNAVAILABLE] ${detail || 'native poll read failed'}`);
    }
    if (votes.totalVoters > 0) {
        throw new Error('[UNSUPPORTED_CAPABILITY] current Core cannot shorten or immediately close a poll after voting begins');
    }
    if (poll.endTime != null && poll.endTime <= Date.now()) {
        throw new Error('[POLL_UPDATE_REJECTED] native poll is already closed');
    }
    try {
        return await gateway.updatePoll({ poll, endTime: Date.now() + 60_000 });
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : '';
        throw new Error(detail.startsWith('[')
            ? detail
            : `[POLL_UPDATE_REJECTED] ${detail || 'native poll update failed'}`);
    }
};
export const nativePollService = {
    gateway: qortiumNativePollGateway,
    loadNativePostPoll,
    closeNativePoll,
};
