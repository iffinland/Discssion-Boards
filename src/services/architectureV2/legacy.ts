import type { LegacyAuthorityState, QdbV2ResourceMetadata, V2EntityType } from './types';

export type LegacyNormalizedEntity = {
  entityType: V2EntityType;
  entityId: string;
  authorityState: LegacyAuthorityState;
  legacyStatus: 'available' | 'unavailable' | 'tombstone' | 'malformed';
  publisher?: string;
  resource?: QdbV2ResourceMetadata;
  payload: Record<string, unknown>;
};

export const normalizeLegacyEntity = (input: Omit<LegacyNormalizedEntity, 'authorityState'> & { authorityState?: LegacyAuthorityState }): LegacyNormalizedEntity => ({
  ...input,
  authorityState: input.authorityState ?? 'UNRESOLVED',
});

export const canLegacyEntityAuthorize = (entity: LegacyNormalizedEntity) => entity.authorityState === 'APPROVED';

