import {
  type ChangeEvent,
  type FormEvent,
  useId,
  useRef,
  useState,
} from 'react';

import {
  applyListFormat,
  applyWrapFormat,
  formatToTags,
  RICH_TEXT_IMAGE_LIMITS,
  type RichTextFormatType,
} from '../../services/forum/richText';
import {
  FORUM_ATTACHMENT_LIMITS,
  createAttachmentSignature,
  formatAttachmentSize,
  getAttachmentHelperText,
} from '../../services/forum/attachments';
import type { PostAttachment } from '../../types';
import {
  encodeQdnVideoTag,
  parseForumVideoInput,
} from '../../services/forum/videoEmbed';
import { QDN_INLINE_FILE_MAX_BYTES } from '../../services/qortium/qdnFilePublication';
import AppModal from '../common/AppModal';
import RichTextToolsModal from './RichTextToolsModal';

const VIDEO_UPLOAD_LIMITS = {
  maxBytes: 100 * 1024 * 1024,
  acceptedTypes: ['video/mp4', 'video/webm', 'video/ogg'],
} as const;

type RichTextEditorProps = {
  value: string;
  attachments: PostAttachment[];
  onChange: (value: string) => void;
  onAttachmentsChange: (attachments: PostAttachment[]) => void;
  onSubmit: () => void;
  onUploadImage?: (file: File) => Promise<string>;
  onUploadAttachment?: (file: File) => Promise<PostAttachment>;
  onUploadVideo?: (file: File, title?: string) => Promise<string>;
  placeholder?: string;
  editorLabel?: string;
  submitLabel?: string;
  canManageAttachments?: boolean;
};

const RichTextEditor = ({
  value,
  attachments,
  onChange,
  onAttachmentsChange,
  onSubmit,
  onUploadImage,
  onUploadAttachment,
  onUploadVideo,
  placeholder = 'Write your reply...',
  editorLabel = 'Reply editor',
  submitLabel = 'Publish Post',
  canManageAttachments = true,
}: RichTextEditorProps) => {
  const editorId = useId();
  const fileInputId = useId();
  const attachmentInputId = useId();
  const videoInputId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const videoFileInputRef = useRef<HTMLInputElement | null>(null);
  const [isToolsModalOpen, setIsToolsModalOpen] = useState(false);
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);
  const [videoInput, setVideoInput] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [editorInfo, setEditorInfo] = useState<string | null>(null);
  const isUploadingImage = editorInfo === 'Uploading image to QDN...';
  const isUploadingVideo = editorInfo === 'Uploading video to QDN...';

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!value.trim() && attachments.length === 0) {
      return;
    }

    onSubmit();
  };

  const applyFormatting = (openTag: string, closeTag: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const result = applyWrapFormat({
      value,
      selectionStart: textarea.selectionStart,
      selectionEnd: textarea.selectionEnd,
      openTag,
      closeTag,
    });
    onChange(result.value);

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(
        result.nextSelectionStart,
        result.nextSelectionEnd
      );
    });
  };

  const handleFormat = (format: RichTextFormatType) => {
    if (format === 'unorderedList' || format === 'orderedList') {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }

      const result = applyListFormat({
        value,
        selectionStart: textarea.selectionStart,
        selectionEnd: textarea.selectionEnd,
        ordered: format === 'orderedList',
      });
      onChange(result.value);

      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(
          result.nextSelectionStart,
          result.nextSelectionEnd
        );
      });
      return;
    }

    const [openTag, closeTag] = formatToTags[format];
    applyFormatting(openTag, closeTag);
  };

  const handleColor = (color: string) => {
    applyFormatting(`[color=${color}]`, '[/color]');
  };

  const insertImageTag = (imageSource: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const cursor = textarea.selectionEnd;
    const result = applyWrapFormat({
      value,
      selectionStart: cursor,
      selectionEnd: cursor,
      openTag: '[img]',
      closeTag: '[/img]',
      placeholder: imageSource,
    });

    onChange(result.value);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(
        result.nextSelectionEnd,
        result.nextSelectionEnd
      );
    });
  };

  const insertRawAtCursor = (snippet: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const nextValue = `${before}${snippet}${after}`;
    const cursor = start + snippet.length;

    onChange(nextValue);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    });
  };

  const loadImageDimensions = async (file: File) => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('Failed to read image file.'));
      reader.readAsDataURL(file);
    });

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to decode image.'));
      img.src = dataUrl;
    });

    return { dataUrl, width: image.naturalWidth, height: image.naturalHeight };
  };

  const handleImageSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    if (
      !RICH_TEXT_IMAGE_LIMITS.acceptedTypes.includes(
        file.type as (typeof RICH_TEXT_IMAGE_LIMITS.acceptedTypes)[number]
      )
    ) {
      setEditorInfo(
        '[UNSUPPORTED_FILE_TYPE] Use a JPG, PNG, WEBP or GIF image.'
      );
      return;
    }

    if (file.size > RICH_TEXT_IMAGE_LIMITS.maxBytes) {
      setEditorInfo('[FILE_TOO_LARGE] Images are limited to 2 MiB.');
      return;
    }

    try {
      const loaded = await loadImageDimensions(file);
      if (
        loaded.width > RICH_TEXT_IMAGE_LIMITS.maxWidth ||
        loaded.height > RICH_TEXT_IMAGE_LIMITS.maxHeight
      ) {
        setEditorInfo('Image dimensions exceed 1920x1080 limit.');
        return;
      }

      if (onUploadImage) {
        setEditorInfo('Uploading image to QDN...');
        const imageTag = await onUploadImage(file);
        insertRawAtCursor(imageTag);
      } else {
        insertImageTag(loaded.dataUrl);
      }
      setEditorInfo(
        `Image inserted as a clickable thumbnail (${loaded.width}x${loaded.height}, ${(file.size / (1024 * 1024)).toFixed(2)} MB).`
      );
    } catch (error) {
      setEditorInfo(
        error instanceof Error
          ? error.message
          : 'Unable to insert selected image.'
      );
    }
  };

  const handleAttachmentSelected = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = '';

    if (selectedFiles.length === 0 || !onUploadAttachment) {
      return;
    }

    if (
      attachments.length + selectedFiles.length >
      FORUM_ATTACHMENT_LIMITS.maxFiles
    ) {
      setEditorInfo('Too many attachments. Maximum allowed is 5 files.');
      return;
    }

    try {
      setEditorInfo('Uploading attachments to QDN...');
      const nextAttachments = [...attachments];

      for (const file of selectedFiles) {
        if (file.size > QDN_INLINE_FILE_MAX_BYTES) {
          setEditorInfo(
            `Large attachment selected (${(file.size / (1024 * 1024)).toFixed(2)} MiB). Qortium Home will ask you to choose the same file again for memory-safe publication.`
          );
        }
        const uploaded = await onUploadAttachment(file);
        if (
          nextAttachments.some(
            (attachment) =>
              createAttachmentSignature(attachment) ===
              createAttachmentSignature(uploaded)
          )
        ) {
          continue;
        }

        nextAttachments.push(uploaded);
      }

      onAttachmentsChange(nextAttachments);
      setEditorInfo(
        `${selectedFiles.length} attachment${selectedFiles.length === 1 ? '' : 's'} added.`
      );
    } catch (error) {
      setEditorInfo(
        error instanceof Error
          ? error.message
          : 'Unable to upload selected attachment.'
      );
    }
  };

  const removeAttachment = (attachmentId: string) => {
    onAttachmentsChange(
      attachments.filter((attachment) => attachment.id !== attachmentId)
    );
  };

  const handleInsertVideo = () => {
    const reference = parseForumVideoInput(videoInput, videoTitle);
    if (!reference) {
      setEditorInfo(
        'Paste a valid qdn://VIDEO, /arbitrary/VIDEO, qdn://use-embed/VIDEO, or Q-Tube video link.'
      );
      return;
    }

    insertRawAtCursor(encodeQdnVideoTag(reference));
    setVideoInput('');
    setVideoTitle('');
    setIsVideoModalOpen(false);
    setEditorInfo(
      'Video placeholder inserted. The video will load only when opened.'
    );
  };

  const handleVideoFileSelected = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file || !onUploadVideo) {
      return;
    }

    if (
      file.type &&
      !VIDEO_UPLOAD_LIMITS.acceptedTypes.includes(
        file.type as (typeof VIDEO_UPLOAD_LIMITS.acceptedTypes)[number]
      )
    ) {
      setEditorInfo('[UNSUPPORTED_FILE_TYPE] Use an MP4, WEBM or OGG video.');
      return;
    }

    if (file.size > VIDEO_UPLOAD_LIMITS.maxBytes) {
      setEditorInfo('[FILE_TOO_LARGE] Videos are limited to 100 MiB.');
      return;
    }

    try {
      setEditorInfo(
        file.size > QDN_INLINE_FILE_MAX_BYTES
          ? `Large video selected (${(file.size / (1024 * 1024)).toFixed(2)} MiB). Qortium Home will ask you to choose the same file again for memory-safe publication.`
          : 'Uploading video to QDN...'
      );
      const videoTag = await onUploadVideo(file, videoTitle);
      insertRawAtCursor(videoTag);
      setVideoInput('');
      setVideoTitle('');
      setIsVideoModalOpen(false);
      setEditorInfo(
        `Video placeholder inserted (${(file.size / (1024 * 1024)).toFixed(2)} MB). The video will load only when opened.`
      );
    } catch (error) {
      setEditorInfo(
        error instanceof Error
          ? error.message
          : 'Unable to upload selected video.'
      );
    }
  };

  return (
    <form onSubmit={handleSubmit} className="forum-card-primary p-4">
      <div className="border-brand-primary bg-brand-primary-soft mb-3 rounded-md border p-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleFormat('heading2')}
            className="forum-pill-primary text-brand-primary-strong rounded-md px-2 py-1 text-xs font-semibold"
          >
            H2
          </button>
          <button
            type="button"
            onClick={() => handleFormat('heading3')}
            className="forum-pill-primary text-brand-primary-strong rounded-md px-2 py-1 text-xs font-semibold"
          >
            H3
          </button>
          <button
            type="button"
            onClick={() => handleFormat('inlineCode')}
            className="forum-pill-primary text-brand-primary-strong rounded-md px-2 py-1 text-xs font-semibold"
          >
            Inline Code
          </button>
          <button
            type="button"
            onClick={() => handleFormat('bold')}
            className="forum-pill-primary text-brand-primary-strong rounded-md px-2 py-1 text-xs font-semibold"
          >
            Bold
          </button>
          <button
            type="button"
            onClick={() => handleFormat('italic')}
            className="forum-pill-primary text-brand-primary-strong rounded-md px-2 py-1 text-xs font-semibold"
          >
            Italic
          </button>
          <button
            type="button"
            onClick={() => handleFormat('underline')}
            className="forum-pill-primary text-brand-primary-strong rounded-md px-2 py-1 text-xs font-semibold"
          >
            Underline
          </button>
          <button
            type="button"
            onClick={() => handleFormat('quote')}
            className="forum-pill-primary text-brand-primary-strong rounded-md px-2 py-1 text-xs font-semibold"
          >
            Quote
          </button>
          <button
            type="button"
            onClick={() => handleFormat('unorderedList')}
            className="forum-pill-primary text-brand-primary-strong rounded-md px-2 py-1 text-xs font-semibold"
          >
            Bullet List
          </button>
          <button
            type="button"
            onClick={() => handleFormat('orderedList')}
            className="forum-pill-primary text-brand-primary-strong rounded-md px-2 py-1 text-xs font-semibold"
          >
            Numbered List
          </button>
          <button
            type="button"
            onClick={() => setIsToolsModalOpen(true)}
            className="forum-pill-accent text-brand-accent-strong rounded-md px-2 py-1 text-xs font-semibold"
          >
            More Tools
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {[
            { label: 'Black', value: '#111827' },
            { label: 'Blue', value: '#2563EB' },
            { label: 'Green', value: '#16A34A' },
            { label: 'Red', value: '#DC2626' },
          ].map((color) => (
            <button
              key={color.value}
              type="button"
              onClick={() => handleColor(color.value)}
              className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
            >
              <span
                className="h-3 w-3 rounded-full border border-slate-300"
                style={{ backgroundColor: color.value }}
                aria-hidden="true"
              />
              {color.label}
            </button>
          ))}
          <input
            ref={imageInputRef}
            id={fileInputId}
            type="file"
            accept={RICH_TEXT_IMAGE_LIMITS.acceptedTypes.join(',')}
            className="hidden"
            onChange={handleImageSelected}
          />
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className="forum-pill-accent text-brand-accent-strong rounded-md px-2 py-1 text-xs font-semibold"
          >
            Add Image
          </button>
          <button
            type="button"
            onClick={() => setIsVideoModalOpen(true)}
            className="forum-pill-accent text-brand-accent-strong rounded-md px-2 py-1 text-xs font-semibold"
          >
            Add Video
          </button>
          {canManageAttachments ? (
            <>
              <input
                ref={attachmentInputRef}
                id={attachmentInputId}
                type="file"
                accept=".txt,.md,.zip,text/plain,text/markdown,application/zip,application/x-zip-compressed"
                multiple
                className="hidden"
                onChange={handleAttachmentSelected}
              />
              <button
                type="button"
                onClick={() => attachmentInputRef.current?.click()}
                className="forum-pill-accent text-brand-accent-strong rounded-md px-2 py-1 text-xs font-semibold"
              >
                Add Attachment
              </button>
            </>
          ) : null}
        </div>
        <p className="text-ui-muted mt-2 text-xs">
          Image limits: max 1920x1080, max 2 MB, types JPG/PNG/WEBP/GIF.
        </p>
        {canManageAttachments ? (
          <p className="text-ui-muted mt-1 text-xs">
            {getAttachmentHelperText()}
          </p>
        ) : null}
      </div>

      {editorInfo ? (
        <p
          className={[
            'mb-2 rounded-md border px-3 py-2 text-xs font-semibold',
            isUploadingImage
              ? 'border-cyan-300 bg-cyan-50 text-cyan-800 shadow-sm'
              : 'border-slate-200 bg-slate-50 text-slate-600',
          ].join(' ')}
          role="status"
        >
          {editorInfo}
        </p>
      ) : null}

      <label className="sr-only" htmlFor={editorId}>
        {editorLabel}
      </label>
      <textarea
        ref={textareaRef}
        id={editorId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="bg-surface-card text-ui-strong min-h-28 w-full rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-cyan-300"
      />

      {canManageAttachments && attachments.length > 0 ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-ui-strong text-xs font-semibold">Attachments</p>
          <div className="mt-2 space-y-2">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-ui-strong truncate text-xs font-semibold">
                    {attachment.filename}
                  </p>
                  <p className="text-ui-muted text-xs">
                    {attachment.mimeType} ·{' '}
                    {formatAttachmentSize(attachment.size)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeAttachment(attachment.id)}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between">
        <p className="text-ui-muted text-xs">
          Supported tags: [h2], [h3], [icode], [b], [i], [u], [s], [quote],
          [code], [ul], [ol], [color], [img], [videoqdn]
        </p>
        <button
          type="submit"
          className="bg-brand-primary-solid rounded-md px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-cyan-600"
        >
          {submitLabel}
        </button>
      </div>

      <RichTextToolsModal
        isOpen={isToolsModalOpen}
        onClose={() => setIsToolsModalOpen(false)}
        onApplyFormat={handleFormat}
        onApplyColor={handleColor}
      />
      <AppModal
        isOpen={isVideoModalOpen}
        onClose={() => setIsVideoModalOpen(false)}
        ariaLabel="Add QDN video"
        title="Add Video"
        maxWidthClassName="max-w-lg"
      >
        <div className="space-y-3">
          <label className="block">
            <span className="text-ui-strong text-xs font-semibold">
              QVB URI or Q-Tube link
            </span>
            <input
              value={videoInput}
              onChange={(event) => setVideoInput(event.target.value)}
              placeholder="qdn://VIDEO/Name/Identifier"
              className="bg-surface-card text-ui-strong mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-ui-strong text-xs font-semibold">
              Display title
            </span>
            <input
              value={videoTitle}
              onChange={(event) => setVideoTitle(event.target.value)}
              placeholder="Optional title shown in the post"
              className="bg-surface-card text-ui-strong mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <p className="text-ui-muted text-xs">
            The post will show a lightweight video placeholder. QDN video data
            loads only after the placeholder is opened.
          </p>
          {onUploadVideo ? (
            <div className="rounded-md border border-cyan-100 bg-cyan-50/60 p-3">
              <input
                ref={videoFileInputRef}
                id={videoInputId}
                type="file"
                accept={VIDEO_UPLOAD_LIMITS.acceptedTypes.join(',')}
                className="hidden"
                onChange={handleVideoFileSelected}
              />
              <button
                type="button"
                onClick={() => videoFileInputRef.current?.click()}
                disabled={isUploadingVideo}
                className="bg-brand-primary-solid rounded-md px-3 py-2 text-xs font-semibold text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isUploadingVideo ? 'Uploading Video...' : 'Choose Video File'}
              </button>
              <p className="text-ui-muted mt-2 text-xs">
                MP4, WEBM or OGG. Maximum size 100 MB.
              </p>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsVideoModalOpen(false)}
              className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleInsertVideo}
              disabled={isUploadingVideo}
              className="bg-brand-primary-solid rounded-md px-3 py-2 text-xs font-semibold text-slate-900"
            >
              Insert Video
            </button>
          </div>
        </div>
      </AppModal>
    </form>
  );
};

export default RichTextEditor;
