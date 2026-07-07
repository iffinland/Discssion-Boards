import AppModal from '../common/AppModal';

type ImagePreviewModalProps = {
  isOpen: boolean;
  imageSrc: string | null;
  onClose: () => void;
};

const ImagePreviewModal = ({
  isOpen,
  imageSrc,
  onClose,
}: ImagePreviewModalProps) => {
  if (!imageSrc) {
    return null;
  }

  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Image preview"
      title="Image Preview"
      maxWidthClassName="max-w-[80vw]"
    >
      <div className="flex max-h-[80vh] items-center justify-center overflow-auto">
        <img
          src={imageSrc}
          alt="Full size post image"
          className="h-auto max-h-[80vh] w-auto max-w-full rounded-md object-contain"
          loading="eager"
        />
      </div>
    </AppModal>
  );
};

export default ImagePreviewModal;
