import { useCallback, useEffect, useState } from 'react';
import AppModal from '../../../components/common/AppModal';
import RichTextEditor from '../../../components/forum/RichTextEditor';
import type { PostAttachment } from '../../../types';
import { useTranslation } from 'react-i18next';
import type { PostEditSubmitResult } from '../types';

type PostEditModalProps = {
  isOpen: boolean;
  editText: string;
  editAttachments: PostAttachment[];
  onEditTextChange: (value: string) => void;
  onEditAttachmentsChange: (attachments: PostAttachment[]) => void;
  onSubmit: () => Promise<PostEditSubmitResult>;
  onUploadImage: (file: File) => Promise<string>;
  onUploadAttachment: (file: File) => Promise<PostAttachment>;
  onUploadVideo: (file: File, title?: string) => Promise<string>;
  onClose: () => void;
};

const PostEditModal = ({
  isOpen,
  editText,
  editAttachments,
  onEditTextChange,
  onEditAttachmentsChange,
  onSubmit,
  onUploadImage,
  onUploadAttachment,
  onUploadVideo,
  onClose,
}: PostEditModalProps) => {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    if (submitting) {
      return;
    }
    onClose();
  }, [onClose, submitting]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && submitting) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, submitting]);

  const handleSubmit = async () => {
    if (submitting) {
      return;
    }

    setSubmitError(null);
    setSubmitting(true);
    try {
      const result = await onSubmit();
      if (result.ok) {
        onClose();
      } else {
        setSubmitError(result.error ?? t('post.editFailed'));
      }
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : t('post.editFailed')
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppModal
      isOpen={isOpen}
      onClose={handleClose}
      ariaLabel={t('post.edit')}
      title={t('post.edit')}
      maxWidthClassName="max-w-4xl"
    >
      <div className="max-h-[78vh] overflow-y-auto pr-1">
        {submitError ? (
          <p
            className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"
            role="alert"
          >
            {submitError}
          </p>
        ) : null}
        <RichTextEditor
          value={editText}
          attachments={editAttachments}
          onChange={onEditTextChange}
          onAttachmentsChange={onEditAttachmentsChange}
          onSubmit={handleSubmit}
          onUploadImage={onUploadImage}
          onUploadAttachment={onUploadAttachment}
          onUploadVideo={onUploadVideo}
          placeholder={t('post.updatePlaceholder')}
          editorLabel={t('post.editEditor')}
          submitLabel={submitting ? t('post.saving') : t('post.saveChanges')}
          canManageAttachments
          submitting={submitting}
        />
      </div>
    </AppModal>
  );
};

export default PostEditModal;
