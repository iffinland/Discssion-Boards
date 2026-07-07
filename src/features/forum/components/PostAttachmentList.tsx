import { useEffect, useState } from 'react';

import AppModal from '../../../components/common/AppModal';
import {
  formatAttachmentSize,
  getAttachmentExtension,
} from '../../../services/forum/attachments';
import { forumQdnService } from '../../../services/qdn/forumQdnService';
import type { PostAttachment } from '../../../types';

type PostAttachmentListProps = {
  attachments: PostAttachment[];
};

const PostAttachmentList = ({ attachments }: PostAttachmentListProps) => {
  const [urlsById, setUrlsById] = useState<Record<string, string>>({});
  const [isResolvingUrls, setIsResolvingUrls] = useState(false);
  const [previewAttachment, setPreviewAttachment] =
    useState<PostAttachment | null>(null);
  const [previewContent, setPreviewContent] = useState('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  const triggerAttachmentDownload = (
    attachmentUrl: string,
    filename: string
  ) => {
    const link = document.createElement('a');
    link.href = attachmentUrl;
    link.download = filename;
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const isTextAttachment = (attachment: PostAttachment) => {
    const extension = getAttachmentExtension(attachment.filename);
    return extension === 'txt' || extension === 'md';
  };

  const closePreviewModal = () => {
    setPreviewAttachment(null);
    setPreviewContent('');
    setPreviewError(null);
    setIsPreviewLoading(false);
  };

  const openPreviewModal = (attachment: PostAttachment) => {
    setPreviewAttachment(attachment);
    setPreviewContent('');
    setPreviewError(null);
    setIsPreviewLoading(true);
  };

  useEffect(() => {
    let active = true;

    const resolveUrls = async () => {
      setIsResolvingUrls(true);
      const entries = await Promise.all(
        attachments.map(async (attachment) => {
          try {
            const url = await forumQdnService.getQdnResourceUrl({
              service: attachment.service,
              name: attachment.name,
              identifier: attachment.identifier,
              filename: attachment.filename,
            });

            return [attachment.id, url] as const;
          } catch {
            return [attachment.id, ''] as const;
          }
        })
      );

      if (!active) {
        return;
      }

      setUrlsById(Object.fromEntries(entries));
      setIsResolvingUrls(false);
    };

    if (attachments.length > 0) {
      void resolveUrls();
    } else {
      setUrlsById({});
      setIsResolvingUrls(false);
    }

    return () => {
      active = false;
    };
  }, [attachments]);

  useEffect(() => {
    if (!previewAttachment) {
      return;
    }

    const previewUrl = urlsById[previewAttachment.id];
    if (!previewUrl) {
      if (isResolvingUrls) {
        setIsPreviewLoading(true);
        return;
      }

      setIsPreviewLoading(false);
      setPreviewError('Unable to load attachment preview.');
      return;
    }

    let active = true;

    const loadPreviewContent = async () => {
      try {
        setIsPreviewLoading(true);
        setPreviewError(null);

        const response = await fetch(previewUrl);
        if (!response.ok) {
          throw new Error('Unable to load attachment preview.');
        }

        const text = await response.text();
        if (!active) {
          return;
        }

        setPreviewContent(text);
      } catch (error) {
        if (!active) {
          return;
        }

        setPreviewError(
          error instanceof Error
            ? error.message
            : 'Unable to load attachment preview.'
        );
      } finally {
        if (active) {
          setIsPreviewLoading(false);
        }
      }
    };

    void loadPreviewContent();

    return () => {
      active = false;
    };
  }, [isResolvingUrls, previewAttachment, urlsById]);

  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-ui-strong text-xs font-semibold">Attachments</p>
      <div className="mt-2 space-y-2">
        {attachments.map((attachment) => {
          const attachmentUrl = urlsById[attachment.id];

          return (
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
              {attachmentUrl ? (
                <div className="flex items-center gap-2">
                  {isTextAttachment(attachment) ? (
                    <button
                      type="button"
                      onClick={() => openPreviewModal(attachment)}
                      className="text-brand-primary rounded-md border border-cyan-200 bg-cyan-50 px-2 py-1 text-xs font-semibold"
                    >
                      View
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() =>
                      triggerAttachmentDownload(
                        attachmentUrl,
                        attachment.filename
                      )
                    }
                    className="text-ui-strong rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold"
                  >
                    Download
                  </button>
                </div>
              ) : (
                <span className="text-ui-muted text-xs font-semibold">
                  {isResolvingUrls ? 'Loading...' : 'Unavailable'}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <AppModal
        isOpen={Boolean(previewAttachment)}
        onClose={closePreviewModal}
        ariaLabel="Attachment preview"
        title={
          previewAttachment
            ? `Preview: ${previewAttachment.filename}`
            : 'Attachment preview'
        }
        maxWidthClassName="max-w-4xl"
      >
        {isPreviewLoading ? (
          <p className="text-ui-muted text-sm">Loading preview...</p>
        ) : previewError ? (
          <p className="text-brand-accent-strong text-sm font-semibold">
            {previewError}
          </p>
        ) : (
          <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-800">
            {previewContent}
          </pre>
        )}
      </AppModal>
    </div>
  );
};

export default PostAttachmentList;
