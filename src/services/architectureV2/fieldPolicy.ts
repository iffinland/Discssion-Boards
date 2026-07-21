import type { V2AttachmentReference, V2EntityType } from './types.js';

const MAX_POST_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const isBoundedString = (value: unknown, maximum: number) =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= maximum;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isV2AttachmentReference = (
  value: unknown
): value is V2AttachmentReference => {
  if (!isRecord(value)) return false;
  const candidate = value;
  return (
    Object.keys(candidate).every((field) =>
      [
        'id',
        'service',
        'name',
        'identifier',
        'filename',
        'mimeType',
        'size',
      ].includes(field)
    ) &&
    isBoundedString(candidate.id, 128) &&
    isBoundedString(candidate.service, 32) &&
    isBoundedString(candidate.name, 180) &&
    isBoundedString(candidate.identifier, 128) &&
    isBoundedString(candidate.filename, 255) &&
    isBoundedString(candidate.mimeType, 128) &&
    typeof candidate.size === 'number' &&
    Number.isSafeInteger(candidate.size) &&
    candidate.size >= 0 &&
    candidate.size <= MAX_ATTACHMENT_BYTES
  );
};

export const isV2AttachmentReferenceList = (
  value: unknown
): value is V2AttachmentReference[] => {
  if (!Array.isArray(value) || value.length > MAX_POST_ATTACHMENTS)
    return false;
  const seen = new Set<string>();
  for (const reference of value) {
    if (!isV2AttachmentReference(reference)) return false;
    const key = `${reference.service}\u0000${reference.name.trim().toLowerCase()}\u0000${reference.identifier}\u0000${reference.filename}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
};

const allowed: Record<V2EntityType, readonly string[]> = {
  topic: ['title', 'description'],
  thread: ['title', 'description'],
  post: ['content', 'attachments'],
};

export const ownerEditableFields = (entityType: V2EntityType) =>
  allowed[entityType];

export const validateOwnerEditFields = (
  entityType: V2EntityType,
  changes: Record<string, unknown>
) => {
  const forbidden = Object.entries(changes)
    .filter(([field, value]) => {
      if (!allowed[entityType].includes(field)) return true;
      if (field === 'attachments')
        return entityType !== 'post' || !isV2AttachmentReferenceList(value);
      return typeof value !== 'string';
    })
    .map(([field]) => field);
  return forbidden.length === 0
    ? { ok: true as const }
    : { ok: false as const, forbidden };
};
