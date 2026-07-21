import AppModal from '../common/AppModal';
import type { RichTextFormatType } from '../../services/forum/richText';
import { useTranslation } from 'react-i18next';

type RichTextToolsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onApplyFormat: (format: RichTextFormatType) => void;
  onApplyColor: (color: string) => void;
};

const actionButtonClass =
  'w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:border-cyan-300 hover:bg-cyan-50';

const baseColors = [
  { key: 'black', value: '#111827' },
  { key: 'blue', value: '#2563EB' },
  { key: 'green', value: '#16A34A' },
  { key: 'red', value: '#DC2626' },
];

const formatActions: Array<{ key: string; value: RichTextFormatType }> = [
  { key: 'heading2', value: 'heading2' },
  { key: 'heading3', value: 'heading3' },
  { key: 'inlineCode', value: 'inlineCode' },
  { key: 'bold', value: 'bold' },
  { key: 'italic', value: 'italic' },
  { key: 'underline', value: 'underline' },
  { key: 'strike', value: 'strike' },
  { key: 'quote', value: 'quote' },
  { key: 'code', value: 'code' },
  { key: 'unorderedList', value: 'unorderedList' },
  { key: 'orderedList', value: 'orderedList' },
];

const RichTextToolsModal = ({
  isOpen,
  onClose,
  onApplyFormat,
  onApplyColor,
}: RichTextToolsModalProps) => {
  const { t } = useTranslation();
  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={t('editor.toolsLabel')}
      title={t('editor.tools')}
      maxWidthClassName="max-w-sm"
    >
      <div className="space-y-2">
        {formatActions.map((action) => (
          <button
            key={action.value}
            type="button"
            className={actionButtonClass}
            onClick={() => {
              onApplyFormat(action.value);
              onClose();
            }}
          >
            {t(`editor.format.${action.key}`)}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t('editor.baseColors')}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {baseColors.map((color) => (
            <button
              key={color.value}
              type="button"
              onClick={() => {
                onApplyColor(color.value);
                onClose();
              }}
              className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:border-cyan-300 hover:bg-cyan-50"
            >
              <span
                className="h-3.5 w-3.5 rounded-full border border-slate-300"
                style={{ backgroundColor: color.value }}
                aria-hidden="true"
              />
              {t(`editor.colors.${color.key}`)}
            </button>
          ))}
        </div>
      </div>
    </AppModal>
  );
};

export default RichTextToolsModal;
