import { useCallback, useState } from 'react';

import {
  buildPostShareLink,
  copyToClipboard,
} from '../../../services/qortium/share';
import { requestQortium } from '../../../services/qortium/qortiumClient';
import {
  getQortBalance,
  resolveNameWalletAddress,
} from '../../../services/qortium/walletService';
import type { Post, PostAttachment } from '../../../types';
import type {
  ForumMutationResult,
  ForumPollDraft,
  ForumUploadAttachmentResult,
  ForumUploadImageResult,
  ForumUploadVideoResult,
} from '../types';

type UseThreadActionsParams = {
  threadId?: string;
  createPost: (input: {
    subTopicId: string;
    content: string;
    parentPostId?: string | null;
    attachments?: PostAttachment[];
    poll?: ForumPollDraft | null;
    nativePollRecovery?: import('../../../services/architectureV2/types').NativePollRecovery;
  }) => Promise<ForumMutationResult>;
  uploadPostImage: (file: File) => Promise<ForumUploadImageResult>;
  uploadPostAttachment: (file: File) => Promise<ForumUploadAttachmentResult>;
  uploadPostVideo: (
    file: File,
    title?: string
  ) => Promise<ForumUploadVideoResult>;
  updatePost: (input: {
    postId: string;
    content: string;
    attachments?: PostAttachment[];
  }) => Promise<ForumMutationResult>;
  deletePost: (input: {
    postId: string;
    reason?: string | null;
  }) => Promise<ForumMutationResult>;
  tipPost: (postId: string) => Promise<ForumMutationResult>;
  resolveAuthorDisplayName: (authorUserId: string) => string;
};

export const useThreadActions = ({
  threadId,
  createPost,
  uploadPostImage,
  uploadPostAttachment,
  uploadPostVideo,
  updatePost,
  deletePost,
  tipPost,
  resolveAuthorDisplayName,
}: UseThreadActionsParams) => {
  const [replyText, setReplyText] = useState('');
  const [replyTarget, setReplyTarget] = useState<Post | null>(null);
  const [replyAttachments, setReplyAttachments] = useState<PostAttachment[]>(
    []
  );
  const [pollDraft, setPollDraft] = useState<ForumPollDraft | null>(null);
  const [nativePollRecovery, setNativePollRecovery] = useState<
    import('../../../services/architectureV2/types').NativePollRecovery | null
  >(null);
  const [isTipModalOpen, setIsTipModalOpen] = useState(false);
  const [tipAmount, setTipAmount] = useState('0');
  const [tipRecipientName, setTipRecipientName] = useState('');
  const [tipRecipientAddress, setTipRecipientAddress] = useState<string | null>(
    null
  );
  const [tipResolveError, setTipResolveError] = useState<string | null>(null);
  const [isResolvingTipRecipient, setIsResolvingTipRecipient] = useState(false);
  const [isSendingTip, setIsSendingTip] = useState(false);
  const [qortBalance, setQortBalance] = useState<number | null>(null);
  const [isTipBalanceLoading, setIsTipBalanceLoading] = useState(false);
  const [tipTargetPostId, setTipTargetPostId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleSubmitReply = useCallback(async () => {
    if (!threadId) {
      return false;
    }

    const result = await createPost({
      subTopicId: threadId,
      content: replyText,
      parentPostId: replyTarget?.id ?? null,
      attachments: replyAttachments,
      poll: replyTarget ? null : pollDraft,
      nativePollRecovery: replyTarget
        ? undefined
        : (nativePollRecovery ?? undefined),
    });

    if (!result.ok) {
      if (result.nativePollRecovery) {
        setNativePollRecovery(result.nativePollRecovery);
      }
      setFeedback(result.error ?? 'Unable to publish post.');
      return false;
    }

    setReplyText('');
    setReplyTarget(null);
    setReplyAttachments([]);
    setPollDraft(null);
    setNativePollRecovery(null);
    setFeedback(replyTarget ? 'Reply published.' : 'Post published.');
    return true;
  }, [
    createPost,
    pollDraft,
    nativePollRecovery,
    replyAttachments,
    replyTarget,
    replyText,
    threadId,
  ]);

  const handleReplyToPost = useCallback(
    (post: Post) => {
      const authorName = resolveAuthorDisplayName(post.authorUserId);
      setReplyTarget(post);
      setReplyText((current) => (current.trim() ? current : `@${authorName} `));
    },
    [resolveAuthorDisplayName]
  );

  const handleCancelReplyTarget = useCallback(() => {
    setReplyTarget(null);
  }, []);

  const resetComposer = useCallback(() => {
    setReplyText('');
    setReplyTarget(null);
    setReplyAttachments([]);
    setPollDraft(null);
    setNativePollRecovery(null);
  }, []);

  const handleEditPost = useCallback(
    async (postId: string, content: string, attachments?: PostAttachment[]) => {
      const result = await updatePost({ postId, content, attachments });
      if (!result.ok) {
        setFeedback(result.error ?? 'Unable to update post.');
        return false;
      }

      setFeedback('Post updated.');
      return true;
    },
    [updatePost]
  );

  const handleDeletePost = useCallback(
    async (postId: string) => {
      const result = await deletePost({ postId });
      if (!result.ok) {
        setFeedback(result.error ?? 'Unable to delete post.');
        return;
      }

      setFeedback('Post deleted.');
    },
    [deletePost]
  );

  const handleSharePost = useCallback(
    async (post: Post) => {
      if (!threadId || typeof window === 'undefined') {
        return;
      }

      const copied = await copyToClipboard(
        buildPostShareLink(threadId, post.id)
      );
      if (!copied) {
        setFeedback('Unable to copy post link to clipboard.');
        return;
      }

      setFeedback('Post link copied to clipboard.');
      window.setTimeout(() => {
        setFeedback((current) =>
          current === 'Post link copied to clipboard.' ? null : current
        );
      }, 2400);
    },
    [threadId]
  );

  const resolveTipRecipient = useCallback(async (recipientName: string) => {
    const normalizedName = recipientName.trim();
    if (!normalizedName) {
      setTipRecipientAddress(null);
      setTipResolveError('Recipient name is missing.');
      return null;
    }

    setIsResolvingTipRecipient(true);
    setTipResolveError(null);

    try {
      const address = await resolveNameWalletAddress(normalizedName);
      if (!address) {
        setTipRecipientAddress(null);
        setTipResolveError('Recipient wallet address could not be resolved.');
        return null;
      }

      setTipRecipientAddress(address);
      return address;
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Recipient wallet address lookup failed.';
      setTipRecipientAddress(null);
      setTipResolveError(message);
      return null;
    } finally {
      setIsResolvingTipRecipient(false);
    }
  }, []);

  const handleSendTip = useCallback(
    async (post: Post) => {
      const recipientName = post.authorUserId.trim();
      setTipTargetPostId(post.id);
      setTipRecipientName(recipientName);
      setTipAmount('0');
      setTipRecipientAddress(null);
      setTipResolveError(null);
      setIsTipModalOpen(true);

      setIsTipBalanceLoading(true);
      try {
        const balance = await getQortBalance();
        setQortBalance(balance);
      } catch {
        setQortBalance(null);
      } finally {
        setIsTipBalanceLoading(false);
      }

      void resolveTipRecipient(recipientName);
    },
    [resolveTipRecipient]
  );

  const closeTipModal = useCallback(() => {
    if (isSendingTip) {
      return;
    }

    setIsTipModalOpen(false);
  }, [isSendingTip]);

  const submitTip = useCallback(async () => {
    const parsedAmount = Number(tipAmount);
    const trimmedRecipientName = tipRecipientName.trim();

    if (!trimmedRecipientName) {
      setFeedback('Recipient name is missing.');
      return;
    }

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFeedback('Enter a QORT amount greater than 0.');
      return;
    }

    if (typeof qortBalance === 'number' && parsedAmount > qortBalance) {
      setFeedback('Entered amount is higher than your wallet balance.');
      return;
    }

    const resolvedAddress =
      tipRecipientAddress ?? (await resolveTipRecipient(trimmedRecipientName));
    if (!resolvedAddress) {
      setFeedback('Recipient wallet address could not be resolved.');
      return;
    }

    try {
      setIsSendingTip(true);
      await requestQortium({
        action: 'SEND_COIN',
        coin: 'QORT',
        recipient: resolvedAddress,
        amount: parsedAmount,
      });

      if (tipTargetPostId) {
        const tipPersistResult = await tipPost(tipTargetPostId);
        if (!tipPersistResult.ok) {
          setFeedback(
            tipPersistResult.error ??
              `Tip sent to @${trimmedRecipientName}, but counter sync failed.`
          );
          return;
        }
      }

      setIsTipModalOpen(false);
      setTipAmount('0');
      setFeedback(`Tip sent to @${trimmedRecipientName}.`);
      try {
        const balance = await getQortBalance();
        setQortBalance(balance);
      } catch {
        // Keep last known balance if refresh fails.
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Tip transfer failed.';
      setFeedback(message);
    } finally {
      setIsSendingTip(false);
    }
  }, [
    qortBalance,
    resolveTipRecipient,
    tipAmount,
    tipRecipientAddress,
    tipRecipientName,
    tipPost,
    tipTargetPostId,
  ]);

  const uploadImageForReply = useCallback(
    async (file: File): Promise<string> => {
      const result = await uploadPostImage(file);
      if (!result.ok || !result.imageTag) {
        throw new Error(result.error ?? 'Unable to upload image.');
      }

      return result.imageTag;
    },
    [uploadPostImage]
  );

  const uploadAttachmentForReply = useCallback(
    async (file: File): Promise<PostAttachment> => {
      const result = await uploadPostAttachment(file);
      if (!result.ok || !result.attachment) {
        throw new Error(result.error ?? 'Unable to upload attachment.');
      }

      return result.attachment;
    },
    [uploadPostAttachment]
  );

  const uploadVideoForReply = useCallback(
    async (file: File, title?: string): Promise<string> => {
      const result = await uploadPostVideo(file, title);
      if (!result.ok || !result.videoTag) {
        throw new Error(result.error ?? 'Unable to upload video.');
      }

      return result.videoTag;
    },
    [uploadPostVideo]
  );

  return {
    replyText,
    replyTarget,
    replyAttachments,
    pollDraft,
    setReplyText,
    setReplyAttachments,
    setPollDraft: (draft: ForumPollDraft | null) => {
      setNativePollRecovery(null);
      setPollDraft(draft);
    },
    feedback,
    isTipModalOpen,
    tipAmount,
    tipRecipientName,
    tipRecipientAddress,
    tipResolveError,
    isResolvingTipRecipient,
    isSendingTip,
    isTipBalanceLoading,
    formattedTipBalance:
      typeof qortBalance === 'number' ? qortBalance.toFixed(8) : '0.00000000',
    handleSubmitReply,
    handleReplyToPost,
    handleCancelReplyTarget,
    resetComposer,
    handleEditPost,
    handleDeletePost,
    handleSharePost,
    handleSendTip,
    closeTipModal,
    setTipAmount,
    submitTip,
    uploadImageForReply,
    uploadAttachmentForReply,
    uploadVideoForReply,
  };
};
