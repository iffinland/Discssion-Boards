import { useEffect, useState } from 'react';

import App from './App';
import { AppWrapper } from './AppWrapper';
import RouteRefreshNotice from './components/common/RouteRefreshNotice';
import { ForumProvider } from './context/ForumContext';

const RootApp = () => {
  const [refreshNoticeMessage, setRefreshNoticeMessage] = useState<
    string | null
  >(null);

  useEffect(() => {
    const toMessage = (value: unknown) => {
      if (value instanceof Error && value.message) {
        return value.message;
      }

      if (
        typeof value === 'object' &&
        value !== null &&
        'message' in value &&
        typeof value.message === 'string'
      ) {
        return value.message;
      }

      if (typeof value === 'string') {
        return value;
      }

      return '';
    };

    const isChunkFailure = (message: string) =>
      /Failed to fetch dynamically imported module/i.test(message) ||
      /Importing a module script failed/i.test(message) ||
      /Loading chunk/i.test(message);

    const handleWindowError = (event: ErrorEvent) => {
      const message = toMessage(event.error) || event.message || '';
      if (!isChunkFailure(message)) {
        return;
      }

      setRefreshNoticeMessage(message);
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const message = toMessage(event.reason);
      if (!isChunkFailure(message)) {
        return;
      }

      setRefreshNoticeMessage(message);
    };

    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener(
        'unhandledrejection',
        handleUnhandledRejection
      );
    };
  }, []);

  if (refreshNoticeMessage) {
    return <RouteRefreshNotice message={refreshNoticeMessage} />;
  }

  return (
    <AppWrapper>
      <ForumProvider>
        <App />
      </ForumProvider>
    </AppWrapper>
  );
};

export default RootApp;
