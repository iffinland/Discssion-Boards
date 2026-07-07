import { memo, useMemo, type DragEvent } from 'react';

import UserRoleBadge from '../common/UserRoleBadge';
import HighlightedText from '../common/HighlightedText';
import type { SubTopic, User } from '../../types';
import { resolveAccessLabel } from '../../services/forum/forumAccess';

type SubTopicListProps = {
  subTopics: SubTopic[];
  users: User[];
  postCountsBySubTopicId?: Record<string, number>;
  walletNamesByAddress?: Record<string, string>;
  quarantinedSubTopicIds?: Record<string, true>;
  onOpenThread: (subTopicId: string) => void;
  canManageSubTopics?: boolean;
  onToggleSubTopicPin?: (subTopic: SubTopic) => void;
  onToggleSubTopicStatus?: (subTopic: SubTopic) => void;
  onToggleSubTopicVisibility?: (subTopic: SubTopic) => void;
  onHideBrokenSubTopic?: (subTopic: SubTopic) => void;
  onManageSubTopic?: (subTopic: SubTopic) => void;
  canReorderPinnedSubTopics?: boolean;
  draggedPinnedSubTopicId?: string | null;
  dragOverPinnedSubTopicId?: string | null;
  onPinnedDragStart?: (subTopicId: string) => void;
  onPinnedDragOver?: (
    subTopicId: string,
    event: DragEvent<HTMLLIElement>
  ) => void;
  onPinnedDrop?: (subTopicId: string) => void;
  onPinnedDragEnd?: () => void;
  highlightQuery?: string;
};

const formatDate = (date: string) =>
  new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
const SUB_TOPIC_DESCRIPTION_MAX_LENGTH = 250;
const statusBadgeBaseClass =
  'mr-2 inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold align-middle';

const truncateDescription = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.length <= SUB_TOPIC_DESCRIPTION_MAX_LENGTH) {
    return trimmed;
  }

  return `${trimmed.slice(0, SUB_TOPIC_DESCRIPTION_MAX_LENGTH)}...`;
};

const SubTopicList = ({
  subTopics,
  users,
  postCountsBySubTopicId = {},
  walletNamesByAddress = {},
  quarantinedSubTopicIds = {},
  onOpenThread,
  canManageSubTopics = false,
  onToggleSubTopicPin,
  onToggleSubTopicStatus,
  onToggleSubTopicVisibility,
  onHideBrokenSubTopic,
  onManageSubTopic,
  canReorderPinnedSubTopics = false,
  draggedPinnedSubTopicId = null,
  dragOverPinnedSubTopicId = null,
  onPinnedDragStart,
  onPinnedDragOver,
  onPinnedDrop,
  onPinnedDragEnd,
  highlightQuery = '',
}: SubTopicListProps) => {
  const usernameMap = useMemo(
    () => new Map(users.map((user) => [user.id, user.displayName])),
    [users]
  );
  const userMap = useMemo(
    () => new Map(users.map((user) => [user.id, user])),
    [users]
  );

  return (
    <div className="space-y-2">
      <div className="bg-brand-primary-soft text-brand-primary-strong hidden grid-cols-[2fr_1fr_1fr] rounded-md border border-cyan-200 px-4 py-2 text-xs font-semibold uppercase tracking-wide sm:grid">
        <span>Sub-topic</span>
        <span>Author</span>
        <span>Last Post</span>
      </div>

      <ul className="space-y-2">
        {subTopics.map((subTopic) => {
          const isQuarantined = quarantinedSubTopicIds[subTopic.id] === true;
          const metadata = [
            subTopic.isPinned ? 'Pinned' : null,
            subTopic.isPoll ? 'Poll / Voting' : null,
            subTopic.isSolved ? 'Solved' : null,
            subTopic.status === 'locked' ? 'Locked' : 'Open',
            subTopic.visibility === 'hidden' ? 'Hidden' : null,
            isQuarantined ? 'Quarantined' : null,
            subTopic.access !== 'everyone'
              ? `Access: ${resolveAccessLabel(subTopic.access)}`
              : null,
            subTopic.lastModerationReason
              ? `Mod reason: ${subTopic.lastModerationReason}`
              : null,
          ]
            .filter(Boolean)
            .join(' • ');

          return (
            <li
              key={subTopic.id}
              draggable={canReorderPinnedSubTopics && subTopic.isPinned}
              onDragStart={() => onPinnedDragStart?.(subTopic.id)}
              onDragOver={(event) => onPinnedDragOver?.(subTopic.id, event)}
              onDrop={() => onPinnedDrop?.(subTopic.id)}
              onDragEnd={onPinnedDragEnd}
              className={[
                'forum-card',
                canReorderPinnedSubTopics &&
                subTopic.isPinned &&
                dragOverPinnedSubTopicId === subTopic.id
                  ? 'bg-cyan-50/60 ring-2 ring-cyan-300 ring-inset'
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div className="px-4 py-3 transition hover:bg-gradient-to-r hover:from-cyan-50 hover:to-orange-50/60">
                <button
                  type="button"
                  onClick={() => onOpenThread(subTopic.id)}
                  className="forum-row-button grid w-full grid-cols-1 gap-2 text-left sm:grid-cols-[2fr_1fr_1fr] sm:items-start sm:gap-3"
                >
                  <div className="min-w-0">
                    <span className="text-ui-strong block font-medium">
                      {canReorderPinnedSubTopics &&
                      subTopic.isPinned &&
                      draggedPinnedSubTopicId === subTopic.id ? (
                        <span className="text-ui-muted mr-2 inline-flex align-middle text-[11px] font-semibold">
                          Dragging...
                        </span>
                      ) : null}
                      {subTopic.isPinned ? (
                        <span
                          className={`${statusBadgeBaseClass} border-amber-300 bg-amber-50 text-amber-700`}
                        >
                          Pinned
                        </span>
                      ) : null}
                      {subTopic.status === 'locked' ? (
                        <span
                          className={`${statusBadgeBaseClass} border-rose-300 bg-rose-50 text-rose-700`}
                        >
                          Locked
                        </span>
                      ) : null}
                      {subTopic.isPoll ? (
                        <span
                          className={`${statusBadgeBaseClass} border-cyan-300 bg-cyan-50 text-cyan-800`}
                        >
                          Poll / Voting
                        </span>
                      ) : null}
                      {isQuarantined ? (
                        <span
                          className={`${statusBadgeBaseClass} border-orange-300 bg-orange-50 text-orange-700`}
                        >
                          Quarantined
                        </span>
                      ) : null}
                      <HighlightedText
                        text={subTopic.title}
                        query={highlightQuery}
                      />
                    </span>
                    <span className="text-ui-muted mt-1 block text-xs">
                      {metadata}
                    </span>
                    <span className="text-ui-muted mt-1 block text-xs leading-relaxed">
                      <HighlightedText
                        text={truncateDescription(subTopic.description)}
                        query={highlightQuery}
                      />
                    </span>
                  </div>
                  <span className="text-brand-primary-strong text-sm">
                    <span className="flex flex-wrap items-center gap-2">
                      <span>
                        {usernameMap.get(subTopic.authorUserId) ??
                          subTopic.authorUserId ??
                          'Unknown User'}
                      </span>
                      <UserRoleBadge
                        role={
                          userMap.get(subTopic.authorUserId)?.role ?? 'Member'
                        }
                      />
                    </span>
                  </span>
                  <span className="text-ui-muted text-sm">
                    {formatDate(subTopic.lastPostAt)}
                    <span className="block text-xs">
                      Posts:{' '}
                      {postCountsBySubTopicId[subTopic.id] !== undefined
                        ? postCountsBySubTopicId[subTopic.id]
                        : '...'}
                    </span>
                  </span>
                </button>

                {canManageSubTopics ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onManageSubTopic?.(subTopic)}
                      className="bg-surface-card text-ui-strong rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold"
                    >
                      Manage
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleSubTopicPin?.(subTopic)}
                      className="bg-surface-card text-ui-strong rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold"
                    >
                      {subTopic.isPinned ? 'Unpin' : 'Pin'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleSubTopicStatus?.(subTopic)}
                      className="bg-surface-card text-ui-strong rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold"
                    >
                      {subTopic.status === 'locked' ? 'Unlock' : 'Lock'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleSubTopicVisibility?.(subTopic)}
                      className="bg-surface-card text-ui-strong rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold"
                    >
                      {subTopic.visibility === 'hidden' ? 'Show' : 'Hide'}
                    </button>
                    {isQuarantined ? (
                      <button
                        type="button"
                        onClick={() => onHideBrokenSubTopic?.(subTopic)}
                        className="rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-xs font-semibold text-orange-700"
                      >
                        Hide Broken
                      </button>
                    ) : null}
                    {subTopic.allowedAddresses.length > 0 ? (
                      <span className="flex flex-wrap items-center gap-1">
                        {subTopic.allowedAddresses
                          .slice(0, 3)
                          .map((address) => (
                            <span
                              key={address}
                              className="text-ui-muted inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px]"
                              title={address}
                            >
                              {walletNamesByAddress[address] || address}
                            </span>
                          ))}
                        {subTopic.allowedAddresses.length > 3 ? (
                          <span className="text-ui-muted text-xs">
                            +{subTopic.allowedAddresses.length - 3} more
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default memo(SubTopicList);
