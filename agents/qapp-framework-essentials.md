Qortal qApp Framework Essentials

Purpose

This file is a compact bootstrap guide for starting a new Qortal qApp
project with the `create-qortal-app` workflow. It is intended for AI
agents and removes non-essential explanatory material from the longer
framework notes.

Use Case

Use this file when a new Qortal project needs to be created from
scratch. The agent should read this before implementing product-specific
features.

Core Assumptions

- The user primarily builds Qortal qApps.
- The preferred starter is `create-qortal-app`.
- The expected template is `react-default-template`.
- The project should be prepared so development can begin immediately
  after bootstrap.

Requirements

- Node.js 22 or newer
- Qortal Hub with Developer Mode enabled
- VS Code or another code editor
- Basic React and TypeScript compatibility in the environment

Official Reference Sources

Prefer these sources when the agent needs authoritative Qortal guidance:

- Q-App and extension docs: `https://qortal.dev/docs/extension`
- Developer entrypoint: `https://qortal.dev/devs`
- API documentation: `https://api.qortal.org/api-documentation/`
- qapp-core repository: `https://github.com/Qortal/qapp-core`

Bootstrap Workflow

1. Create the project with:
   `npx create-qortal-app`
2. When prompted for the app name, use the project name provided by the
   user or the project vision file.
3. When prompted for the template, choose:
   `react-default-template`
4. Open the generated project directory.
5. Inspect `AppWrapper.tsx` immediately.
6. Set the `GlobalProvider` config correctly before doing feature work.
7. Check `vite.config.*` and ensure the build base works in Qortal.
8. Verify the app uses relative paths and Qortal-compatible routing.

Critical AppWrapper Step

The generated project must be updated in `AppWrapper.tsx` so
`GlobalProvider` receives the correct app metadata.

The key fields are:

- `publicSalt`
- `appName`
- `auth.authenticateOnMount`
- `auth.balanceSetting.interval`
- `auth.balanceSetting.onlyOnMount`

Expected shape:

```tsx
import { GlobalProvider } from "qapp-core";
import Layout from "./styles/Layout";
import { publicSalt } from "./qapp-config";

export const AppWrapper = () => {
  return (
    <GlobalProvider
      config={{
        auth: {
          balanceSetting: {
            interval: 180000,
            onlyOnMount: false,
          },
          authenticateOnMount: true,
        },
        publicSalt,
        appName: "Your App Name",
      }}
    >
      <Layout />
    </GlobalProvider>
  );
};
```

App Name Rule

- `appName` should ideally match the intended Qortal app name.
- During development, using a temporary suffix like `Test` is acceptable
  if the user wants isolated test data.
- Do not change `appName` casually after production use begins, because
  existing app-related data may no longer align with the new name.

Development Start

Start the generated app with:

`npm run dev`

In Qortal Hub Developer Mode, register the local dev server. The usual
frontend port is often `5173`, but the agent should confirm the actual
port from terminal output.

Critical Vite Base Rule

Qortal apps do not run from a normal fixed root path. The app is usually
served under a dynamic local URL inside Qortal UI. Because of that:

- do not rely on absolute asset paths
- prefer relative asset paths
- ensure Vite base is:
  `base: './'`

If the base is wrong, the app may show a blank screen because JS and CSS
files are resolved from the wrong location.

Routing Rule

Because the app runs in a Qortal context, the agent should avoid
assuming classic web hosting behavior.

- prefer relative paths for static assets
- avoid root-based asset references like `/assets/...`
- if routing is used, make sure the routing strategy is compatible with
  Qortal delivery and the generated build output

Important qapp-core Concepts

The agent should know these basics without re-reading the full long
guide every time:

- `GlobalProvider` is required and wraps the app.
- `qortalRequest()` is the main bridge for user-approved actions and
  futureproof Qortal integration.
- `useAuth()` provides authenticated user info such as address,
  publicKey, name, loading state, and a manual `authenticateUser()`
  trigger.
- `useQortBalance()` provides the user QORT balance, loading state, and
  a method for refreshing balance data.
- `ResourceListDisplay` is the main list helper for rendering QDN
  resources, including fetching, downloading, pagination, caching, and
  new-data polling.

ResourceListDisplay Minimum Viable Usage

At minimum, provide:

- `listName`
- `search`
- `listItem`

Typical baseline:

```tsx
import { ResourceListDisplay, QortalSearchParams } from "qapp-core";

const search: QortalSearchParams = {
  service: "DOCUMENT",
  limit: 20,
  reverse: true,
  identifier: "example-",
};

<ResourceListDisplay
  listName="example-list"
  search={search}
  listItem={(item) => <div>{item?.data?.title}</div>}
/>;
```

Useful ResourceListDisplay Notes

- `listName` should be unique for each list.
- Keep `search` stable unless intentionally resetting the list query.
- Use `loaderItem` for loading and error UI.
- Use `disableVirtualization` when the UX requires pagination-style list
  rendering.
- Use `searchNewData`, `onNewData`, and `ref.resetSearch()` when the UI
  needs a “show new items” workflow.
- Use `returnType="BASE64"` for non-JSON or encoded resource content.

What the Agent Should Actually Do

For a new project, the agent should:

1. create the project with `create-qortal-app`
2. choose `react-default-template`
3. verify the generated structure
4. configure `AppWrapper.tsx`
5. set the correct app name
6. preserve `publicSalt` integration
7. check `vite.config.*` and set `base: './'` when needed
8. confirm the project uses relative paths for assets
9. confirm the project starts in dev mode
10. only then move on to project-specific feature implementation

What Can Be Ignored from the Longer Framework Guide

The agent does not need the full motivational text or extended tutorial
style explanations. The recurring high-value parts are:

- environment requirements
- `create-qortal-app` bootstrap
- template selection
- `AppWrapper.tsx` configuration
- `GlobalProvider` role
- `useAuth`
- `useQortBalance`
- `ResourceListDisplay` basics

Recommended Order with Other Agent Files

For best results on a brand new project, read files in this order:

1. project vision file written for the new app
2. `agents/qapp-framework-essentials.md`
3. `agents/qortal-runtime-performance-rules.md`
4. `agents/project-sync-backup-workflow.md`

This sequence helps the agent first understand what to build, then how
to bootstrap a valid Qortal qApp, then how to respect Qortal runtime and
performance constraints, and finally how to set up repository sync and
backup automation.
