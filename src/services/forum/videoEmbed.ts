import { ensureQdnResourceReady } from '../qdn/qdnReadiness';
import { discoverQdnResources } from '../qdn/qdnPagination';
import { requestQortium } from '../qortium/qortiumClient';

export type ForumVideoReference = {
  service: 'VIDEO';
  name: string;
  identifier: string;
  title?: string;
  source: 'qdn' | 'qtube' | 'embed';
};

const QDN_VIDEO_TAG_PATTERN = /\[videoqdn\]([\s\S]*?)\[\/videoqdn\]/gi;
const QDN_VIDEO_LINK_PATTERN = /qdn:\/\/VIDEO\/([^"'<>\s]+)\/([^"'<>\s]+)/i;
const QTUBE_LINK_PATTERN =
  /qdn:\/\/APP\/Q-Tube\/video\/([^"'<>\s]+)\/([^"'<>\s]+)/i;
const USE_EMBED_LINK_PATTERN = /qdn:\/\/use-embed\/VIDEO\?([^"'<>\s]+)/i;

const decodePart = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const encodePart = (value: string) => encodeURIComponent(value.trim());

const toUrl = (value: string) => {
  try {
    return new URL(value);
  } catch {
    try {
      return new URL(value, 'http://localhost');
    } catch {
      return null;
    }
  }
};

const buildArbitraryPath = (reference: ForumVideoReference) =>
  `/arbitrary/${encodePart(reference.service)}/${encodePart(reference.name)}/${encodePart(reference.identifier)}`;

const parseUseEmbedLink = (input: string): ForumVideoReference | null => {
  const match = input.match(USE_EMBED_LINK_PATTERN);
  if (!match) {
    return null;
  }

  const params = new URLSearchParams(match[1]);
  const service = params.get('service')?.trim().toUpperCase() || 'VIDEO';
  const name = params.get('name')?.trim() || '';
  const identifier = params.get('identifier')?.trim() || '';
  if (service !== 'VIDEO' || !name || !identifier) {
    return null;
  }

  return {
    service: 'VIDEO',
    name,
    identifier,
    source: 'embed',
  };
};

export const parseForumVideoInput = (
  value: string,
  fallbackTitle = ''
): ForumVideoReference | null => {
  const input = value.trim();
  if (!input) {
    return null;
  }

  const normalizedTag = parseQdnVideoTagPayload(input);
  if (normalizedTag) {
    return normalizedTag;
  }

  const useEmbed = parseUseEmbedLink(input);
  if (useEmbed) {
    return {
      ...useEmbed,
      title: fallbackTitle.trim() || useEmbed.title,
    };
  }

  const qdnMatch = input.match(QDN_VIDEO_LINK_PATTERN);
  if (qdnMatch) {
    return {
      service: 'VIDEO',
      name: decodePart(qdnMatch[1]),
      identifier: decodePart(qdnMatch[2]),
      title: fallbackTitle.trim() || undefined,
      source: 'qdn',
    };
  }

  const qTubeMatch = input.match(QTUBE_LINK_PATTERN);
  if (qTubeMatch) {
    return {
      service: 'VIDEO',
      name: decodePart(qTubeMatch[1]),
      identifier: decodePart(qTubeMatch[2]),
      title: fallbackTitle.trim() || undefined,
      source: 'qtube',
    };
  }

  const url = toUrl(input);
  if (!url) {
    return null;
  }

  const parts = url.pathname.split('/').filter(Boolean).map(decodePart);
  const arbitraryIndex = parts.findIndex(
    (part) => part.toLowerCase() === 'arbitrary'
  );
  const service = parts[arbitraryIndex + 1];
  const name = parts[arbitraryIndex + 2];
  const identifier = parts[arbitraryIndex + 3];

  if (
    arbitraryIndex >= 0 &&
    service?.toUpperCase() === 'VIDEO' &&
    name &&
    identifier
  ) {
    return {
      service: 'VIDEO',
      name,
      identifier,
      title: fallbackTitle.trim() || undefined,
      source: 'qdn',
    };
  }

  return null;
};

export const encodeQdnVideoTag = (reference: ForumVideoReference) => {
  const title = reference.title?.trim()
    ? `|${encodePart(reference.title)}`
    : '';
  return `[videoqdn]${reference.source}|${encodePart(reference.name)}|${encodePart(reference.identifier)}${title}[/videoqdn]`;
};

export const parseQdnVideoTagPayload = (
  payload: string
): ForumVideoReference | null => {
  const parts = payload.split('|');
  if (parts.length < 3) {
    return null;
  }

  const source = decodePart(parts[0]).trim().toLowerCase();
  const name = decodePart(parts[1]).trim();
  const identifier = decodePart(parts[2]).trim();
  const title = parts[3] ? decodePart(parts[3]).trim() : '';
  if (
    (source !== 'qdn' && source !== 'qtube' && source !== 'embed') ||
    !name ||
    !identifier
  ) {
    return null;
  }

  return {
    service: 'VIDEO',
    name,
    identifier,
    title: title || undefined,
    source,
  };
};

export type ParsedQdnVideoTag = {
  rawTag: string;
  reference: ForumVideoReference;
};

export const extractQdnVideoTags = (value: string): ParsedQdnVideoTag[] => {
  const found: ParsedQdnVideoTag[] = [];
  const pattern = new RegExp(QDN_VIDEO_TAG_PATTERN.source, 'gi');
  let match = pattern.exec(value);

  while (match) {
    const rawTag = match[0];
    const payload = match[1] ?? '';
    const reference = parseQdnVideoTagPayload(payload);
    if (reference) {
      found.push({ rawTag, reference });
    }
    match = pattern.exec(value);
  }

  return found;
};

export const stripQdnVideoTags = (value: string) => {
  return value.replace(QDN_VIDEO_TAG_PATTERN, '');
};

const parseFetchedJson = (value: unknown): unknown => {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    try {
      return parseFetchedJson(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object') {
    return null;
  }
  return value;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const normalizeVideoResource = (
  value: unknown,
  fallbackName: string
): ForumVideoReference | null => {
  if (!isObject(value)) {
    return null;
  }

  const service =
    typeof value.service === 'string' ? value.service.toUpperCase() : '';
  const name =
    typeof value.name === 'string' && value.name.trim()
      ? value.name.trim()
      : fallbackName;
  const identifier =
    typeof value.identifier === 'string' && value.identifier.trim()
      ? value.identifier.trim()
      : '';

  if (service === 'VIDEO' && name && identifier) {
    return {
      service: 'VIDEO',
      name,
      identifier,
      source: 'qdn',
    };
  }

  return null;
};

const extractVideoResourceFromMetadata = (
  value: unknown,
  fallbackName: string,
  seen = new Set<unknown>()
): ForumVideoReference | null => {
  const parsed = parseFetchedJson(value);
  if (!isObject(parsed) || seen.has(parsed)) {
    return null;
  }
  seen.add(parsed);

  const direct = normalizeVideoResource(parsed, fallbackName);
  if (direct) {
    return direct;
  }

  for (const key of [
    'qdnVideo',
    'qdn',
    'videoResource',
    'resource',
    'media',
    'video',
    'data',
  ]) {
    const nested = extractVideoResourceFromMetadata(
      parsed[key],
      fallbackName,
      seen
    );
    if (nested) {
      return nested;
    }
  }

  for (const nestedValue of Object.values(parsed)) {
    if (!isObject(nestedValue)) {
      continue;
    }
    const nested = extractVideoResourceFromMetadata(
      nestedValue,
      fallbackName,
      seen
    );
    if (nested) {
      return nested;
    }
  }

  for (const field of [
    'videoIdentifier',
    'qdnVideoIdentifier',
    'videoResourceIdentifier',
    'videoId',
  ]) {
    const identifier =
      typeof parsed[field] === 'string' ? parsed[field].trim() : '';
    if (identifier && !identifier.endsWith('_metadata')) {
      return {
        service: 'VIDEO',
        name: fallbackName,
        identifier,
        source: 'qdn',
      };
    }
  }

  return null;
};

const uniqueReferences = (references: ForumVideoReference[]) => {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = `${reference.service}:${reference.name}:${reference.identifier}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const resolveQTubeReference = async (
  reference: ForumVideoReference
): Promise<ForumVideoReference> => {
  const resources: ForumVideoReference[] = [];

  if (reference.identifier.endsWith('_metadata')) {
    resources.push({
      ...reference,
      identifier: reference.identifier.replace(/_metadata$/, ''),
      source: 'qdn',
    });
  }

  for (const service of ['DOCUMENT', 'JSON']) {
    try {
      const metadata = await requestQortium<unknown>({
        action: 'FETCH_QDN_RESOURCE',
        service,
        name: reference.name,
        identifier: reference.identifier,
      });
      const resource = extractVideoResourceFromMetadata(
        metadata,
        reference.name
      );
      if (resource) {
        resources.push(resource);
      }
    } catch {
      // Q-Tube metadata has used multiple services; try the next option.
    }
  }

  for (const identifier of [
    reference.identifier.replace(/_metadata$/, ''),
    reference.identifier,
  ]) {
    try {
      const result = await discoverQdnResources(
        {
          service: 'VIDEO',
          mode: 'ALL',
          name: reference.name,
          identifier,
          prefix: true,
          reverse: true,
        },
        { pageSize: 20, maxPages: 5, maxResources: 100 }
      );
      const matches = result.items;
      matches.forEach((match) => {
        if (!match.identifier) {
          return;
        }
        resources.push({
          service: 'VIDEO',
          name: match.name || reference.name,
          identifier: match.identifier,
          source: 'qdn',
        });
      });
    } catch {
      // Best-effort fallback for Q-Tube variants.
    }
  }

  return uniqueReferences(resources)[0] ?? reference;
};

export const resolveForumVideoUrl = async (
  reference: ForumVideoReference
): Promise<string> => {
  const resolved =
    reference.source === 'qtube'
      ? await resolveQTubeReference(reference)
      : reference;

  await ensureQdnResourceReady(
    resolved.service,
    resolved.name,
    resolved.identifier
  );

  try {
    const url = await requestQortium<string>({
      action: 'GET_QDN_RESOURCE_URL',
      service: resolved.service,
      name: resolved.name,
      identifier: resolved.identifier,
    });
    if (typeof url === 'string' && url.trim()) {
      return url;
    }
  } catch {
    // Fall back to the canonical QDN path; the video tag will load it lazily.
  }

  return buildArbitraryPath(resolved);
};

export const toVideoDisplayTitle = (reference: ForumVideoReference) =>
  reference.title?.trim() || 'QDN video';
