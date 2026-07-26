# Dependency and tooling baseline

Status: **GitHub issue #13 maintenance contract**

This document records the dependency, advisory, routing, and reproducibility
review performed on 2026-07-26. It is not an Architecture V2 behavior change.

## Development runtime

The tested development baseline is:

- Node.js `24.18.0`;
- npm `12.0.1`;
- npm lockfile version `3`.

`.nvmrc`, `engines`, and `packageManager` record that tested combination.
`npm ci` is the supported install path. npm 12 blocks unreviewed dependency
install scripts; the repository allows only the reviewed
`esbuild@0.25.0` postinstall used to select and validate its platform binary.

## Initial baseline

The pre-change baseline used the clean issue #12 repository state:

| Check                   | Initial result                                                                 |
| ----------------------- | ------------------------------------------------------------------------------ |
| `node --version`        | `v24.18.0`                                                                     |
| `npm --version`         | `12.0.1`                                                                       |
| `npm ci`                | passed; 225 packages; 12 total audit entries; esbuild script initially blocked |
| `npm run build`         | passed; emitted stale Browserslist-data notice                                 |
| `npm run test:richtext` | passed                                                                         |
| `npm run lint`          | failed: 40 Prettier-backed errors in two Architecture V2 test scripts          |
| `npm run format:check`  | failed: 13 files                                                               |
| `npm audit --omit=dev`  | failed: two high entries through React Router                                  |
| `git status`            | clean before generated `.tmp-tests` output                                     |
| `git diff --check`      | passed                                                                         |

## Direct dependency decisions

| Package group                            | Decision                 | Reason                                                                                 |
| ---------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| `react-router-dom`                       | upgrade required         | move from resolved 7.13.0 to current compatible 7.18.1 and clear patched v7 advisories |
| `vite`                                   | upgrade required         | 6.4.3 patches the reported Vite 6 development-server advisories                        |
| `postcss`                                | upgrade required         | 8.5.23 clears reported 8.5.x source-map/file-read advisories                           |
| `@vitejs/plugin-react`                   | upgrade recommended      | 4.7.0 stays Vite 6 compatible and refreshes the vulnerable Babel toolchain             |
| `eslint`, `@eslint/js`                   | upgrade recommended      | latest v9 maintenance versions; v10 is a separate tooling migration                    |
| `typescript-eslint`                      | upgrade recommended      | latest v8 line remains compatible with TypeScript 5.7 and ESLint 9                     |
| React and React DOM                      | current version accepted | no advisory or issue #13 compatibility requirement justified a React behavior update   |
| i18next and react-i18next                | current version accepted | used by issue #12, peers are valid, and the build resolves one i18next instance        |
| TypeScript                               | current version accepted | 5.7 remains supported; a major compiler migration is unrelated                         |
| Tailwind/PostCSS plugin and Autoprefixer | current version accepted | used by the active CSS build; no direct removal or major style migration is justified  |
| Prettier and ESLint formatting plugins   | retained                 | Prettier remains the single formatting source; ESLint reports that same configuration  |

No direct dependency was proven unused. React, React DOM, React Router,
i18next/react-i18next, Tailwind, PostCSS, Autoprefixer, Vite, TypeScript, ESLint,
and Prettier all have active imports, configuration, or scripts. No direct
dependency was removed.

## Production advisory analysis

The initial production graph resolved `react-router-dom@7.13.0` and
`react-router@7.13.0`. npm grouped multiple React Router advisories into two
high-severity package entries. The application uses Declarative Mode only:

- `<BrowserRouter basename={window._qdnBase || ''}>`;
- static `<Routes>` and `<Route>` elements;
- `<Link>`, `useNavigate`, `useLocation`, `useParams`, and `useSearchParams`;
- no React Router framework server;
- no loaders, actions, single-fetch endpoint, manifest endpoint, SSR,
  prerendering, or unstable React Server Components APIs.

`react-router-dom@7.18.1` is the current v7 DOM release and retains the existing
API. It resolves the v7 advisories with patched releases through 7.18.0,
including framework deserialization, redirect, manifest, and route-matching
issues. Those code paths were not reachable in this static Q-App, but updating
still removes the affected implementations from the installed v7 line.

One npm advisory remains after the upgrade:

| Advisory              | Severity | Affected/patched versions                          | Application applicability                                                                 | Decision                                                  |
| --------------------- | -------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `GHSA-qwww-vcr4-c8h2` | high     | React Router `>=7.12.0 <8.3.0`; patched in `8.3.0` | only unstable RSC action/CSRF code; Discussion Boards uses Declarative BrowserRouter mode | document and do not force a React Router v8/RSC migration |

At review time, `react-router-dom` publishes 7.18.1 as its latest release while
the advisory's patched `react-router@8.3.0` is a new major with React 19.2.7 and
Node 22.22 minimum peers/engines. Replacing the DOM package or routing
architecture solely to eliminate a scanner entry would be a breaking,
unrelated migration. Current source does not import or configure the affected
unstable RSC API.

The remaining full-audit findings are development-only ESLint 9 transitive
glob/cache packages. They process repository-controlled lint configuration
and filenames, are absent from the production dependency audit, and npm's
offered remediation is the ESLint 10 major line. They are documented rather
than forcing an ESLint/plugin ecosystem migration in this maintenance slice.

## Router compatibility boundary

The issue #13 upgrade deliberately keeps React Router v7 and the existing
Declarative routing model. Automated verification covers compilation and the
production bundle. Manual routing verification should cover:

1. initial Home route;
2. Home-to-Topic navigation;
3. Topic-to-Thread navigation;
4. direct `/topic/:id` and `/thread/:id` URLs under the injected QDN basename;
5. browser back and forward;
6. refresh on a routed page;
7. legacy `#/...` redirect;
8. `?topic=`, `?thread=`, and `?post=` share-target redirects;
9. lazy-chunk failure and `RouteRefreshNotice`;
10. embedded Qortium Home operation with no new console warnings or errors.

An interactive Qortium Home session is environment-dependent and must be
recorded separately when available.

## Formatting and generated output

Prettier is the formatting source of truth. `eslint-config-prettier` disables
conflicting stylistic ESLint rules and `eslint-plugin-prettier` reports the same
Prettier configuration during lint. The obsolete `jsxBracketSameLine` option
was removed. Build output, dependency trees, Vite cache, and generated
`.tmp-tests` JavaScript are excluded from formatting.

`npm run verify` runs lint, formatting, every Architecture V2 suite, both
Qortium integration suites, rich-text tests, and the production build in a
visible fail-fast sequence.

## Final verified state

The final resolved maintenance versions are:

- `react-router-dom` and `react-router`: `7.18.1`;
- Vite: `6.4.3`;
- PostCSS: `8.5.23`;
- `@vitejs/plugin-react`: `4.7.0`;
- ESLint and `@eslint/js`: `9.39.5`;
- `typescript-eslint`: `8.65.0`;
- Rollup: `4.62.3`;
- Babel core: `7.29.7`.

The closure validation produced these results:

- fresh `npm ci`: passed with 208 packages and no unreviewed install scripts;
- `package-lock.json` SHA-256 before and after `npm ci`: identical;
- `npm run verify`: passed in full;
- `npm audit --omit=dev`: two package entries for the single documented
  RSC-only React Router advisory;
- full `npm audit`: the two production entries plus five ESLint 9 transitive
  development entries;
- production preview `/`, `/topic/smoke-topic`, and `/thread/smoke-thread`:
  HTTP 200 with the SPA document;
- headless-browser root load, client navigation to Topic and Thread routes, and
  browser back/forward: passed with no runtime diagnostics;
- `git diff --check`: passed.

Normal lockfile metadata maintenance updated `caniuse-lite` to
`1.0.30001806`. The final production build no longer reports the stale
Browserslist database-age notice. No recurring update dependency was added.

Direct deep-route execution in the plain Vite preview cannot resolve the
relative asset URLs because that standalone server does not inject Qortium
Core's resource `<base>` element. The current checked-out Core implementation
was re-verified to inject both the resource base and `_qdnBase` before the app
runs, which is the deployment contract expected by `BrowserRouter`. The
standalone headless test therefore exercised deep routes through client
navigation; their not-found views were expected without live QDN forum data.

An interactive Qortium Home browser was not available for automated closure.
Refresh on a routed page under an actually injected QDN base, legacy/share
redirects with live content, lazy-chunk recovery, and embedded runtime console
observation remain documented manual release checks. The router API and
application route definitions did not require source changes.

Issue #14 subsequently added `@types/node` on the Node 24 line so the
TypeScript-checked Vite configuration can emit validated license/QAVS release
metadata from repository files. It is development-only, introduces no runtime
bundle capability, and does not reopen the controlled issue #13 dependency
decisions.
