import {
  type ChangeEvent,
  type FormEvent,
  useId,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

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
  placeholder,
  editorLabel,
  submitLabel,
  canManageAttachments = true,
}: RichTextEditorProps) => {
  const { t } = useTranslation();
  const effectivePlaceholder = placeholder ?? t('post.replyPlaceholder');
  const effectiveEditorLabel = editorLabel ?? t('post.editorLabel');
  const effectiveSubmitLabel = submitLabel ?? t('post.publish');
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
  const isUploadingImage = editorInfo === t('media.uploadingImage');
  const isUploadingVideo = editorInfo === t('media.uploadingVideo');

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
      setEditorInfo(t('media.imageType'));
      return;
    }

    if (file.size > RICH_TEXT_IMAGE_LIMITS.maxBytes) {
      setEditorInfo(t('media.imageSize'));
      return;
    }

    try {
      const loaded = await loadImageDimensions(file);
      if (
        loaded.width > RICH_TEXT_IMAGE_LIMITS.maxWidth ||
        loaded.height > RICH_TEXT_IMAGE_LIMITS.maxHeight
      ) {
        setEditorInfo(t('media.imageDimensions'));
        return;
      }

      if (onUploadImage) {
        setEditorInfo(t('media.uploadingImage'));
        const imageTag = await onUploadImage(file);
        insertRawAtCursor(imageTag);
      } else {
        insertImageTag(loaded.dataUrl);
      }
      setEditorInfo(
        t('media.imageInserted', {
          width: loaded.width,
          height: loaded.height,
          size: (file.size / (1024 * 1024)).toFixed(2),
        })
      );
    } catch (error) {
      setEditorInfo(
        error instanceof Error ? error.message : t('media.insertImageFailed')
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
      setEditorInfo(
        t('attachment.tooMany', { count: FORUM_ATTACHMENT_LIMITS.maxFiles })
      );
      return;
    }

    try {
      setEditorInfo(t('attachment.uploading'));
      const nextAttachments = [...attachments];

      for (const file of selectedFiles) {
        if (file.size > QDN_INLINE_FILE_MAX_BYTES) {
          setEditorInfo(
            t('attachment.large', {
              size: (file.size / (1024 * 1024)).toFixed(2),
            })
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
      setEditorInfo(t('attachment.added', { count: selectedFiles.length }));
    } catch (error) {
      setEditorInfo(
        error instanceof Error ? error.message : t('attachment.uploadFailed')
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
      setEditorInfo(t('media.videoReferenceHelp'));
      return;
    }

    insertRawAtCursor(encodeQdnVideoTag(reference));
    setVideoInput('');
    setVideoTitle('');
    setIsVideoModalOpen(false);
    setEditorInfo(t('media.videoInserted'));
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
      setEditorInfo(t('media.videoType'));
      return;
    }

    if (file.size > VIDEO_UPLOAD_LIMITS.maxBytes) {
      setEditorInfo(t('media.videoSize'));
      return;
    }

    try {
      setEditorInfo(
        file.size > QDN_INLINE_FILE_MAX_BYTES
          ? t('media.largeVideo', {
              size: (file.size / (1024 * 1024)).toFixed(2),
            })
          : t('media.uploadingVideo')
      );
      const videoTag = await onUploadVideo(file, videoTitle);
      insertRawAtCursor(videoTag);
      setVideoInput('');
      setVideoTitle('');
      setIsVideoModalOpen(false);
      setEditorInfo(
        t('media.insertedWithSize', {
          size: (file.size / (1024 * 1024)).toFixed(2),
        })
      );
    } catch (error) {
      setEditorInfo(
        error instanceof Error ? error.message : t('media.uploadVideoFailed')
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
            {t('editor.format.inlineCode')}
          </button>
          <button
            type="button"
            onClick={() => handleFormat('bold')}
            className="forum-pill-primary text-brand-primary-strong rounded-md px-2 py-1 text-xs font-semibold"
          >
            {t('editor.format.bold')}
          </button>
          <button
            type="button"
            onClick={() => handleFormat('italic')}
            className="forum-pill-primary text-brand-primary-strong rounded-md px-2 py-1 text-xs font-semibold"
          >
            {t('editor.format.italic')}
          </button>
          <button
            type="button"
            onClick={() => handleFormat('underline')}
            className="forum-pill-primary text-brand-primary-strong rounded-md px-2 py-1 text-xs font-semibold"
          >
            {t('editor.format.underline')}
          </button>
          <button
            type="button"
            onClick={() => handleFormat('quote')}
            className="forum-pill-primary text-brand-primary-strong rounded-md px-2 py-1 text-xs font-semibold"
          >
            {t('editor.format.quote')}
          </button>
          <button
            type="button"
            onClick={() => handleFormat('unorderedList')}
            className="forum-pill-primary text-brand-primary-strong rounded-md px-2 py-1 text-xs font-semibold"
          >
            {t('editor.format.unorderedList')}
          </button>
          <button
            type="button"
            onClick={() => handleFormat('orderedList')}
            className="forum-pill-primary text-brand-primary-strong rounded-md px-2 py-1 text-xs font-semibold"
          >
            {t('editor.format.orderedList')}
          </button>
          <button
            type="button"
            onClick={() => setIsToolsModalOpen(true)}
            className="forum-pill-accent text-brand-accent-strong rounded-md px-2 py-1 text-xs font-semibold"
          >
            {t('editor.moreTools')}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {[
            { key: 'black', value: '#111827' },
            { key: 'blue', value: '#2563EB' },
            { key: 'green', value: '#16A34A' },
            { key: 'red', value: '#DC2626' },
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
              {t(`editor.colors.${color.key}`)}
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
            {t('media.addImage')}
          </button>
          <button
            type="button"
            onClick={() => setIsVideoModalOpen(true)}
            className="forum-pill-accent text-brand-accent-strong rounded-md px-2 py-1 text-xs font-semibold"
          >
            {t('media.addVideo')}
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
                {t('attachment.add')}
              </button>
            </>
          ) : null}
        </div>
        <p className="text-ui-muted mt-2 text-xs">{t('media.imageLimits')}</p>
        {canManageAttachments ? (
          <p className="text-ui-muted mt-1 text-xs">
            {t('attachment.limits', {
              count: FORUM_ATTACHMENT_LIMITS.maxFiles,
              textSize: formatAttachmentSize(
                FORUM_ATTACHMENT_LIMITS.maxTextBytes
              ),
              zipSize: formatAttachmentSize(
                FORUM_ATTACHMENT_LIMITS.maxZipBytes
              ),
            })}
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
        {effectiveEditorLabel}
      </label>
      <textarea
        ref={textareaRef}
        id={editorId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={effectivePlaceholder}
        className="bg-surface-card text-ui-strong min-h-28 w-full rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-cyan-300"
      />

      {canManageAttachments && attachments.length > 0 ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-ui-strong text-xs font-semibold">
            {t('attachment.heading')}
          </p>
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
                  {t('common.remove')}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between">
        <p className="text-ui-muted text-xs">{t('editor.supportedTags')}</p>
        <button
          type="submit"
          className="bg-brand-primary-solid rounded-md px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-cyan-600"
        >
          {effectiveSubmitLabel}
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
        ariaLabel={t('media.addQdnVideo')}
        title={t('media.addVideo')}
        maxWidthClassName="max-w-lg"
      >
        <div className="space-y-3">
          <label className="block">
            <span className="text-ui-strong text-xs font-semibold">
              {t('media.qdnOrTube')}
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
              {t('media.displayTitle')}
            </span>
            <input
              value={videoTitle}
              onChange={(event) => setVideoTitle(event.target.value)}
              placeholder={t('media.optionalTitle')}
              className="bg-surface-card text-ui-strong mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <p className="text-ui-muted text-xs">{t('media.placeholderHelp')}</p>
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
                {isUploadingVideo
                  ? t('media.uploadingVideo')
                  : t('media.chooseVideo')}
              </button>
              <p className="text-ui-muted mt-2 text-xs">
                {t('media.videoLimits')}
              </p>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsVideoModalOpen(false)}
              className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleInsertVideo}
              disabled={isUploadingVideo}
              className="bg-brand-primary-solid rounded-md px-3 py-2 text-xs font-semibold text-slate-900"
            >
              {t('media.insertVideo')}
            </button>
          </div>
        </div>
      </AppModal>
    </form>
  );
};

export default RichTextEditor;
