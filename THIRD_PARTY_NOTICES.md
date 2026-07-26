# Third-party notices

Discussion Boards is licensed under `GPL-3.0-only`. The production bundle also
contains or may include code from the packages below. These permissive licenses
are compatible with distribution of the combined application under GPLv3; the
third-party components retain their own copyright and license notices.

The inventory was verified from the npm 12 lockfile and installed package
metadata on 2026-07-26.

| Component              | Version | License | Copyright or author notice                                                                        |
| ---------------------- | ------: | ------- | ------------------------------------------------------------------------------------------------- |
| `@babel/runtime`       |  7.28.6 | MIT     | Copyright (c) 2014-present Sebastian McKenzie and other contributors                              |
| `cookie`               |   1.1.1 | MIT     | Copyright (c) 2012-2014 Roman Shtylman; Copyright (c) 2015 Douglas Christopher Wilson             |
| `html-parse-stringify` |   3.0.1 | MIT     | Henrik Joreteg                                                                                    |
| `i18next`              |  25.8.4 | MIT     | Copyright (c) 2025 i18next                                                                        |
| `react`                |  19.1.0 | MIT     | Copyright (c) Meta Platforms, Inc. and affiliates                                                 |
| `react-dom`            |  19.1.0 | MIT     | Copyright (c) Meta Platforms, Inc. and affiliates                                                 |
| `react-i18next`        |  15.7.4 | MIT     | Copyright (c) 2025 i18next                                                                        |
| `react-router`         |  7.18.1 | MIT     | Copyright (c) React Training LLC 2015-2019; Remix Software Inc. 2020-2021; Shopify Inc. 2022-2023 |
| `react-router-dom`     |  7.18.1 | MIT     | Copyright (c) React Training LLC 2015-2019; Remix Software Inc. 2020-2021; Shopify Inc. 2022-2023 |
| `scheduler`            |  0.26.0 | MIT     | Copyright (c) Meta Platforms, Inc. and affiliates                                                 |
| `set-cookie-parser`    |   2.7.2 | MIT     | Copyright (c) 2015 Nathan Friedly                                                                 |
| `void-elements`        |   3.1.0 | MIT     | Copyright (c) 2014 hemanth                                                                        |

The locked production dependency graph also includes TypeScript 5.7.3 as
optional package metadata used by i18next. TypeScript is licensed under
Apache-2.0 and is not shipped as application runtime code by the Vite build.
The Apache-2.0 license is compatible with GPLv3.

## MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Repository content audit

- No third-party fonts, audio, video, or image collections are bundled.
- The previous imported binary favicon had no recoverable provenance. It was
  replaced for this release with a repository-authored SVG covered by the
  project license.
- Inline interface icons are project source and have no separate attribution
  marker or vendored icon package.
- Qortium Core and Qortium Home are inspected as external reference
  implementations; their source is not copied into the production artifact.
- `node_modules` and build-tool sources are not committed or included in the
  release archive.

Package-specific license files remain available in their upstream source
repositories and npm distributions.
