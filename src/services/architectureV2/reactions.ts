import type { QdbV2ResourceMetadata, RejectionCode } from './types.js';
import type { IdentityValidator } from './validation.js';
import { normalizeName, validateMetadata } from './validation.js';

export type ReactionState = 'active' | 'inactive';

export type ReactionBody = {
  operation: 'reaction';
  targetType: 'post';
  targetId: string;
  reaction: 'like';
  state: ReactionState;
  publisherName: string;
  walletAddress: string;
};

export type ReactionEnvelope = {
  schema: 'qdb-v2';
  schemaVersion: 2;
  kind: 'operation';
  recordType: 'reaction';
  recordId: string;
  targetId: string;
  body: ReactionBody;
  clientCreatedAt?: string;
};

export type ReactionRecord = {
  metadata: QdbV2ResourceMetadata;
  envelope: ReactionEnvelope;
};

export type DiscoveredReactionResource = {
  name?: string;
  identifier?: string;
  service?: string;
  created?: number;
  updated?: number | null;
  latestSignature?: string;
};

export type ReactionLoaderDependencies = {
  fetchPayload: (resource: DiscoveredReactionResource) => Promise<unknown>;
  resolveWalletAddress: (publisherName: string) => Promise<string | null>;
  expectedIdentifier: (body: ReactionBody) => Promise<string>;
};

export type ReactionEnvelopePublisher = (
  envelope: ReactionEnvelope
) => Promise<void>;

export type ReactionDiagnostic = {
  code:
    | RejectionCode
    | 'INVALID_REACTION_STATE'
    | 'TARGET_MISMATCH'
    | 'IDENTIFIER_MISMATCH'
    | 'MISSING_TRUSTED_METADATA'
    | 'UNAVAILABLE_RESOURCE';
  identifier: string;
  detail: string;
};

export type ReducedReactionState = {
  targetId: string;
  actors: Record<string, ReactionBody>;
  count: number;
  diagnostics: ReactionDiagnostic[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

export const isReactionEnvelope = (
  value: unknown
): value is ReactionEnvelope => {
  if (!isRecord(value) || !isRecord(value.body)) return false;
  const body = value.body;
  return (
    hasOnlyKeys(value, [
      'schema',
      'schemaVersion',
      'kind',
      'recordType',
      'recordId',
      'targetId',
      'body',
      'clientCreatedAt',
    ]) &&
    hasOnlyKeys(body, [
      'operation',
      'targetType',
      'targetId',
      'reaction',
      'state',
      'publisherName',
      'walletAddress',
    ]) &&
    value.schema === 'qdb-v2' &&
    value.schemaVersion === 2 &&
    value.kind === 'operation' &&
    value.recordType === 'reaction' &&
    typeof value.recordId === 'string' &&
    value.recordId.trim().length > 0 &&
    typeof value.targetId === 'string' &&
    value.targetId.trim().length > 0 &&
    (value.clientCreatedAt === undefined ||
      typeof value.clientCreatedAt === 'string') &&
    body.operation === 'reaction' &&
    body.targetType === 'post' &&
    typeof body.targetId === 'string' &&
    body.targetId === value.targetId &&
    body.reaction === 'like' &&
    (body.state === 'active' || body.state === 'inactive') &&
    typeof body.publisherName === 'string' &&
    body.publisherName.trim().length > 0 &&
    typeof body.walletAddress === 'string' &&
    body.walletAddress.trim().length > 0
  );
};

export const classifyInvalidReactionEnvelope = (
  value: unknown
): ReactionDiagnostic['code'] => {
  if (!isRecord(value) || !isRecord(value.body)) return 'MALFORMED_ENVELOPE';
  if (
    typeof value.targetId === 'string' &&
    typeof value.body.targetId === 'string' &&
    value.targetId !== value.body.targetId
  )
    return 'TARGET_MISMATCH';
  if (
    value.schema === 'qdb-v2' &&
    value.schemaVersion === 2 &&
    value.kind === 'operation' &&
    value.recordType === 'reaction' &&
    value.body.operation === 'reaction' &&
    value.body.targetType === 'post' &&
    value.body.reaction === 'like' &&
    value.body.state !== 'active' &&
    value.body.state !== 'inactive'
  )
    return 'INVALID_REACTION_STATE';
  return 'MALFORMED_ENVELOPE';
};

export const buildReactionEnvelope = (
  body: ReactionBody,
  recordId: string,
  clientCreatedAt = new Date().toISOString()
): ReactionEnvelope => ({
  schema: 'qdb-v2',
  schemaVersion: 2,
  kind: 'operation',
  recordType: 'reaction',
  recordId,
  targetId: body.targetId,
  body,
  clientCreatedAt,
});

const sha256Prefix = async (value: string, length = 20) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length);
};

export const buildReactionTargetPrefix = async (
  namespace: string,
  targetId: string
) => `${namespace}-v2-react-${await sha256Prefix(targetId)}-`;

export const buildReactionIdentifier = async (
  namespace: string,
  targetId: string,
  publisherName: string,
  walletAddress: string
) =>
  `${await buildReactionTargetPrefix(namespace, targetId)}${await sha256Prefix(`${normalizeName(publisherName)}:${walletAddress.trim()}`)}`;

export const publishReactionEnvelope = async (
  envelope: ReactionEnvelope,
  publish: ReactionEnvelopePublisher
) => {
  await publish(envelope);
  return envelope;
};

const actorKey = (body: ReactionBody) =>
  `${normalizeName(body.publisherName)}:${body.walletAddress.trim()}`;
const compareRecords = (a: ReactionRecord, b: ReactionRecord) => {
  const leftTime = a.metadata.updated ?? a.metadata.created;
  const rightTime = b.metadata.updated ?? b.metadata.created;
  if (leftTime !== rightTime) return leftTime - rightTime;
  const signature = (a.metadata.latestSignature ?? '').localeCompare(
    b.metadata.latestSignature ?? ''
  );
  return (
    signature || a.metadata.identifier.localeCompare(b.metadata.identifier)
  );
};

export const reduceReactionRecords = (
  targetId: string,
  records: ReactionRecord[],
  identity: IdentityValidator
): ReducedReactionState => {
  const diagnostics: ReactionDiagnostic[] = [];
  const candidates = new Map<string, ReactionRecord[]>();
  for (const record of [...records].sort(compareRecords)) {
    const metadata = validateMetadata(record.metadata);
    if (metadata.ok === false) {
      diagnostics.push({
        code: metadata.code,
        identifier: record.metadata.identifier,
        detail: metadata.detail,
      });
      continue;
    }
    if (
      record.envelope.targetId !== targetId ||
      record.envelope.body.targetId !== targetId
    ) {
      diagnostics.push({
        code: 'TARGET_MISMATCH',
        identifier: record.metadata.identifier,
        detail: 'reaction target mismatch',
      });
      continue;
    }
    const publisher = identity.validatePublisher(
      record.metadata,
      record.envelope.body.publisherName
    );
    if (publisher.ok === false) {
      diagnostics.push({
        code: publisher.code,
        identifier: record.metadata.identifier,
        detail: publisher.detail,
      });
      continue;
    }
    const wallet = identity.validateWalletBinding(
      record.envelope.body.publisherName,
      record.envelope.body.walletAddress
    );
    if (wallet.ok === false) {
      diagnostics.push({
        code: wallet.code,
        identifier: record.metadata.identifier,
        detail: wallet.detail,
      });
      continue;
    }
    const key = actorKey(record.envelope.body);
    candidates.set(key, [...(candidates.get(key) ?? []), record]);
  }

  const actors: Record<string, ReactionBody> = {};
  for (const [key, actorRecords] of [...candidates.entries()].sort(
    ([left], [right]) => left.localeCompare(right)
  )) {
    const ordered = [...actorRecords].sort(compareRecords);
    const latest = ordered[ordered.length - 1];
    if (!latest) continue;
    const tiedLatest = ordered.filter(
      (record) => compareRecords(record, latest) === 0
    );
    const states = new Set(
      tiedLatest.map((record) => record.envelope.body.state)
    );
    if (states.size > 1) {
      diagnostics.push({
        code: 'DUPLICATE_CONFLICT',
        identifier: latest.metadata.identifier,
        detail: `conflicting reaction states share the same trusted ordering key for actor ${key}`,
      });
      continue;
    }
    actors[key] = latest.envelope.body;
  }
  diagnostics.sort(
    (left, right) =>
      left.identifier.localeCompare(right.identifier) ||
      left.code.localeCompare(right.code) ||
      left.detail.localeCompare(right.detail)
  );
  return {
    targetId,
    actors,
    count: Object.values(actors).filter(
      (reaction) => reaction.state === 'active'
    ).length,
    diagnostics,
  };
};

const sortDiagnostics = (diagnostics: ReactionDiagnostic[]) =>
  diagnostics.sort(
    (left, right) =>
      left.identifier.localeCompare(right.identifier) ||
      left.code.localeCompare(right.code) ||
      left.detail.localeCompare(right.detail)
  );

export const loadReactionState = async (
  targetId: string,
  resources: DiscoveredReactionResource[],
  dependencies: ReactionLoaderDependencies
): Promise<ReducedReactionState> => {
  const diagnostics: ReactionDiagnostic[] = [];
  const records: ReactionRecord[] = [];
  const walletByName = new Map<string, string | null>();

  for (const resource of resources) {
    const identifier =
      typeof resource.identifier === 'string'
        ? resource.identifier
        : '<unknown>';
    if (
      typeof resource.name !== 'string' ||
      typeof resource.identifier !== 'string' ||
      typeof resource.service !== 'string' ||
      typeof resource.created !== 'number' ||
      (resource.updated !== undefined &&
        resource.updated !== null &&
        typeof resource.updated !== 'number')
    ) {
      diagnostics.push({
        code: 'MISSING_TRUSTED_METADATA',
        identifier,
        detail: 'reaction resource metadata is incomplete',
      });
      continue;
    }

    let payload: unknown;
    try {
      payload = await dependencies.fetchPayload(resource);
    } catch {
      diagnostics.push({
        code: 'UNAVAILABLE_RESOURCE',
        identifier,
        detail: 'reaction resource is unavailable',
      });
      continue;
    }
    if (!isReactionEnvelope(payload)) {
      diagnostics.push({
        code: classifyInvalidReactionEnvelope(payload),
        identifier,
        detail: 'invalid reaction envelope',
      });
      continue;
    }

    const expectedIdentifier = await dependencies.expectedIdentifier(
      payload.body
    );
    if (
      payload.recordId !== resource.identifier ||
      expectedIdentifier !== resource.identifier
    ) {
      diagnostics.push({
        code: 'IDENTIFIER_MISMATCH',
        identifier,
        detail: 'reaction resource identifier does not match target and actor',
      });
      continue;
    }

    const normalizedName = normalizeName(resource.name);
    if (!walletByName.has(normalizedName)) {
      try {
        walletByName.set(
          normalizedName,
          await dependencies.resolveWalletAddress(resource.name)
        );
      } catch {
        walletByName.set(normalizedName, null);
      }
    }
    records.push({
      metadata: {
        service: resource.service,
        publisherName: resource.name,
        identifier: resource.identifier,
        created: resource.created,
        updated: resource.updated ?? null,
        latestSignature: resource.latestSignature,
      },
      envelope: payload,
    });
  }

  const reduced = reduceReactionRecords(targetId, records, {
    validatePublisher: (metadata, claimed) =>
      normalizeName(metadata.publisherName) === normalizeName(claimed)
        ? { ok: true }
        : {
            ok: false,
            code: 'IDENTITY_UNVERIFIED',
            detail: 'reaction publisher mismatch',
          },
    validateWalletBinding: (name, wallet) =>
      walletByName.get(normalizeName(name)) === wallet
        ? { ok: true }
        : {
            ok: false,
            code: 'IDENTITY_UNVERIFIED',
            detail: 'reaction wallet binding mismatch',
          },
  });
  return {
    ...reduced,
    diagnostics: sortDiagnostics([...diagnostics, ...reduced.diagnostics]),
  };
};

export const hasActiveReaction = (
  state: ReducedReactionState,
  publisherName: string,
  walletAddress: string
) =>
  state.actors[`${normalizeName(publisherName)}:${walletAddress.trim()}`]
    ?.state === 'active';

export const resolveReactionDisplay = (
  legacyCount: number,
  legacyActors: string[],
  state: ReducedReactionState
) => {
  const actorStates = Object.values(state.actors);
  if (actorStates.length === 0)
    return {
      count: legacyCount,
      actors: legacyActors,
      source: 'legacy' as const,
    };
  return {
    count: state.count,
    actors: actorStates
      .filter((reaction) => reaction.state === 'active')
      .map((reaction) => `addr:${reaction.walletAddress.trim().toLowerCase()}`),
    source: 'v2' as const,
  };
};
