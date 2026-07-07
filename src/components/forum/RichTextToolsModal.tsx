import AppModal from '../common/AppModal';
import type { RichTextFormatType } from '../../services/forum/richText';

type RichTextToolsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onApplyFormat: (format: RichTextFormatType) => void;
  onApplyColor: (color: string) => void;
};

const actionButtonClass =
  'w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:border-cyan-300 hover:bg-cyan-50';

const baseColors = [
  { label: 'Black', value: '#111827' },
  { label: 'Blue', value: '#2563EB' },
  { label: 'Green', value: '#16A34A' },
  { label: 'Red', value: '#DC2626' },
];

const formatActions: Array<{ label: string; value: RichTextFormatType }> = [
  { label: 'Heading 2', value: 'heading2' },
  { label: 'Heading 3', value: 'heading3' },
  { label: 'Inline Code', value: 'inlineCode' },
  { label: 'Bold', value: 'bold' },
  { label: 'Italic', value: 'italic' },
  { label: 'Underline', value: 'underline' },
  { label: 'Strikethrough', value: 'strike' },
  { label: 'Quote', value: 'quote' },
  { label: 'Code Block', value: 'code' },
  { label: 'Bullet List', value: 'unorderedList' },
  { label: 'Numbered List', value: 'orderedList' },
];

const RichTextToolsModal = ({
  isOpen,
  onClose,
  onApplyFormat,
  onApplyColor,
}: RichTextToolsModalProps) => {
  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Rich text tools"
      title="Text Formatting"
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
            {action.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Base Colors
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
              {color.label}
            </button>
          ))}
        </div>
      </div>
    </AppModal>
  );
};

export default RichTextToolsModal;
