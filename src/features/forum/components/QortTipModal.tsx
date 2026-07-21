import AppModal from '../../../components/common/AppModal';

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
  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Send tip"
      title="Send Tip"
      maxWidthClassName="max-w-md"
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <p className="text-ui-muted text-xs">Wallet balance</p>
          <p className="text-ui-strong mt-0.5 text-sm font-semibold">
            {isBalanceLoading ? 'Loading...' : `${formattedBalance} QORT`}
          </p>
        </div>

        <div
          className={[
            'rounded-lg border bg-white px-3 py-2',
            resolveError ? 'border-rose-300' : 'border-slate-200',
          ].join(' ')}
        >
          <p className="text-ui-muted text-xs">Recipient</p>
          <p className="text-ui-strong mt-0.5 text-sm font-semibold">
            @{recipientName || 'unknown'}
          </p>
          <p className="text-ui-muted mt-0.5 text-xs break-all">
            {isResolvingRecipient
              ? 'Resolving wallet address...'
              : resolveError
                ? resolveError
                : recipientAddress || 'Wallet address unavailable'}
          </p>
        </div>

        <div>
          <label
            className="text-ui-muted text-xs font-semibold"
            htmlFor="tip-amount-input"
          >
            Amount (QORT)
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
            The QORT payment already succeeded. This retry verifies or
            republishes only its reference and will not send another payment.
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
              ? 'Retrying tip reference...'
              : 'Sending...'
            : isRecoveryPending
              ? 'RETRY TIP REFERENCE (NO PAYMENT)'
              : 'SEND QORT'}
        </button>
      </div>
    </AppModal>
  );
};

export default QortTipModal;
