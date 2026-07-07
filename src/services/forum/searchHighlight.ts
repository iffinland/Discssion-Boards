import { tokenizeSearchQuery } from './forumSearch';

export const SEARCH_HIGHLIGHT_CLASS =
  'rounded-sm bg-emerald-200 px-0.5 font-semibold text-emerald-950';

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const getSearchHighlightTokens = (query: string) => {
  return [...new Set(tokenizeSearchQuery(query))]
    .filter((token) => token.length > 0)
    .sort((a, b) => b.length - a.length);
};

export const createSearchHighlightPattern = (query: string) => {
  const tokens = getSearchHighlightTokens(query);
  return tokens.length > 0
    ? new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'gi')
    : null;
};

export const highlightHtmlText = (html: string, query: string) => {
  const pattern = createSearchHighlightPattern(query);
  if (!pattern) {
    return html;
  }

  return html
    .split(/(<[^>]+>)/g)
    .map((segment) => {
      if (!segment || segment.startsWith('<')) {
        return segment;
      }

      return segment.replace(
        pattern,
        `<mark class="${SEARCH_HIGHLIGHT_CLASS}">$1</mark>`
      );
    })
    .join('');
};
