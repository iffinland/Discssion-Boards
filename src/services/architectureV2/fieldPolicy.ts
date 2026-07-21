import type { V2EntityType } from './types';

const allowed: Record<V2EntityType, readonly string[]> = {
  topic: ['title', 'description'],
  thread: ['title', 'description'],
  post: ['content'],
};

export const ownerEditableFields = (entityType: V2EntityType) => allowed[entityType];

export const validateOwnerEditFields = (entityType: V2EntityType, changes: Record<string, unknown>) => {
  const forbidden = Object.entries(changes)
    .filter(([field, value]) => !allowed[entityType].includes(field) || typeof value !== 'string')
    .map(([field]) => field);
  return forbidden.length === 0 ? { ok: true as const } : { ok: false as const, forbidden };
};
