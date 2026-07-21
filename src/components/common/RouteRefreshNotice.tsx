type RouteRefreshNoticeProps = {
  message?: string;
};

const RouteRefreshNotice = ({ message }: RouteRefreshNoticeProps) => {
  const { t } = useTranslation();
  const effectiveMessage = message ?? t('refresh.message');
  const isDynamicImportIssue =
    /Failed to fetch dynamically imported module/i.test(effectiveMessage) ||
    /Importing a module script failed/i.test(effectiveMessage) ||
    /Loading chunk/i.test(effectiveMessage);

  return (
    <div className="bg-surface-app flex min-h-screen items-center justify-center px-4 py-8">
      <div className="forum-card-primary w-full max-w-xl p-6">
        <h1 className="text-ui-strong text-2xl font-bold">
          {t('refresh.title')}
        </h1>
        <div className="mt-4 rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-3">
          <p className="text-sm font-semibold text-cyan-800">
            {isDynamicImportIssue ? t('refresh.newVersion') : effectiveMessage}
          </p>
        </div>
        <p className="text-ui-muted mt-4 text-sm leading-relaxed">
          {t('refresh.explanation')}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="bg-brand-primary-solid mt-5 rounded-md px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-600"
        >
          {t('refresh.action')}
        </button>
      </div>
    </div>
  );
};

export default RouteRefreshNotice;
import { useTranslation } from 'react-i18next';
