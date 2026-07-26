export const normalizeLegacyEntity = (input) => ({
    ...input,
    authorityState: input.authorityState ?? 'UNRESOLVED',
});
export const canLegacyEntityAuthorize = (entity) => entity.authorityState === 'APPROVED';
