import { Suspense, lazy, useEffect, useState } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import Layout from './components/layout/Layout';
import { getInitialShareTarget } from './services/qortium/share';

const Home = lazy(() => import('./pages/Home'));
const TopicPage = lazy(() => import('./pages/TopicPage'));
const ThreadPage = lazy(() => import('./pages/ThreadPage'));

type ThemeMode = 'light-cyan' | 'dark-cyan';
const THEME_STORAGE_KEY = 'forum-theme-mode';
const qdnWindow = window as Window & { _qdnBase?: string };
const routerBaseName = qdnWindow._qdnBase || '';

const LegacyHashRedirect = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!location.hash.startsWith('#/')) {
      return;
    }

    navigate(location.hash.slice(1), { replace: true });
  }, [location.hash, navigate]);

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
          search: search ? `?${search}` : '',
        },
        { replace: true }
      );
      return;
    }

    if (target.topicId) {
      navigate(`/topic/${target.topicId}`, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);

  return null;
};

const App = () => {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') {
      return 'light-cyan';
    }

    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return storedTheme === 'dark-cyan' ? 'dark-cyan' : 'light-cyan';
  });
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('theme-dark-cyan', themeMode === 'dark-cyan');
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  const handleToggleTheme = () => {
    setThemeMode((current) =>
      current === 'light-cyan' ? 'dark-cyan' : 'light-cyan'
    );
  };

  return (
    <BrowserRouter basename={routerBaseName}>
      <LegacyHashRedirect />
      <InitialShareTargetRedirect />
      <Layout
        themeMode={themeMode}
        onToggleTheme={handleToggleTheme}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
      >
        <Suspense
          fallback={
            <div className="space-y-4">
              <div className="forum-card p-5">
                <p className="text-ui-muted text-sm">Loading page...</p>
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
