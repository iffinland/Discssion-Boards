import AppModal from '../../../components/common/AppModal';
import RichTextEditor from '../../../components/forum/RichTextEditor';
import type { PostAttachment } from '../../../types';

type PostEditModalProps = {
  isOpen: boolean;
  editText: string;
  editAttachments: PostAttachment[];
  onEditTextChange: (value: string) => void;
  onEditAttachmentsChange: (attachments: PostAttachment[]) => void;
  onSubmit: () => Promise<boolean>;
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
  const handleSubmit = async () => {
    const didUpdate = await onSubmit();
    if (didUpdate) {
      onClose();
    }
  };

  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Edit Post"
      title="Edit Post"
      maxWidthClassName="max-w-4xl"
    >
      <div className="max-h-[78vh] overflow-y-auto pr-1">
        <RichTextEditor
          value={editText}
          attachments={editAttachments}
          onChange={onEditTextChange}
          onAttachmentsChange={onEditAttachmentsChange}
          onSubmit={() => void handleSubmit()}
          onUploadImage={onUploadImage}
          onUploadAttachment={onUploadAttachment}
          onUploadVideo={onUploadVideo}
          placeholder="Update your post..."
          editorLabel="Edit post editor"
          submitLabel="Save Changes"
          canManageAttachments
        />
      </div>
    </AppModal>
  );
};

export default PostEditModal;
