# Qortium Home display settings and localization

Status: **GitHub issue #12 implementation contract**

Qortium Home is active software. This document records current verified
capabilities, not a permanently frozen API target.

## Verified references

| Repository        | Verified commit                                                      |
| ----------------- | -------------------------------------------------------------------- |
| Discussion Boards | `7bcc0ded7c0bc1aac6a6f378c0c15eed50b000fa` (issue #12 worktree base) |
| Qortium Home      | `a41e5f9678d7f20d7fb77a223c45fddc0096632e`                           |
| Qortium Core      | `c000a0cd4a1ebaaab5aa753f3cd199f3302ff5bf`                           |

At this Home revision, a rendered Q-App receives effective display settings in
its URL as `theme`, `accent`, `textSize`, `lang`, and `uiStyle`. Home also
supports the read action `GET_HOME_SETTINGS` and sends both individual change
messages (`THEME_CHANGED`, `LANGUAGE_CHANGED`, `TEXT_SIZE_CHANGED`,
`ACCENT_CHANGED`, `UI_STYLE_CHANGED`) and the consolidated
`qortium:home-settings-changed` message to active Q-App frames.

The currently verified values are:

- theme: `system`, `light`, `dark` (the QDN URL supplies resolved light/dark);
- accent: `green`, `blue`, `orange`, `purple`, `red`, `teal`, `cyan`, `pink`,
  `yellow`;
- text size: `extra-small`, `small`, `medium`, `large`, `extra-large`, `huge`;
- UI style: `classic`, `modern`, `fun`;
- language: `system` or a Home-supported locale. Discussion Boards currently
  ships an English application catalogue, so other well-formed Home locales
  fall back to English without being persisted as an app selection.

Before future work changes this integration, re-check Home's
`src/displaySettings.ts`, `src/qdn.ts`, `src/QdnViewer.tsx`,
`electron/home-settings-bridge.ts`, and its Q-App action handler.

## Central model and precedence

`src/services/qortium/homeDisplaySettings.ts` is the only raw Home display
settings adapter. Components consume the normalized context, never Home query
parameters or bridge messages directly. Its stable app-facing model contains:

- resolved `theme`;
- validated `accent`;
- validated `textScale`;
- supported application `language`;
- `styleMode`;
- diagnostic `source` and `availability`.

Precedence is deterministic and field-aware:

1. a valid current Home live message;
2. a valid `GET_HOME_SETTINGS` value;
3. the effective Home QDN URL value supplied at resource load;
4. the safe application defaults: light, green, medium, English, classic.

An absent field preserves the best earlier Home-derived value. A malformed
field cannot replace it. The old `forum-theme-mode` localStorage value is
removed and never participates in precedence. Discussion Boards has no local
theme, accent, text-size, language, or style override.

Forum-specific caches, recovery records, performance flags, and future board
sorting/editor preferences remain app-specific state. They do not participate
in global display preference selection and are not removed by this adapter.

## Application and fallback

The Home URL is normalized and applied before the first React render. The
provider then performs the bridge read and subscribes to verified parent/top
frame messages. It updates one root dataset and changes i18next language. The
listener is removed on unmount and async bridge completion is ignored after
unmount.

Root CSS tokens control surfaces, text, borders, focus indicators, accent
usage, and rem-based text scaling. Semantic error, warning, success, and
moderation-danger colors remain independent. `classic` retains the existing
presentation; `modern` and `fun` apply progressively rounder presentation
tokens without changing layout, behavior, authority, or publication.

Unavailable Home settings are cosmetic failures and never stop startup.
Missing values use the preceding valid source or defaults. Invalid theme,
accent, text size, or style values are diagnosed as malformed. Unsupported but
well-formed languages are diagnosed as partial and use English. Static English
resources and synchronous i18next initialization make translation lookup
deterministic; missing keys fall back to English and then the key.

## Localization scope

The English resource under `src/i18n/resources/en.ts` covers the primary board,
Topic, Thread, post, create/edit dialog, search, loading/error/empty, access,
moderation/role, poll, tip, attachment/media, rich-text, refresh, and
bridge-unavailable flows. User content, protocol values, internal diagnostic
codes, historical migration evidence, and debug logs are intentionally not
translated.

Active QDN help and share behavior uses `qdn://`. Remaining `Qortal` strings in
Architecture V2 migration fixtures are historical publisher/data evidence;
the legacy agent and analysis documents are retained as historical project
material rather than active runtime guidance.

## Manual visual verification

Use Qortium Home (or its exact current QDN query parameters) and verify:

1. light and dark themes on the board, Topic, Thread, modal, menu, editor,
   poll, tip, attachment, and access-warning surfaces;
2. green, blue, orange, purple, red, teal, cyan, pink, and yellow accents,
   confirming warnings/errors remain semantic colors;
3. medium and huge text on a narrow viewport and desktop, including header
   wrapping, cards, forms, badges, tables, poll options, and modal scrolling;
4. classic, modern, and fun presentation modes without behavioral changes;
5. live Home preference changes without reload, then reload consistency;
6. unsupported Home language fallback to English with no stored false choice;
7. unavailable/malformed bridge startup with readable content and localized
   bridge guidance;
8. `qdn://VIDEO/...` editor insertion and preview, and generated `qdn://` share
   links.

Automated coverage is available through `npm run test:qortium-home-display`.
