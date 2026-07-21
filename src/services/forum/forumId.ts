const TIME_PART_LENGTH = 10;
const RANDOM_PART_LENGTH = 16;
const OWNER_HASH_LENGTH = 4;

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

const randomBytes = (length: number): Uint8Array => {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.getRandomValues === 'function'
  ) {
    return crypto.getRandomValues(new Uint8Array(length));
  }

  const fallback = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    fallback[index] = Math.floor(Math.random() * 256);
  }
  return fallback;
};

const encodeTime = (value: number, length: number) => {
  let input = value;
  let output = '';

  while (output.length < length) {
    output = ALPHABET[input % 32] + output;
    input = Math.floor(input / 32);
  }

  return output.slice(-length).toLowerCase();
};

const encodeRandom = (length: number) => {
  const bytes = randomBytes(length);
  let output = '';

  for (let index = 0; index < length; index += 1) {
    output += ALPHABET[bytes[index] % 32];
  }

  return output.toLowerCase();
};

export const toPartitionKey = (input: string, length = 8): string => {
  const hashed = hashString(input);
  return hashed.toString(36).padStart(length, '0').slice(0, length);
};

export const generateForumEntityId = (
  entity:
    | 'topic'
    | 'subtopic'
    | 'post'
    | 'image'
    | 'attachment'
    | 'video'
    | 'poll'
    | 'option'
    | 'moderation'
    | 'role',
  ownerHint?: string
): string => {
  const timePart = encodeTime(Date.now(), TIME_PART_LENGTH);
  const ownerPart = toPartitionKey(
    ownerHint?.toLowerCase() ?? '',
    OWNER_HASH_LENGTH
  );
  const randomPart = encodeRandom(RANDOM_PART_LENGTH);
  return `${entity}_${timePart}${ownerPart}_${randomPart}`;
};
