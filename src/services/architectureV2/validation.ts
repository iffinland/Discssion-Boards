import type {
  LegacyAuthorityState,
  QdbV2Envelope,
  QdbV2ResourceMetadata,
  RejectionCode,
  V2EntityCreate,
} from './types.js';

export type ValidationResult =
  | { ok: true }
  | { ok: false; code: RejectionCode; detail: string };

export type IdentityValidator = {
  validatePublisher: (
    metadata: QdbV2ResourceMetadata,
    claimedPublisher: string
  ) => ValidationResult;
  validateWalletBinding: (
    publisherName: string,
    walletAddress: string
  ) => ValidationResult;
};

export const normalizeName = (name: string) => name.trim().toLowerCase();

export const validateMetadata = (
  metadata: QdbV2ResourceMetadata
): ValidationResult => {
  if (!metadata.service || !metadata.publisherName || !metadata.identifier)
    return {
      ok: false,
      code: 'INVALID_METADATA',
      detail: 'missing trusted resource metadata',
    };
  if (
    !Number.isSafeInteger(metadata.created) ||
    (metadata.updated !== null &&
      (!Number.isSafeInteger(metadata.updated) ||
        metadata.created > metadata.updated))
  )
    return {
      ok: false,
      code: 'INVALID_METADATA',
      detail: 'invalid Core ordering metadata',
    };
  return { ok: true };
};

export const validateEnvelope = <T>(
  envelope: QdbV2Envelope<T>
): ValidationResult => {
  if (
    envelope.schema !== 'qdb-v2' ||
    envelope.schemaVersion !== 2 ||
    !envelope.recordId ||
    !envelope.targetId ||
    !envelope.recordType
  )
    return {
      ok: false,
      code: 'MALFORMED_ENVELOPE',
      detail: 'invalid qdb-v2 envelope',
    };
  return { ok: true };
};

export const validateEntityCreate = (
  metadata: QdbV2ResourceMetadata,
  envelope: QdbV2Envelope<V2EntityCreate>,
  identity: IdentityValidator
): ValidationResult => {
  const checks = [validateMetadata(metadata), validateEnvelope(envelope)];
  const failed = checks.find((check) => !check.ok);
  if (failed && !failed.ok) return failed;
  if (
    envelope.kind !== 'entity-create' ||
    envelope.targetId !== envelope.body.entityId ||
    envelope.body.entityType !== envelope.recordType
  )
    return {
      ok: false,
      code: 'MALFORMED_ENVELOPE',
      detail: 'entity envelope target mismatch',
    };
  const publisher = identity.validatePublisher(
    metadata,
    envelope.body.publisherName
  );
  if (!publisher.ok) return publisher;
  return identity.validateWalletBinding(
    envelope.body.publisherName,
    envelope.body.walletAddress
  );
};

export const legacyAuthorityAllowsOwnerMutation = (
  state: LegacyAuthorityState
) => state === 'APPROVED';
