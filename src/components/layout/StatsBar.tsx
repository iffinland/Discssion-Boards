import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import { useForumData } from '../../hooks/useForumData';

type StatsBarProps = {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
};

const StatsBar = ({ searchQuery, onSearchQueryChange }: StatsBarProps) => {
  const { t } = useTranslation();
  const { topics, subTopics, posts } = useForumData();
  const location = useLocation();
  const navigate = useNavigate();
  const totalPosters = useMemo(() => {
    return new Set(posts.map((post) => post.authorUserId)).size;
  }, [posts]);
  const totalSubTopicStarters = useMemo(() => {
    return new Set(subTopics.map((subTopic) => subTopic.authorUserId)).size;
  }, [subTopics]);
  const handleSearchChange = (value: string) => {
    onSearchQueryChange(value);
    if (location.pathname !== '/') {
      navigate('/');
    }
  };

  return (
    <div className="bg-forum-stats border-brand-primary border-b">
      <div className="text-ui-muted mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2 text-xs sm:px-6">
        <span className="forum-pill-primary rounded-md px-2 py-1">
          {t('stats.totalTopics', { count: topics.length })}
        </span>
        <span className="forum-pill-primary rounded-md px-2 py-1">
          {t('stats.totalSubTopics', { count: subTopics.length })}
        </span>
        <span className="forum-pill-primary rounded-md px-2 py-1">
          {t('stats.totalPosts', { count: posts.length })}
        </span>
        <span className="forum-pill-primary rounded-md px-2 py-1">
          {t('stats.totalPosters', { count: totalPosters })}
        </span>
        <span className="forum-pill-primary rounded-md px-2 py-1">
          {t('stats.subTopicStarters', { count: totalSubTopicStarters })}
        </span>
        <div className="ml-auto min-w-[220px] flex-1 sm:max-w-sm">
          <label className="sr-only" htmlFor="forum-search">
            {t('search.label')}
          </label>
          <input
            id="forum-search"
            type="search"
            value={searchQuery}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder={t('search.placeholder')}
            className="bg-surface-card text-ui-strong placeholder:text-ui-muted w-full rounded-md border border-slate-200 px-3 py-2 text-xs"
          />
          <p className="text-ui-muted mt-1 text-[11px]">{t('search.help')}</p>
        </div>
      </div>
    </div>
  );
};

export default memo(StatsBar);
