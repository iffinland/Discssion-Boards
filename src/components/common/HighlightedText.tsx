import {
  createSearchHighlightPattern,
  SEARCH_HIGHLIGHT_CLASS,
} from '../../services/forum/searchHighlight';

type HighlightedTextProps = {
  text: string;
  query: string;
};

const HighlightedText = ({ text, query }: HighlightedTextProps) => {
  const pattern = createSearchHighlightPattern(query);
  if (!pattern) {
    return <>{text}</>;
  }

  return (
    <>
      {text.split(pattern).map((part, index) =>
        part.match(pattern) ? (
          <mark key={`${part}-${index}`} className={SEARCH_HIGHLIGHT_CLASS}>
            {part}
          </mark>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        )
      )}
    </>
  );
};

export default HighlightedText;
