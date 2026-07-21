import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  resolveForumVideoUrl,
  toVideoDisplayTitle,
  type ForumVideoReference,
} from '../../services/forum/videoEmbed';
import AppModal from '../common/AppModal';

type VideoPreviewModalProps = {
  isOpen: boolean;
  reference: ForumVideoReference | null;
  onClose: () => void;
};

const VideoPreviewModal = ({
  isOpen,
  reference,
  onClose,
}: VideoPreviewModalProps) => {
  const { t } = useTranslation();
  const [videoUrl, setVideoUrl] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let active = true;

    const loadVideo = async () => {
      setVideoUrl('');
      setError('');

      if (!isOpen || !reference) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const nextUrl = await resolveForumVideoUrl(reference);
        if (active) {
          setVideoUrl(nextUrl);
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : t('media.videoLoadFailed')
          );
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void loadVideo();

    return () => {
      active = false;
    };
  }, [isOpen, reference, t]);

  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={t('media.videoPreviewLabel')}
      title={
        reference ? toVideoDisplayTitle(reference) : t('media.videoPreview')
      }
      maxWidthClassName="max-w-3xl"
    >
      <div className="space-y-3">
        {isLoading ? (
          <div className="flex aspect-video items-center justify-center rounded-lg bg-slate-950 text-sm font-semibold text-slate-100">
            {t('media.loadingVideo')}
          </div>
        ) : videoUrl ? (
          <video
            controls
            preload="metadata"
            src={videoUrl}
            className="aspect-video w-full rounded-lg bg-slate-950"
          />
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-lg bg-slate-950 text-sm font-semibold text-slate-100">
            {t('media.videoNotLoaded')}
          </div>
        )}
        {error ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
            {error}
          </p>
        ) : null}
        {reference ? (
          <p className="text-ui-muted break-all text-xs">
            {reference.service}/{reference.name}/{reference.identifier}
          </p>
        ) : null}
      </div>
    </AppModal>
  );
};

export default VideoPreviewModal;
