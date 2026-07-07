import type { ReactNode } from 'react';

type AppModalProps = {
  isOpen: boolean;
  onClose: () => void;
  ariaLabel: string;
  title?: string;
  maxWidthClassName?: string;
  children: ReactNode;
};

const AppModal = ({
  isOpen,
  onClose,
  ariaLabel,
  title,
  maxWidthClassName = 'max-w-sm',
  children,
}: AppModalProps) => {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={onClose}
    >
      <div
        className={`w-full ${maxWidthClassName} rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-xl`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-slate-800">
            {title ?? ariaLabel}
          </h4>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600"
          >
            Close
          </button>
        </div>

        {children}
      </div>
    </div>
  );
};

export default AppModal;
