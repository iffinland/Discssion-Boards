import type { PostAttachment } from '../../types';

export const FORUM_ATTACHMENT_LIMITS = {
  maxFiles: 5,
  maxTextBytes: 2 * 1024 * 1024,
  maxZipBytes: 10 * 1024 * 1024,
  acceptedExtensions: ['txt', 'md', 'zip'],
} as const;

const extensionToMimeTypes: Record<string, string[]> = {
  txt: ['text/plain'],
  md: ['text/markdown', 'text/x-markdown', 'text/plain'],
  zip: ['application/zip', 'application/x-zip-compressed', 'multipart/x-zip'],
};

export const getAttachmentExtension = (filename: string) => {
  const normalized = filename.trim().toLowerCase();
  const lastDot = normalized.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === normalized.length - 1) {
    return '';
  }

  return normalized.slice(lastDot + 1);
};

export const isAllowedAttachmentFile = (file: File) => {
  const extension = getAttachmentExtension(file.name);
  if (
    !FORUM_ATTACHMENT_LIMITS.acceptedExtensions.includes(extension as never)
  ) {
    return false;
  }

  if (!file.type) {
    return true;
  }

  const allowedMimeTypes = extensionToMimeTypes[extension] ?? [];
  return allowedMimeTypes.includes(file.type);
};

export const getAttachmentSizeLimit = (file: File) => {
  const extension = getAttachmentExtension(file.name);
  return extension === 'zip'
    ? FORUM_ATTACHMENT_LIMITS.maxZipBytes
    : FORUM_ATTACHMENT_LIMITS.maxTextBytes;
};

export const formatAttachmentSize = (bytes: number) => {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${bytes} B`;
};

export const getAttachmentHelperText = () =>
  `Attachments: up to ${FORUM_ATTACHMENT_LIMITS.maxFiles} files. TXT/MD max ${formatAttachmentSize(FORUM_ATTACHMENT_LIMITS.maxTextBytes)}, ZIP max ${formatAttachmentSize(FORUM_ATTACHMENT_LIMITS.maxZipBytes)}.`;

export const createAttachmentSignature = (
  attachment: Pick<PostAttachment, 'identifier' | 'filename'>
) => `${attachment.identifier}:${attachment.filename}`;
