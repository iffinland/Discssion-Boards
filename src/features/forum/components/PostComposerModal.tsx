import AppModal from '../../../components/common/AppModal';
import type { PostAttachment } from '../../../types';
import type { ForumPollDraft } from '../types';
import ThreadComposer from './ThreadComposer';

type PostComposerModalProps = {
  isOpen: boolean;
  title: string;
  placeholder: string;
  submitLabel: string;
  replyText: string;
  replyAttachments: PostAttachment[];
  pollDraft?: ForumPollDraft | null;
  canAddPoll?: boolean;
  replyTargetAuthorName?: string | null;
  replyTargetContent?: string | null;
  onReplyTextChange: (value: string) => void;
  onReplyAttachmentsChange: (attachments: PostAttachment[]) => void;
  onPollDraftChange?: (draft: ForumPollDraft | null) => void;
  onSubmit: () => Promise<boolean>;
  onUploadImage: (file: File) => Promise<string>;
  onUploadAttachment: (file: File) => Promise<PostAttachment>;
  onUploadVideo: (file: File, title?: string) => Promise<string>;
  onCancelReplyTarget?: () => void;
  onClose: () => void;
  disabled?: boolean;
  helperText?: string | null;
};

const PostComposerModal = ({
  isOpen,
  title,
  placeholder,
  submitLabel,
  replyText,
  replyAttachments,
  pollDraft = null,
  canAddPoll = false,
  replyTargetAuthorName = null,
  replyTargetContent = null,
  onReplyTextChange,
  onReplyAttachmentsChange,
  onPollDraftChange,
  onSubmit,
  onUploadImage,
  onUploadAttachment,
  onUploadVideo,
  onCancelReplyTarget,
  onClose,
  disabled = false,
  helperText = null,
}: PostComposerModalProps) => {
  const handleSubmit = async () => {
    const didPublish = await onSubmit();
    if (didPublish) {
      onClose();
    }
  };

  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={title}
      title={title}
      maxWidthClassName="max-w-4xl"
    >
      <div className="max-h-[78vh] overflow-y-auto pr-1">
        <ThreadComposer
          title={title}
          showTitle={false}
          placeholder={placeholder}
          submitLabel={submitLabel}
          replyText={replyText}
          replyAttachments={replyAttachments}
          pollDraft={pollDraft}
          canAddPoll={canAddPoll}
          replyTargetAuthorName={replyTargetAuthorName}
          replyTargetContent={replyTargetContent}
          onReplyTextChange={onReplyTextChange}
          onReplyAttachmentsChange={onReplyAttachmentsChange}
          onPollDraftChange={onPollDraftChange}
          onSubmit={() => void handleSubmit()}
          onUploadImage={onUploadImage}
          onUploadAttachment={onUploadAttachment}
          onUploadVideo={onUploadVideo}
          onCancelReplyTarget={onCancelReplyTarget}
          disabled={disabled}
          helperText={helperText}
        />
      </div>
    </AppModal>
  );
};

export default PostComposerModal;
