import AppModal from '../../../components/common/AppModal';
import { useTranslation } from 'react-i18next';

type QortTipModalProps = {
  isOpen: boolean;
  isSending: boolean;
  isResolvingRecipient: boolean;
  isBalanceLoading: boolean;
  amount: string;
  formattedBalance: string;
  recipientName: string;
  recipientAddress: string | null;
  resolveError: string | null;
  isRecoveryPending: boolean;
  onClose: () => void;
  onAmountChange: (value: string) => void;
  onSend: () => void;
};

const QortTipModal = ({
  isOpen,
  isSending,
  isResolvingRecipient,
  isBalanceLoading,
  amount,
  formattedBalance,
  recipientName,
  recipientAddress,
  resolveError,
  isRecoveryPending,
  onClose,
  onAmountChange,
  onSend,
}: QortTipModalProps) => {
  const { t } = useTranslation();
  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={t('tip.send')}
      title={t('tip.send')}
      maxWidthClassName="max-w-md"
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <p className="text-ui-muted text-xs">{t('tip.walletBalance')}</p>
          <p className="text-ui-strong mt-0.5 text-sm font-semibold">
            {isBalanceLoading
              ? t('common.loading')
              : `${formattedBalance} QORT`}
          </p>
        </div>

        <div
          className={[
            'rounded-lg border bg-white px-3 py-2',
            resolveError ? 'border-rose-300' : 'border-slate-200',
          ].join(' ')}
        >
          <p className="text-ui-muted text-xs">{t('tip.recipient')}</p>
          <p className="text-ui-strong mt-0.5 text-sm font-semibold">
            @{recipientName || 'unknown'}
          </p>
          <p className="text-ui-muted mt-0.5 text-xs break-all">
            {isResolvingRecipient
              ? t('tip.resolving')
              : resolveError
                ? resolveError
                : recipientAddress || t('tip.unavailable')}
          </p>
        </div>

        <div>
          <label
            className="text-ui-muted text-xs font-semibold"
            htmlFor="tip-amount-input"
          >
            {t('tip.amount')}
          </label>
          <input
            id="tip-amount-input"
            type="number"
            value={amount}
            min="0"
            step="0.00000001"
            disabled={isRecoveryPending}
            onChange={(event) => onAmountChange(event.target.value)}
            className="bg-surface-card text-ui-strong mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
        </div>

        {isRecoveryPending ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {t('tip.recoveryNotice')}
          </p>
        ) : null}

        <button
          type="button"
          onClick={onSend}
          disabled={isSending || isResolvingRecipient || Boolean(resolveError)}
          className="bg-brand-primary-solid w-full rounded-md px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSending
            ? isRecoveryPending
              ? t('tip.retrying')
              : t('tip.sending')
            : isRecoveryPending
              ? t('tip.retryReference')
              : t('tip.sendQort')}
        </button>
      </div>
    </AppModal>
  );
};

export default QortTipModal;
