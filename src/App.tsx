import { Suspense, lazy, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import Layout from './components/layout/Layout';
import { preserveStartupDebugQuery } from './services/perf/startupControl';
import { getInitialShareTarget } from './services/qortium/share';

const Home = lazy(() => import('./pages/Home'));
const TopicPage = lazy(() => import('./pages/TopicPage'));
const ThreadPage = lazy(() => import('./pages/ThreadPage'));

const qdnWindow = window as Window & { _qdnBase?: string };
const routerBaseName = qdnWindow._qdnBase || '';

const LegacyHashRedirect = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!location.hash.startsWith('#/')) {
      return;
    }

    const [pathname, targetSearch = ''] = location.hash.slice(1).split('?');
    navigate(
      {
        pathname,
        search: preserveStartupDebugQuery(
          location.search,
          targetSearch ? `?${targetSearch}` : ''
        ),
      },
      { replace: true }
    );
  }, [location.hash, location.search, navigate]);

  return null;
};

const InitialShareTargetRedirect = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (location.pathname !== '/') {
      return;
    }

    const target = getInitialShareTarget(location.search);
    if (target.threadId) {
      const params = new URLSearchParams();
      if (target.postId) {
        params.set('post', target.postId);
      }
      const search = params.toString();
      navigate(
        {
          pathname: `/thread/${target.threadId}`,
          search: preserveStartupDebugQuery(
            location.search,
            search ? `?${search}` : ''
          ),
        },
        { replace: true }
      );
      return;
    }

    if (target.topicId) {
      navigate(
        {
          pathname: `/topic/${target.topicId}`,
          search: preserveStartupDebugQuery(location.search),
        },
        { replace: true }
      );
    }
  }, [location.pathname, location.search, navigate]);

  return null;
};

const App = () => {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <BrowserRouter basename={routerBaseName}>
      <LegacyHashRedirect />
      <InitialShareTargetRedirect />
      <Layout searchQuery={searchQuery} onSearchQueryChange={setSearchQuery}>
        <Suspense
          fallback={
            <div className="space-y-4">
              <div className="forum-card p-5">
                <p className="text-ui-muted text-sm">{t('app.loadingPage')}</p>
              </div>
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<Home searchQuery={searchQuery} />} />
            <Route
              path="/topic/:id"
              element={<TopicPage onSearchQueryChange={setSearchQuery} />}
            />
            <Route
              path="/thread/:id"
              element={<ThreadPage onSearchQueryChange={setSearchQuery} />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Layout>
    </BrowserRouter>
  );
};

export default App;
