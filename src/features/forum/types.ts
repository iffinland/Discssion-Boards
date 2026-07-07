export type ForumMutationResult = {
  ok: boolean;
  error?: string;
  subTopicId?: string;
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
  imageTag?: string;
};

export type ForumUploadAttachmentResult = {
  ok: boolean;
  error?: string;
  attachment?: import('../../types').PostAttachment;
};

export type ForumUploadVideoResult = {
  ok: boolean;
  error?: string;
  videoTag?: string;
};
