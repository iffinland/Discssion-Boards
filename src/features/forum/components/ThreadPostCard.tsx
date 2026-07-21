import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import UserRoleBadge from '../../../components/common/UserRoleBadge';
import RichTextContent from '../../../components/forum/RichTextContent';
import type { Post, User, UserRole } from '../../../types';
import PostAttachmentList from './PostAttachmentList';
import { isNativePostPoll } from '../../../services/architectureV2/polls.js';

type ThreadPostCardProps = {
  post: Post;
  author: User | undefined;
  authorRole: UserRole;
  repliedPost?: Post | null;
  repliedAuthorName?: string | null;
  highlighted?: boolean;
  searchQuery?: string;
  replyContextHighlighted?: boolean;
  isOwner: boolean;
  canModerate: boolean;
  hasLiked: boolean;
  pollVoterId: string;
  canClosePoll: boolean;
  onLike: (postId: string) => void;
  onVoteOnPoll: (postId: string, optionIds: string[]) => void;
  onClosePoll: (postId: string) => void;
  onReply: (post: Post) => void;
  onShare: (post: Post) => void;
  onSendTip: (post: Post) => void;
  onJumpToPost?: (postId: string) => void;
  onEdit: (post: Post) => void;
  onDelete: (postId: string) => void;
  onTogglePin: (post: Post) => void;
};

const getInitials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

const ThreadPostCard = ({
  post,
  author,
  authorRole,
  repliedPost = null,
  repliedAuthorName = null,
  highlighted = false,
  searchQuery = '',
  replyContextHighlighted = false,
  isOwner,
  canModerate,
  hasLiked,
  pollVoterId,
  canClosePoll,
  onLike,
  onVoteOnPoll,
  onClosePoll,
  onReply,
  onShare,
  onSendTip,
  onJumpToPost,
  onEdit,
  onDelete,
  onTogglePin,
}: ThreadPostCardProps) => {
  const { t, i18n } = useTranslation();
  const formatDateTime = (value: string) =>
    new Date(value).toLocaleString(i18n.language, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  const displayName =
    author?.displayName ??
    author?.id ??
    post.authorUserId ??
    t('common.unknownUser');
  const avatarColor = author?.avatarColor ?? 'bg-cyan-500';
  const [isAvatarVisible, setIsAvatarVisible] = useState(true);
  const [selectedPollOptionIds, setSelectedPollOptionIds] = useState<string[]>(
    []
  );
  const nativePoll = isNativePostPoll(post.poll) ? post.poll : null;
  const legacyPoll =
    post.poll && !isNativePostPoll(post.poll) ? post.poll : null;
  const nativeRuntime = nativePoll?.runtime;
  const existingPollVote = nativePoll
    ? nativeRuntime && nativeRuntime.currentUserOptionIndexes.length > 0
      ? {
          optionIds: nativeRuntime.currentUserOptionIndexes.map(
            (index) => `native:${index}`
          ),
        }
      : undefined
    : legacyPoll?.votes.find((vote) => vote.voterId === pollVoterId);
  const totalPollVoters = nativePoll
    ? (nativeRuntime?.totalVoters ?? 0)
    : (legacyPoll?.votes.length ?? 0);
  const totalPollSelections = nativePoll
    ? (nativeRuntime?.totalSelections ?? 0)
    : (legacyPoll?.votes.length ?? 0);
  const pollClosedByDate = Boolean(
    legacyPoll?.closesAt &&
      new Date(legacyPoll.closesAt).getTime() <= Date.now()
  );
  const isPollClosed = nativePoll
    ? (nativeRuntime?.isClosed ?? false)
    : Boolean(legacyPoll?.closedAt || pollClosedByDate);
  const pollClosedAt = nativePoll
    ? (nativeRuntime?.closesAt ?? nativePoll.displayCache.closesAt)
    : (legacyPoll?.closedAt ?? legacyPoll?.closesAt ?? null);
  const pollMode = nativePoll
    ? (nativeRuntime?.selectionMode ?? nativePoll.displayCache.selectionMode)
    : (legacyPoll?.mode ?? 'single');
  const pollQuestion = nativePoll
    ? (nativeRuntime?.question ?? nativePoll.displayCache.question)
    : (legacyPoll?.question ?? '');
  const pollDescription = nativePoll
    ? (nativeRuntime?.description ?? nativePoll.displayCache.description)
    : (legacyPoll?.description ?? '');
  const pollClosesAt = nativePoll
    ? (nativeRuntime?.closesAt ?? nativePoll.displayCache.closesAt)
    : (legacyPoll?.closesAt ?? null);
  const canShowPollResults = Boolean(existingPollVote || isPollClosed);
  const pollOptionStats = nativePoll
    ? (
        nativeRuntime?.options ??
        nativePoll.displayCache.options.map((option) => ({
          ...option,
          id: `native:${option.index}`,
          rawVoteCount: 0,
        }))
      ).map((option) => {
        const voteCount = option.rawVoteCount;
        const percentage =
          totalPollSelections > 0
            ? Math.round((voteCount / totalPollSelections) * 100)
            : 0;
        return { id: option.id, label: option.label, voteCount, percentage };
      })
    : (legacyPoll?.options.map((option) => {
        const voteCount = legacyPoll.votes.filter((vote) =>
          vote.optionIds.includes(option.id)
        ).length;
        const percentage =
          totalPollSelections > 0
            ? Math.round((voteCount / totalPollSelections) * 100)
            : 0;

        return {
          ...option,
          voteCount,
          percentage,
        };
      }) ?? []);
  const winningVoteCount = Math.max(
    0,
    ...pollOptionStats.map((option) => option.voteCount)
  );
  const winningOptions =
    winningVoteCount > 0
      ? pollOptionStats.filter(
          (option) => option.voteCount === winningVoteCount
        )
      : [];

  const togglePollOption = (optionId: string) => {
    if (
      !nativePoll ||
      existingPollVote ||
      isPollClosed ||
      nativeRuntime?.availability !== 'available'
    ) {
      return;
    }

    setSelectedPollOptionIds((current) => {
      if (pollMode === 'single') {
        return current.includes(optionId) ? [] : [optionId];
      }

      return current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId];
    });
  };

  const submitPollVote = () => {
    if (
      !nativePoll ||
      existingPollVote ||
      isPollClosed ||
      nativeRuntime?.availability !== 'available' ||
      selectedPollOptionIds.length === 0
    ) {
      return;
    }

    onVoteOnPoll(post.id, selectedPollOptionIds);
  };

  const actionButtonClass =
    'rounded-md border border-cyan-200 bg-cyan-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 shadow-sm transition hover:border-cyan-300 hover:bg-cyan-100 hover:shadow active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50';
  const dangerButtonClass =
    'rounded-md border border-orange-300 bg-orange-50 px-2.5 py-1.5 text-xs font-semibold text-orange-800 shadow-sm transition hover:bg-orange-100 hover:shadow active:translate-y-px';

  return (
    <article
      id={`post-${post.id}`}
      className={[
        'forum-card-accent p-4 transition',
        highlighted
          ? 'ring-2 ring-cyan-300 ring-offset-2 ring-offset-slate-50'
          : '',
      ].join(' ')}
    >
      <header className="flex items-start gap-4">
        <div className="flex items-center gap-3">
          {author?.avatarUrl && isAvatarVisible ? (
            <img
              src={author.avatarUrl}
              alt={`${displayName} avatar`}
              className="h-10 w-10 rounded-full object-cover"
              onError={() => setIsAvatarVisible(false)}
            />
          ) : (
            <div
              className={`${avatarColor} flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold text-white`}
              aria-hidden="true"
            >
              {getInitials(displayName)}
            </div>
          )}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-ui-strong text-sm font-semibold">
                {displayName}
              </p>
              <UserRoleBadge role={authorRole} />
              {post.isPinned ? (
                <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase text-amber-700">
                  {t('thread.pinned')}
                </span>
              ) : null}
            </div>
            <p className="text-ui-muted text-xs">
              {formatDateTime(post.createdAt)}
            </p>
            {post.editedAt ? (
              <p className="mt-0.5 text-xs font-semibold text-amber-700">
                {t('post.edited', { date: formatDateTime(post.editedAt) })}
              </p>
            ) : null}
          </div>
        </div>
      </header>

      {repliedPost ? (
        <button
          type="button"
          onClick={() => onJumpToPost?.(repliedPost.id)}
          className={[
            'mt-3 w-full rounded-lg border-l-4 px-3 py-2 text-left transition',
            replyContextHighlighted
              ? 'border-cyan-400 bg-cyan-50 ring-1 ring-cyan-200'
              : 'border-slate-300 bg-slate-50 hover:bg-slate-100',
          ].join(' ')}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-ui-strong text-xs font-semibold">
              {t('post.replyingTo', {
                name: repliedAuthorName ?? t('common.member'),
              })}
            </p>
            <span className="text-xs font-semibold text-cyan-700">
              {t('post.jump')}
            </span>
          </div>
          <RichTextContent
            value={repliedPost.content}
            highlightQuery={searchQuery}
            className="text-ui-muted mt-1 text-xs leading-relaxed"
          />
        </button>
      ) : null}
      <RichTextContent
        value={post.content}
        highlightQuery={searchQuery}
        className="text-ui-strong mt-3 text-sm leading-relaxed"
      />
      {post.poll ? (
        <div className="mt-4 rounded-lg border border-cyan-200 bg-cyan-50/60 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex rounded-md border border-cyan-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-cyan-800">
              {nativePoll ? t('poll.native') : t('poll.legacyReadOnly')}
            </span>
            <span className="text-ui-muted text-xs">
              {pollMode === 'multiple' ? t('poll.multiple') : t('poll.single')}
            </span>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {pollClosesAt ? (
              <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700">
                {t('poll.closes', { date: formatDateTime(pollClosesAt) })}
              </span>
            ) : null}
            {isPollClosed ? (
              <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">
                {t('poll.closed', {
                  date: pollClosedAt ? formatDateTime(pollClosedAt) : '',
                })}
              </span>
            ) : null}
            {nativePoll && canClosePoll && !isPollClosed ? (
              <button
                type="button"
                onClick={() => onClosePoll(post.id)}
                className="rounded-md border border-rose-200 bg-white px-2 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 active:translate-y-px"
              >
                {t('poll.close')}
              </button>
            ) : null}
          </div>
          <p className="text-ui-strong text-base font-semibold">
            {pollQuestion}
          </p>
          {pollDescription ? (
            <p className="text-ui-muted mt-1 text-sm">{pollDescription}</p>
          ) : null}
          {nativePoll && nativeRuntime?.availability !== 'available' ? (
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              {t('poll.unavailable')}
            </p>
          ) : null}
          {legacyPoll ? (
            <p className="mt-2 rounded-md border border-slate-200 bg-white/70 px-3 py-2 text-xs font-semibold text-slate-700">
              {t('poll.legacyNotice')}
            </p>
          ) : null}
          <p className="mt-2 rounded-md border border-cyan-100 bg-white/70 px-3 py-2 text-xs font-semibold text-slate-700">
            {t('poll.resultNotice')}
          </p>
          <div className="mt-3 space-y-2">
            {pollOptionStats.map((option) => {
              const isSelected = existingPollVote
                ? existingPollVote.optionIds.includes(option.id)
                : selectedPollOptionIds.includes(option.id);

              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => togglePollOption(option.id)}
                  disabled={Boolean(existingPollVote || isPollClosed)}
                  className={[
                    'w-full rounded-md border px-3 py-2 text-left text-sm transition active:translate-y-px',
                    isSelected
                      ? 'border-cyan-500 bg-cyan-100 text-slate-950 shadow-sm'
                      : 'border-cyan-100 bg-white/70 text-slate-700 hover:bg-white',
                    existingPollVote ? 'cursor-default' : '',
                  ].join(' ')}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-semibold">{option.label}</span>
                    {canShowPollResults ? (
                      <span className="text-xs text-slate-600">
                        {t('poll.voteCount', { count: option.voteCount })} •{' '}
                        {option.percentage}%
                      </span>
                    ) : null}
                  </span>
                  {canShowPollResults ? (
                    <span className="mt-2 block h-2 overflow-hidden rounded-full bg-cyan-100">
                      <span
                        className="block h-full rounded-full bg-cyan-500"
                        style={{ width: `${option.percentage}%` }}
                      />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {isPollClosed ? (
            <div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
              <p className="text-ui-strong text-sm font-semibold">
                {t('poll.statistics')}
              </p>
              <div className="mt-2 grid gap-1 text-xs text-slate-700 sm:grid-cols-3">
                <span>{t('poll.voters', { count: totalPollVoters })}</span>
                <span>
                  {t('poll.selections', { count: totalPollSelections })}
                </span>
                <span>
                  {t('poll.options', { count: pollOptionStats.length })}
                </span>
                <span>
                  {t('poll.result', {
                    result:
                      winningOptions.length > 0
                        ? winningOptions
                            .map((option) => option.label)
                            .join(', ')
                        : t('poll.noVotes'),
                  })}
                </span>
              </div>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-ui-muted text-xs">
              {canShowPollResults
                ? t('poll.summary', {
                    voters: totalPollVoters,
                    selections: totalPollSelections,
                  })
                : t('poll.resultsHidden')}
              {existingPollVote ? ` • ${t('poll.youVoted')}` : ''}
              {isPollClosed ? ` • ${t('poll.closedStatus')}` : ''}
            </p>
            {nativePoll &&
            nativeRuntime?.availability === 'available' &&
            !existingPollVote &&
            !isPollClosed ? (
              <button
                type="button"
                onClick={submitPollVote}
                disabled={selectedPollOptionIds.length === 0}
                className="rounded-md border border-cyan-300 bg-cyan-100 px-3 py-1.5 text-xs font-semibold text-slate-800 transition hover:bg-cyan-200 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('poll.submit')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <PostAttachmentList attachments={post.attachments} />

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-orange-100 pt-3">
        <button
          type="button"
          className={actionButtonClass}
          disabled={hasLiked}
          onClick={() => onLike(post.id)}
        >
          {hasLiked
            ? t('post.liked', { count: post.likes })
            : t('post.like', { count: post.likes })}
        </button>
        <button
          type="button"
          className={actionButtonClass}
          onClick={() => onReply(post)}
        >
          {t('post.reply')}
        </button>
        <button
          type="button"
          className={`${actionButtonClass} transition active:scale-95`}
          onClick={() => onShare(post)}
        >
          {t('common.share')}
        </button>
        <button
          type="button"
          className={actionButtonClass}
          onClick={() => onSendTip(post)}
        >
          {post.tipSummary?.verifiedCount
            ? t('tip.sendVerified', {
                count: post.tipSummary.verifiedCount,
                amount: post.tipSummary.verifiedTotalQort,
              })
            : t('tip.send')}
        </button>
        {post.tipSummary?.legacyCount ? (
          <span className="text-ui-muted text-[11px]">
            {t('tip.legacyCounter', { count: post.tipSummary.legacyCount })}
          </span>
        ) : null}
        {post.tipSummary?.status === 'unavailable' ? (
          <span className="text-[11px] text-amber-700">
            {t('tip.verifiedUnavailable')}
          </span>
        ) : null}
        {isOwner ? (
          <>
            <button
              type="button"
              className={actionButtonClass}
              onClick={() => onEdit(post)}
            >
              {t('common.edit')}
            </button>
            <button
              type="button"
              className={dangerButtonClass}
              onClick={() => onDelete(post.id)}
            >
              {t('common.delete')}
            </button>
          </>
        ) : null}
        {canModerate ? (
          <button
            type="button"
            className={actionButtonClass}
            onClick={() => onTogglePin(post)}
          >
            {post.isPinned ? t('post.unpin') : t('post.pin')}
          </button>
        ) : null}
        {!isOwner && canModerate ? (
          <button
            type="button"
            className={dangerButtonClass}
            onClick={() => onDelete(post.id)}
          >
            {t('post.moderationDelete')}
          </button>
        ) : null}
      </div>
    </article>
  );
};

const areThreadPostCardPropsEqual = (
  prev: ThreadPostCardProps,
  next: ThreadPostCardProps
) => {
  return (
    prev.post === next.post &&
    prev.author === next.author &&
    prev.authorRole === next.authorRole &&
    prev.repliedPost === next.repliedPost &&
    prev.repliedAuthorName === next.repliedAuthorName &&
    prev.highlighted === next.highlighted &&
    prev.searchQuery === next.searchQuery &&
    prev.replyContextHighlighted === next.replyContextHighlighted &&
    prev.isOwner === next.isOwner &&
    prev.canModerate === next.canModerate &&
    prev.hasLiked === next.hasLiked &&
    prev.pollVoterId === next.pollVoterId &&
    prev.canClosePoll === next.canClosePoll &&
    prev.onLike === next.onLike &&
    prev.onVoteOnPoll === next.onVoteOnPoll &&
    prev.onClosePoll === next.onClosePoll &&
    prev.onReply === next.onReply &&
    prev.onShare === next.onShare &&
    prev.onSendTip === next.onSendTip &&
    prev.onJumpToPost === next.onJumpToPost &&
    prev.onEdit === next.onEdit &&
    prev.onDelete === next.onDelete &&
    prev.onTogglePin === next.onTogglePin
  );
};

export default memo(ThreadPostCard, areThreadPostCardPropsEqual);
