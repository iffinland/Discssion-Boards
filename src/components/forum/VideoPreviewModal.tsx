import { useEffect, useState } from 'react';

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
              : 'Unable to load QDN video.'
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
  }, [isOpen, reference]);

  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Video preview"
      title={reference ? toVideoDisplayTitle(reference) : 'Video Preview'}
      maxWidthClassName="max-w-3xl"
    >
      <div className="space-y-3">
        {isLoading ? (
          <div className="flex aspect-video items-center justify-center rounded-lg bg-slate-950 text-sm font-semibold text-slate-100">
            Loading video from QDN...
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
            Video is not loaded.
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
