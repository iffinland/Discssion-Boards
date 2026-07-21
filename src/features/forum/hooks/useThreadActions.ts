import { useCallback, useState } from 'react';

import {
  buildPostShareLink,
  copyToClipboard,
} from '../../../services/qortium/share';
import { getQortBalance } from '../../../services/qortium/walletService';
import { tipRecoveryStore } from '../../../services/forum/tipRecoveryStore';
import type { Post, PostAttachment } from '../../../types';
import type {
  ForumMutationResult,
  ForumPollDraft,
  ForumTipRecipientResult,
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
  resolvePostTipRecipient: (postId: string) => Promise<ForumTipRecipientResult>;
  tipPost: (input: {
    postId: string;
    amountQort: string;
    recovery?: import('../../../services/qdn/forumTipsService').TipRecovery;
  }) => Promise<ForumMutationResult>;
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
  resolvePostTipRecipient,
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
  const [tipRecovery, setTipRecovery] = useState<
    import('../../../services/qdn/forumTipsService').TipRecovery | null
  >(null);
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

  const resolveTipRecipient = useCallback(
    async (postId: string) => {
      setIsResolvingTipRecipient(true);
      setTipResolveError(null);

      try {
        const result = await resolvePostTipRecipient(postId);
        if (!result.ok || !result.recipientName || !result.recipientAddress) {
          setTipRecipientAddress(null);
          setTipRecipientName('');
          setTipResolveError(
            result.error ?? 'Authoritative Post owner could not be resolved.'
          );
          return null;
        }
        setTipRecipientName(result.recipientName);
        setTipRecipientAddress(result.recipientAddress);
        return result.recipientAddress;
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
    },
    [resolvePostTipRecipient]
  );

  const handleSendTip = useCallback(
    async (post: Post) => {
      const preserveRecovery = tipTargetPostId === post.id ? tipRecovery : null;
      const storedRecovery = preserveRecovery ?? tipRecoveryStore.read(post.id);
      setTipTargetPostId(post.id);
      setTipRecipientName(storedRecovery?.body.recipientName ?? '');
      setTipAmount(storedRecovery?.body.amountQort ?? '0');
      setTipRecipientAddress(null);
      setTipResolveError(null);
      setIsTipModalOpen(true);
      setTipRecovery(storedRecovery);

      setIsTipBalanceLoading(true);
      try {
        const balance = await getQortBalance();
        setQortBalance(balance);
      } catch {
        setQortBalance(null);
      } finally {
        setIsTipBalanceLoading(false);
      }

      void resolveTipRecipient(post.id);
    },
    [resolveTipRecipient, tipRecovery, tipTargetPostId]
  );

  const closeTipModal = useCallback(() => {
    if (isSendingTip) {
      return;
    }

    setIsTipModalOpen(false);
  }, [isSendingTip]);

  const submitTip = useCallback(async () => {
    const targetPostId = tipTargetPostId;
    if (!targetPostId) {
      setFeedback('Tip target Post is missing.');
      return;
    }
    const parsedAmount = Number(tipAmount);
    const trimmedRecipientName = tipRecipientName.trim();

    if (!trimmedRecipientName) {
      setFeedback('Recipient name is missing.');
      return;
    }

    if (!tipRecovery && (!Number.isFinite(parsedAmount) || parsedAmount <= 0)) {
      setFeedback('Enter a QORT amount greater than 0.');
      return;
    }

    if (
      !tipRecovery &&
      typeof qortBalance === 'number' &&
      parsedAmount > qortBalance
    ) {
      setFeedback('Entered amount is higher than your wallet balance.');
      return;
    }

    const resolvedAddress =
      tipRecipientAddress ?? (await resolveTipRecipient(targetPostId));
    if (!resolvedAddress) {
      setFeedback('Recipient wallet address could not be resolved.');
      return;
    }

    try {
      setIsSendingTip(true);
      const tipPersistResult = await tipPost({
        postId: targetPostId,
        amountQort: tipAmount,
        ...(tipRecovery ? { recovery: tipRecovery } : {}),
      });
      if (!tipPersistResult.ok) {
        setFeedback(
          tipPersistResult.error ?? 'Unable to verify and publish the tip.'
        );
        return;
      }
      if (tipPersistResult.partial && tipPersistResult.tipRecovery) {
        setTipRecovery(tipPersistResult.tipRecovery);
        tipRecoveryStore.write(tipPersistResult.tipRecovery);
        setFeedback(
          tipPersistResult.error ??
            `QORT was sent to @${trimmedRecipientName}; tip reference synchronization is pending. Retry will not resend QORT.`
        );
        return;
      }

      setIsTipModalOpen(false);
      setTipAmount('0');
      setTipRecovery(null);
      tipRecoveryStore.remove(targetPostId);
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
    tipRecovery,
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
    isTipRecoveryPending: Boolean(tipRecovery),
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
