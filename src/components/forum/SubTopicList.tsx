import { memo, useMemo, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';

import UserRoleBadge from '../common/UserRoleBadge';
import HighlightedText from '../common/HighlightedText';
import type { SubTopic, User } from '../../types';
import {
  HIDDEN_CONTENT_NOTICE,
  resolveAccessLabel,
} from '../../services/forum/forumAccess';

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
  const { t, i18n } = useTranslation();
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
        <span>{t('navigation.subTopic')}</span>
        <span>{t('thread.author')}</span>
        <span>{t('thread.lastPost')}</span>
      </div>

      <ul className="space-y-2">
        {subTopics.map((subTopic) => {
          const isQuarantined = quarantinedSubTopicIds[subTopic.id] === true;
          const metadata = [
            subTopic.isPinned ? t('thread.pinned') : null,
            subTopic.isPoll ? t('thread.poll') : null,
            subTopic.isSolved ? t('thread.solved') : null,
            subTopic.status === 'locked'
              ? t('common.locked')
              : t('common.open'),
            subTopic.visibility === 'hidden' ? t('common.hidden') : null,
            isQuarantined ? t('status.quarantined') : null,
            subTopic.access !== 'everyone'
              ? t('thread.access', {
                  access: resolveAccessLabel(subTopic.access),
                })
              : null,
            subTopic.lastModerationReason
              ? t('thread.moderationReason', {
                  reason: subTopic.lastModerationReason,
                })
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
                          {t('thread.dragging')}
                        </span>
                      ) : null}
                      {subTopic.isPinned ? (
                        <span
                          className={`${statusBadgeBaseClass} border-amber-300 bg-amber-50 text-amber-700`}
                        >
                          {t('thread.pinned')}
                        </span>
                      ) : null}
                      {subTopic.status === 'locked' ? (
                        <span
                          className={`${statusBadgeBaseClass} border-rose-300 bg-rose-50 text-rose-700`}
                        >
                          {t('common.locked')}
                        </span>
                      ) : null}
                      {subTopic.isPoll ? (
                        <span
                          className={`${statusBadgeBaseClass} border-cyan-300 bg-cyan-50 text-cyan-800`}
                        >
                          {t('thread.poll')}
                        </span>
                      ) : null}
                      {isQuarantined ? (
                        <span
                          className={`${statusBadgeBaseClass} border-orange-300 bg-orange-50 text-orange-700`}
                        >
                          {t('status.quarantined')}
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
                          t('common.unknownUser')}
                      </span>
                      <UserRoleBadge
                        role={
                          userMap.get(subTopic.authorUserId)?.role ?? 'Member'
                        }
                      />
                    </span>
                  </span>
                  <span className="text-ui-muted text-sm">
                    {new Date(subTopic.lastPostAt).toLocaleDateString(
                      i18n.language,
                      {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      }
                    )}
                    <span className="block text-xs">
                      {t('common.posts', {
                        count: postCountsBySubTopicId[subTopic.id] ?? '...',
                      })}
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
                      {t('common.manage')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleSubTopicPin?.(subTopic)}
                      className="bg-surface-card text-ui-strong rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold"
                    >
                      {subTopic.isPinned ? t('thread.unpin') : t('thread.pin')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleSubTopicStatus?.(subTopic)}
                      className="bg-surface-card text-ui-strong rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold"
                    >
                      {subTopic.status === 'locked'
                        ? t('thread.unlock')
                        : t('thread.lock')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleSubTopicVisibility?.(subTopic)}
                      title={HIDDEN_CONTENT_NOTICE}
                      className="bg-surface-card text-ui-strong rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold"
                    >
                      {subTopic.visibility === 'hidden'
                        ? t('thread.show')
                        : t('thread.hide')}
                    </button>
                    {isQuarantined ? (
                      <button
                        type="button"
                        onClick={() => onHideBrokenSubTopic?.(subTopic)}
                        className="rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-xs font-semibold text-orange-700"
                      >
                        {t('thread.hideBroken')}
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
                            {t('common.more', {
                              count: subTopic.allowedAddresses.length - 3,
                            })}
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
