import type { PostAttachment } from '../../../types';
import RichTextContent from '../../../components/forum/RichTextContent';
import RichTextEditor from '../../../components/forum/RichTextEditor';
import type { ForumPollDraft } from '../types';

type ThreadComposerProps = {
  replyText: string;
  replyAttachments: PostAttachment[];
  replyTargetAuthorName?: string | null;
  replyTargetContent?: string | null;
  title?: string;
  showTitle?: boolean;
  placeholder?: string;
  submitLabel?: string;
  pollDraft?: ForumPollDraft | null;
  canAddPoll?: boolean;
  onReplyTextChange: (value: string) => void;
  onReplyAttachmentsChange: (attachments: PostAttachment[]) => void;
  onPollDraftChange?: (draft: ForumPollDraft | null) => void;
  onSubmit: () => void;
  onUploadImage: (file: File) => Promise<string>;
  onUploadAttachment: (file: File) => Promise<PostAttachment>;
  onUploadVideo: (file: File, title?: string) => Promise<string>;
  onCancelReplyTarget?: () => void;
  disabled?: boolean;
  helperText?: string | null;
};

const toDateTimeLocalValue = (value: string | null | undefined) => {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

const fromDateTimeLocalValue = (value: string) => {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const ThreadComposer = ({
  replyText,
  replyAttachments,
  replyTargetAuthorName = null,
  replyTargetContent = null,
  title = 'Add New Post',
  showTitle = true,
  placeholder = 'Share your thoughts with the community...',
  submitLabel = 'Publish Post',
  pollDraft = null,
  canAddPoll = false,
  onReplyTextChange,
  onReplyAttachmentsChange,
  onPollDraftChange,
  onSubmit,
  onUploadImage,
  onUploadAttachment,
  onUploadVideo,
  onCancelReplyTarget,
  disabled = false,
  helperText = null,
}: ThreadComposerProps) => {
  const updatePollDraft = (next: ForumPollDraft | null) => {
    onPollDraftChange?.(next);
  };

  const ensurePollDraft = () => {
    updatePollDraft({
      question: '',
      description: '',
      mode: 'single',
      options: ['', ''],
      closesAt: null,
    });
  };

  const updatePollOption = (index: number, value: string) => {
    if (!pollDraft) {
      return;
    }

    updatePollDraft({
      ...pollDraft,
      options: pollDraft.options.map((option, optionIndex) =>
        optionIndex === index ? value : option
      ),
    });
  };

  const addPollOption = () => {
    if (!pollDraft || pollDraft.options.length >= 6) {
      return;
    }

    updatePollDraft({
      ...pollDraft,
      options: [...pollDraft.options, ''],
    });
  };

  const removePollOption = (index: number) => {
    if (!pollDraft || pollDraft.options.length <= 2) {
      return;
    }

    updatePollDraft({
      ...pollDraft,
      options: pollDraft.options.filter(
        (_, optionIndex) => optionIndex !== index
      ),
    });
  };

  if (disabled) {
    return (
      <section>
        {showTitle ? (
          <h3 className="text-brand-primary mb-2 text-base font-semibold">
            {title}
          </h3>
        ) : null}
        <div className="forum-card-accent p-4 text-sm text-slate-600">
          {helperText ?? 'Replies are currently disabled for this thread.'}
        </div>
      </section>
    );
  }

  return (
    <section>
      {showTitle ? (
        <h3 className="text-brand-primary mb-2 text-base font-semibold">
          {title}
        </h3>
      ) : null}
      {replyTargetAuthorName && replyTargetContent ? (
        <div className="forum-card-accent mb-3 border-l-4 border-cyan-300 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-ui-strong text-xs font-semibold">
              Replying to {replyTargetAuthorName}
            </p>
            {onCancelReplyTarget ? (
              <button
                type="button"
                onClick={onCancelReplyTarget}
                className="text-ui-muted rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold"
              >
                Cancel Reply
              </button>
            ) : null}
          </div>
          <RichTextContent
            value={replyTargetContent}
            className="text-ui-muted text-xs leading-relaxed"
          />
        </div>
      ) : null}
      {canAddPoll ? (
        <div className="forum-card-accent mb-3 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-ui-strong text-sm font-semibold">
                Poll / Voting
              </p>
              <p className="text-ui-muted text-xs">
                Add a structured poll with 2-6 answer options.
              </p>
            </div>
            {pollDraft ? (
              <button
                type="button"
                onClick={() => updatePollDraft(null)}
                className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 active:translate-y-px"
              >
                Remove Poll
              </button>
            ) : (
              <button
                type="button"
                onClick={ensurePollDraft}
                className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-slate-800 transition hover:bg-cyan-100 active:translate-y-px"
              >
                Add Poll
              </button>
            )}
          </div>

          {pollDraft ? (
            <div className="mt-3 space-y-3">
              <input
                value={pollDraft.question}
                onChange={(event) =>
                  updatePollDraft({
                    ...pollDraft,
                    question: event.target.value,
                  })
                }
                placeholder="Poll question"
                className="bg-surface-card text-ui-strong w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
              <textarea
                value={pollDraft.description}
                onChange={(event) =>
                  updatePollDraft({
                    ...pollDraft,
                    description: event.target.value,
                  })
                }
                placeholder="Optional poll description"
                className="bg-surface-card text-ui-strong min-h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Poll closing date
                <input
                  type="datetime-local"
                  value={toDateTimeLocalValue(pollDraft.closesAt)}
                  onChange={(event) =>
                    updatePollDraft({
                      ...pollDraft,
                      closesAt: fromDateTimeLocalValue(event.target.value),
                    })
                  }
                  className="bg-surface-card text-ui-strong w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-normal"
                />
              </label>
              <div className="grid gap-2">
                {pollDraft.options.map((option, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      value={option}
                      onChange={(event) =>
                        updatePollOption(index, event.target.value)
                      }
                      placeholder={`Option ${index + 1}`}
                      className="bg-surface-card text-ui-strong w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => removePollOption(index)}
                      disabled={pollDraft.options.length <= 2}
                      className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={addPollOption}
                  disabled={pollDraft.options.length >= 6}
                  className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-slate-800 transition hover:bg-cyan-100 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Add Option
                </button>
                <label className="text-ui-muted flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={pollDraft.mode === 'multiple'}
                    onChange={(event) =>
                      updatePollDraft({
                        ...pollDraft,
                        mode: event.target.checked ? 'multiple' : 'single',
                      })
                    }
                  />
                  Allow multiple answers
                </label>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <RichTextEditor
        value={replyText}
        attachments={replyAttachments}
        onChange={onReplyTextChange}
        onAttachmentsChange={onReplyAttachmentsChange}
        onSubmit={onSubmit}
        onUploadImage={onUploadImage}
        onUploadAttachment={onUploadAttachment}
        onUploadVideo={onUploadVideo}
        placeholder={placeholder}
        submitLabel={submitLabel}
      />
    </section>
  );
};

export default ThreadComposer;
