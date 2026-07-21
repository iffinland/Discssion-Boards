import AppModal from '../common/AppModal';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
  if (!imageSrc) {
    return null;
  }

  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={t('media.imagePreviewLabel')}
      title={t('media.imagePreview')}
      maxWidthClassName="max-w-[80vw]"
    >
      <div className="flex max-h-[80vh] items-center justify-center overflow-auto">
        <img
          src={imageSrc}
          alt={t('media.fullSizeImage')}
          className="h-auto max-h-[80vh] w-auto max-w-full rounded-md object-contain"
          loading="eager"
        />
      </div>
    </AppModal>
  );
};

export default ImagePreviewModal;
