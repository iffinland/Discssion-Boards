export type RichTextFormatType =
  | 'heading2'
  | 'heading3'
  | 'inlineCode'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'quote'
  | 'code'
  | 'unorderedList'
  | 'orderedList';

export type QdnImageTagReference = {
  service: 'IMAGE';
  name: string;
  identifier: string;
  filename?: string;
};

export type ParsedQdnImageTag = {
  rawTag: string;
  payload: string;
  reference: QdnImageTagReference;
};

export const RICH_TEXT_IMAGE_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  maxWidth: 1920,
  maxHeight: 1080,
  acceptedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
} as const;

type ApplyWrapFormatInput = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  openTag: string;
  closeTag: string;
  placeholder?: string;
};

export type ApplyWrapFormatResult = {
  value: string;
  nextSelectionStart: number;
  nextSelectionEnd: number;
};

type ApplyListFormatInput = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  ordered: boolean;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const replacePatternRecursively = (
  value: string,
  pattern: RegExp,
  replacer: (...args: string[]) => string,
  maxPasses = 6
) => {
  let current = value;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const next = current.replace(pattern, replacer);
    if (next === current) {
      return next;
    }
    current = next;
  }
  return current;
};

const sanitizeImageSource = (value: string): string | null => {
  const source = value.trim();
  if (!source) {
    return null;
  }

  const normalized = source.toLowerCase();
  if (
    normalized.startsWith('https://') ||
    normalized.startsWith('http://') ||
    normalized.startsWith('data:image/') ||
    normalized.startsWith('/arbitrary/') ||
    normalized.startsWith('/render/') ||
    normalized.startsWith('./') ||
    normalized.startsWith('../') ||
    source.startsWith('/')
  ) {
    return source;
  }

  return null;
};

const QDN_IMAGE_TAG_PATTERN = /\[imgqdn\]([\s\S]*?)\[\/imgqdn\]/gi;
const QDN_IMAGE_PLACEHOLDER_TAG_PATTERN =
  /\[imgqdnplaceholder\]([\s\S]*?)\[\/imgqdnplaceholder\]/gi;
const QDN_IMAGE_MISSING_TAG_PATTERN =
  /\[imgqdnmissing\]([\s\S]*?)\[\/imgqdnmissing\]/gi;
const QDN_VIDEO_TAG_PATTERN = /\[videoqdn\]([\s\S]*?)\[\/videoqdn\]/gi;
const QDN_LINK_PATTERN = /qdn:\/\/[^\s<]+/gi;
const TRAILING_PUNCTUATION_PATTERN = /[.,!?;:)\]}]+$/;

const decodeQdnTagPart = (value: string) => {
  try {
    return decodeURIComponent(value.trim());
  } catch {
    return value.trim();
  }
};

export const parseQdnImageTagPayload = (
  payload: string
): QdnImageTagReference | null => {
  const [rawName, rawIdentifier, rawFilename] = payload.split('|');
  if (!rawName || !rawIdentifier) {
    return null;
  }

  const name = decodeQdnTagPart(rawName);
  const identifier = decodeQdnTagPart(rawIdentifier);
  const filename = rawFilename ? decodeQdnTagPart(rawFilename) : undefined;
  if (!name || !identifier) {
    return null;
  }

  return {
    service: 'IMAGE',
    name,
    identifier,
    filename,
  };
};

const splitLinkAndTrailingPunctuation = (value: string) => {
  const trailingMatch = value.match(TRAILING_PUNCTUATION_PATTERN);
  if (!trailingMatch) {
    return { link: value, trailing: '' };
  }

  const trailing = trailingMatch[0];
  return {
    link: value.slice(0, value.length - trailing.length),
    trailing,
  };
};

const linkifyQdnUris = (html: string) => {
  const segments = html.split(/(<[^>]+>)/g);

  return segments
    .map((segment) => {
      if (!segment || segment.startsWith('<')) {
        return segment;
      }

      return segment.replace(QDN_LINK_PATTERN, (rawLink) => {
        const { link, trailing } = splitLinkAndTrailingPunctuation(rawLink);
        if (!link) {
          return rawLink;
        }

        return `<a href="${link}" class="text-brand-primary font-medium underline underline-offset-2 break-all transition hover:text-cyan-700">${link}</a>${trailing}`;
      });
    })
    .join('');
};

const renderQdnImagePlaceholder = (payload: string) => {
  const safePayload = String(payload ?? '').trim();
  if (!safePayload) {
    return '';
  }

  return `<button type="button" class="my-3 flex w-full max-w-xs items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-left shadow-sm transition hover:border-cyan-300 hover:bg-cyan-50" data-qdn-image-placeholder="true" data-qdn-image-payload="${safePayload}"><span class="flex h-12 w-16 flex-shrink-0 items-center justify-center rounded-md bg-slate-200 text-xs font-semibold text-slate-600 shadow-sm">IMG</span><span class="min-w-0"><span class="block truncate text-sm font-semibold text-slate-900">QDN image</span><span class="mt-1 block text-xs text-slate-600">Loading when visible</span></span></button>`;
};

export const encodeQdnImageTag = (reference: {
  name: string;
  identifier: string;
  filename?: string;
}) => {
  const name = encodeURIComponent(reference.name.trim());
  const identifier = encodeURIComponent(reference.identifier.trim());
  const filename = reference.filename?.trim()
    ? `|${encodeURIComponent(reference.filename.trim())}`
    : '';
  return `[imgqdn]${name}|${identifier}${filename}[/imgqdn]`;
};

export const extractQdnImageTags = (value: string): ParsedQdnImageTag[] => {
  const found: ParsedQdnImageTag[] = [];
  const pattern = new RegExp(QDN_IMAGE_TAG_PATTERN.source, 'gi');
  let match = pattern.exec(value);

  while (match) {
    const rawTag = match[0];
    const payload = match[1] ?? '';
    const reference = parseQdnImageTagPayload(payload);
    if (reference) {
      found.push({ rawTag, payload, reference });
    }
    match = pattern.exec(value);
  }

  return found;
};

export const stripQdnImageTags = (value: string) => {
  return value.replace(QDN_IMAGE_TAG_PATTERN, '');
};

export const stripQdnVideoTags = (value: string) => {
  return value.replace(QDN_VIDEO_TAG_PATTERN, '');
};

export const applyWrapFormat = ({
  value,
  selectionStart,
  selectionEnd,
  openTag,
  closeTag,
  placeholder = 'text',
}: ApplyWrapFormatInput): ApplyWrapFormatResult => {
  const before = value.slice(0, selectionStart);
  const selected = value.slice(selectionStart, selectionEnd);
  const after = value.slice(selectionEnd);

  if (!selected) {
    const nextValue = `${before}${openTag}${placeholder}${closeTag}${after}`;
    return {
      value: nextValue,
      nextSelectionStart: selectionStart + openTag.length,
      nextSelectionEnd: selectionStart + openTag.length + placeholder.length,
    };
  }

  const wrapped = `${openTag}${selected}${closeTag}`;
  const nextValue = `${before}${wrapped}${after}`;
  return {
    value: nextValue,
    nextSelectionStart: selectionStart + openTag.length,
    nextSelectionEnd: selectionStart + openTag.length + selected.length,
  };
};

export const applyListFormat = ({
  value,
  selectionStart,
  selectionEnd,
  ordered,
}: ApplyListFormatInput): ApplyWrapFormatResult => {
  const before = value.slice(0, selectionStart);
  const selected = value.slice(selectionStart, selectionEnd);
  const after = value.slice(selectionEnd);
  const listTag = ordered ? 'ol' : 'ul';

  if (!selected.trim()) {
    const placeholder = '[li]List item[/li]';
    const wrapped = `[${listTag}]${placeholder}[/${listTag}]`;
    const nextValue = `${before}${wrapped}${after}`;
    const start = before.length + `[${listTag}]`.length;
    return {
      value: nextValue,
      nextSelectionStart: start,
      nextSelectionEnd: start + placeholder.length,
    };
  }

  const lines = selected
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return {
      value,
      nextSelectionStart: selectionStart,
      nextSelectionEnd: selectionEnd,
    };
  }

  const wrappedLines = lines.map((line) => `[li]${line}[/li]`).join('');
  const wrapped = `[${listTag}]${wrappedLines}[/${listTag}]`;
  const nextValue = `${before}${wrapped}${after}`;
  return {
    value: nextValue,
    nextSelectionStart: before.length,
    nextSelectionEnd: before.length + wrapped.length,
  };
};

export const formatToTags: Record<RichTextFormatType, [string, string]> = {
  heading2: ['[h2]', '[/h2]'],
  heading3: ['[h3]', '[/h3]'],
  inlineCode: ['[icode]', '[/icode]'],
  bold: ['[b]', '[/b]'],
  italic: ['[i]', '[/i]'],
  underline: ['[u]', '[/u]'],
  strike: ['[s]', '[/s]'],
  quote: ['[quote]', '[/quote]'],
  code: ['[code]', '[/code]'],
  unorderedList: ['[ul]', '[/ul]'],
  orderedList: ['[ol]', '[/ol]'],
};

export const toRichTextHtml = (value: string): string => {
  let html = escapeHtml(value);

  html = replacePatternRecursively(
    html,
    /\[h2\]([\s\S]*?)\[\/h2\]/gi,
    (_full, content) =>
      `<h2 class="mt-4 mb-2 text-xl font-bold tracking-tight text-slate-900">${content}</h2>`
  );
  html = replacePatternRecursively(
    html,
    /\[h3\]([\s\S]*?)\[\/h3\]/gi,
    (_full, content) =>
      `<h3 class="mt-3 mb-2 text-lg font-bold tracking-tight text-slate-900">${content}</h3>`
  );
  html = replacePatternRecursively(
    html,
    /\[icode\]([\s\S]*?)\[\/icode\]/gi,
    (_full, content) =>
      `<code class="rounded-md border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-[0.92em] text-slate-800">${content}</code>`
  );
  html = replacePatternRecursively(
    html,
    /\[b\]([\s\S]*?)\[\/b\]/gi,
    (_full, content) => `<strong>${content}</strong>`
  );
  html = replacePatternRecursively(
    html,
    /\[i\]([\s\S]*?)\[\/i\]/gi,
    (_full, content) => `<em>${content}</em>`
  );
  html = replacePatternRecursively(
    html,
    /\[u\]([\s\S]*?)\[\/u\]/gi,
    (_full, content) => `<u>${content}</u>`
  );
  html = replacePatternRecursively(
    html,
    /\[s\]([\s\S]*?)\[\/s\]/gi,
    (_full, content) => `<s>${content}</s>`
  );
  html = replacePatternRecursively(
    html,
    /\[quote\]([\s\S]*?)\[\/quote\]/gi,
    (_full, content) =>
      `<blockquote class="my-2 border-l-2 border-slate-300 pl-3 text-slate-600">${content}</blockquote>`
  );
  html = replacePatternRecursively(
    html,
    /\[code\]([\s\S]*?)\[\/code\]/gi,
    (_full, content) =>
      `<div class="my-4 overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-sm"><div class="flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-3 py-2"><span class="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Code</span><span class="text-[11px] text-slate-400">formatted block</span></div><pre class="overflow-x-auto px-4 py-3 text-[13px] leading-6 text-slate-100"><code class="font-mono">${content}</code></pre></div>`
  );
  html = replacePatternRecursively(
    html,
    /\[ul\]([\s\S]*?)\[\/ul\]/gi,
    (_full, content) => {
      const items = content.replace(
        /\[li\]([\s\S]*?)\[\/li\]/gi,
        '<li>$1</li>'
      );
      return `<ul class="my-3 list-disc space-y-1 pl-5">${items}</ul>`;
    }
  );
  html = replacePatternRecursively(
    html,
    /\[ol\]([\s\S]*?)\[\/ol\]/gi,
    (_full, content) => {
      const items = content.replace(
        /\[li\]([\s\S]*?)\[\/li\]/gi,
        '<li>$1</li>'
      );
      return `<ol class="my-3 list-decimal space-y-1 pl-5">${items}</ol>`;
    }
  );
  html = replacePatternRecursively(
    html,
    /\[color=(#[0-9a-fA-F]{6})\]([\s\S]*?)\[\/color\]/g,
    (_full, color, content) => `<span style="color:${color}">${content}</span>`
  );
  html = replacePatternRecursively(
    html,
    /\[img\]([\s\S]*?)\[\/img\]/gi,
    (_full, content) => {
      const safeSource = sanitizeImageSource(content);
      if (!safeSource) {
        return '';
      }

      return `<figure class="my-3"><img src="${safeSource}" alt="Post image thumbnail" loading="lazy" class="h-32 w-auto max-w-[min(100%,18rem)] cursor-zoom-in rounded-lg border border-slate-200 bg-slate-100 object-cover shadow-sm transition hover:scale-[1.01] hover:shadow-md" data-preview-image="true" data-full-src="${safeSource}" /><figcaption class="mt-1 text-xs text-slate-500">Click image to enlarge</figcaption></figure>`;
    }
  );
  html = replacePatternRecursively(
    html,
    QDN_IMAGE_PLACEHOLDER_TAG_PATTERN,
    (_full, payload) => renderQdnImagePlaceholder(payload)
  );
  html = replacePatternRecursively(
    html,
    QDN_IMAGE_MISSING_TAG_PATTERN,
    () =>
      `<div class="my-3 max-w-xs rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">QDN image is not available yet.</div>`
  );
  html = replacePatternRecursively(
    html,
    QDN_IMAGE_TAG_PATTERN,
    (_full, payload) => renderQdnImagePlaceholder(payload)
  );
  html = replacePatternRecursively(
    html,
    QDN_VIDEO_TAG_PATTERN,
    (_full, payload) => {
      const safePayload = String(payload ?? '').trim();
      if (!safePayload) {
        return '';
      }

      const titlePart = safePayload.split('|')[3];
      const title = titlePart ? decodeQdnTagPart(titlePart) : 'QDN video';
      const safeTitle = escapeHtml(title || 'QDN video');

      return `<button type="button" class="my-3 flex w-full max-w-sm items-center gap-3 rounded-lg border border-cyan-200 bg-cyan-50/80 p-3 text-left shadow-sm transition hover:border-cyan-300 hover:bg-cyan-50" data-video-embed="true" data-video-payload="${safePayload}" data-video-visible="false"><span class="flex h-12 w-16 flex-shrink-0 items-center justify-center rounded-md bg-slate-950 text-white shadow-sm">▶</span><span class="min-w-0"><span class="block truncate text-sm font-semibold text-slate-900">${safeTitle}</span><span class="mt-1 block text-xs text-slate-600">Click to load video from QDN</span></span></button>`;
    }
  );
  html = linkifyQdnUris(html);

  return html.replace(/\n/g, '<br/>');
};
