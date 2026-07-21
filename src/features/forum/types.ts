export type ForumMutationResult = {
  ok: boolean;
  error?: string;
  subTopicId?: string;
  partial?: {
    pending:
      | 'compatibility'
      | 'derived-index'
      | 'native-poll-confirmation'
      | 'poll-reference'
      | 'poll-result-refresh'
      | 'moderation-operations'
      | 'role-state-refresh'
      | 'tip-transaction-verification'
      | 'tip-reference-publication'
      | 'tip-reference-refresh'
      | 'tip-derived-cache';
    retryable: true;
  };
  nativePollRecovery?: import('../../services/architectureV2/types').NativePollRecovery;
  transactionSignature?: string;
  tipRecovery?: import('../../services/qdn/forumTipsService').TipRecovery;
};

export type ForumTipRecipientResult = {
  ok: boolean;
  error?: string;
  recipientName?: string;
  recipientAddress?: string;
};

export type ForumPollDraft = {
  question: string;
  description: string;
  mode: import('../../types').PostPollMode;
  options: string[];
  closesAt: string | null;
};

export type ForumUploadImageResult = {
  ok: boolean;
  error?: string;
  code?: string;
  recovery?: import('../../services/qortium/qdnFilePublication').QdnFilePublicationRecovery;
  imageTag?: string;
};

export type ForumUploadAttachmentResult = {
  ok: boolean;
  error?: string;
  code?: string;
  recovery?: import('../../services/qortium/qdnFilePublication').QdnFilePublicationRecovery;
  attachment?: import('../../types').PostAttachment;
};

export type ForumUploadVideoResult = {
  ok: boolean;
  error?: string;
  code?: string;
  recovery?: import('../../services/qortium/qdnFilePublication').QdnFilePublicationRecovery;
  videoTag?: string;
};
