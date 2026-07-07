const DEFAULT_SERVICE = 'APP';
const DEFAULT_NAME = 'Discussion_Boards';
const DEFAULT_IDENTIFIER = 'qdbm';

const clean = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const decodeSegment = (value: string | undefined) => {
  if (!value) {
    return '';
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const getAppBaseAddress = (
  location: Pick<Location, 'pathname'> = window.location
) => {
  const renderMatch = location.pathname.match(
    /\/render\/([^/]+)\/([^/]+)(?:\/([^/?#]+))?/i
  );
  const service =
    clean(window._qdnService) ||
    decodeSegment(renderMatch?.[1]) ||
    DEFAULT_SERVICE;
  const name =
    clean(window._qdnName) ||
    decodeSegment(renderMatch?.[2]) ||
    import.meta.env.VITE_QAPP_NAME?.trim() ||
    DEFAULT_NAME;
  const identifier =
    clean(window._qdnIdentifier) ||
    decodeSegment(renderMatch?.[3]) ||
    import.meta.env.VITE_QORTIUM_QDN_IDENTIFIER?.trim() ||
    DEFAULT_IDENTIFIER;

  return `qdn://${encodeURIComponent(service)}/${encodeURIComponent(name)}/${encodeURIComponent(
    identifier
  )}`;
};

export const buildTopicShareLink = (topicId: string) =>
  `${getAppBaseAddress()}?topic=${encodeURIComponent(topicId)}`;

export const buildThreadShareLink = (threadId: string) =>
  `${getAppBaseAddress()}?thread=${encodeURIComponent(threadId)}`;

export const buildPostShareLink = (threadId: string, postId: string) =>
  `${getAppBaseAddress()}?thread=${encodeURIComponent(threadId)}&post=${encodeURIComponent(
    postId
  )}`;

export const getInitialShareTarget = (search = window.location.search) => {
  const params = new URLSearchParams(search);

  return {
    topicId: params.get('topic')?.trim() || null,
    threadId: params.get('thread')?.trim() || null,
    postId: params.get('post')?.trim() || null,
  };
};

const copyWithTextarea = (value: string) => {
  if (typeof document === 'undefined' || !document.body) {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.width = '1px';
  textarea.style.height = '1px';
  textarea.style.opacity = '0';
  textarea.setAttribute('readonly', 'readonly');
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  const copied = document.execCommand('copy');
  textarea.remove();
  return copied;
};

export const copyToClipboard = async (value: string) => {
  if (!value.trim()) {
    return false;
  }

  if (copyWithTextarea(value)) {
    return true;
  }

  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return copyWithTextarea(value);
  }
};
