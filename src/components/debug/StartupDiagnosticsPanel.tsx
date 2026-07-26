import { useState, useSyncExternalStore } from 'react';

import {
  getStartupDiagnosticsReport,
  getStartupDiagnosticsSnapshotVersion,
  isStartupDiagnosticsEnabled,
  subscribeStartupDiagnostics,
} from '../../services/perf/startupDiagnostics';

const saveReport = (report: string) => {
  const blob = new Blob([report], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'discussion-boards-startup-diagnostics.json';
  link.click();
  URL.revokeObjectURL(url);
};

const copyReport = async (report: string) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(report);
      return true;
    }
  } catch {
    // Fall through to the selection-based copy used by older Home shells.
  }

  const textarea = document.createElement('textarea');
  textarea.value = report;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  return copied;
};

const StartupDiagnosticsPanel = () => {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>(
    'idle'
  );
  useSyncExternalStore(
    subscribeStartupDiagnostics,
    getStartupDiagnosticsSnapshotVersion,
    getStartupDiagnosticsSnapshotVersion
  );

  if (!isStartupDiagnosticsEnabled()) return null;
  const report = getStartupDiagnosticsReport();
  const serialized = JSON.stringify(report, null, 2);
  const failures = report.events.filter(
    (event) => event.completion === 'error' || event.completion === 'timeout'
  );

  return (
    <details className="fixed bottom-2 right-2 z-[100] max-h-[70vh] w-[min(44rem,calc(100vw-1rem))] overflow-auto rounded border border-amber-500 bg-slate-950 p-3 text-xs text-slate-100 shadow-2xl">
      <summary className="cursor-pointer font-semibold text-amber-300">
        Startup diagnostics · {report.currentState} ·{' '}
        {Math.round(report.totalElapsedMs)} ms
      </summary>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded bg-slate-700 px-2 py-1"
          onClick={() => {
            void copyReport(serialized).then((copied) => {
              setCopyState(copied ? 'copied' : 'failed');
            });
          }}
        >
          {copyState === 'copied'
            ? 'Copied'
            : copyState === 'failed'
              ? 'Copy failed — use Download'
              : 'Copy diagnostics'}
        </button>
        <button
          type="button"
          className="rounded bg-slate-700 px-2 py-1"
          onClick={() => saveReport(serialized)}
        >
          Download JSON
        </button>
        <span>
          {report.events.length} events · {report.duplicateRequests.length}{' '}
          duplicate groups · {failures.length} errors/timeouts
        </span>
      </div>
      <div className="mt-3 space-y-1 font-mono">
        {report.events.map((event) => (
          <div key={event.sequence} className="border-t border-slate-800 pt-1">
            {event.elapsedMs.toFixed(1).padStart(8)} ms · {event.name}
            {event.durationMs !== undefined
              ? ` · ${event.durationMs.toFixed(1)} ms`
              : ''}
            {event.action ? ` · ${event.action}` : ''}
            {event.identifier ? ` · ${event.identifier}` : ''}
            {event.completion ? ` · ${event.completion}` : ''}
            {event.detail ? ` · ${event.detail}` : ''}
          </div>
        ))}
      </div>
    </details>
  );
};

export default StartupDiagnosticsPanel;
