type RouteRefreshNoticeProps = {
  message?: string;
};

const RouteRefreshNotice = ({
  message = 'This page needs to be refreshed before it can continue.',
}: RouteRefreshNoticeProps) => {
  const isDynamicImportIssue =
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /Loading chunk/i.test(message);

  return (
    <div className="bg-surface-app flex min-h-screen items-center justify-center px-4 py-8">
      <div className="forum-card-primary w-full max-w-xl p-6">
        <h1 className="text-ui-strong text-2xl font-bold">Refresh Needed</h1>
        <div className="mt-4 rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-3">
          <p className="text-sm font-semibold text-cyan-800">
            {isDynamicImportIssue
              ? 'A new app version is available. Please refresh the page.'
              : message}
          </p>
        </div>
        <p className="text-ui-muted mt-4 text-sm leading-relaxed">
          This can happen right after the app has been updated and your browser
          is still using older page files.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="bg-brand-primary-solid mt-5 rounded-md px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-600"
        >
          Refresh page
        </button>
      </div>
    </div>
  );
};

export default RouteRefreshNotice;
