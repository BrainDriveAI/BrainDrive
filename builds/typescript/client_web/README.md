# BrainDrive Web Client

<!-- catalog-contract:start web-client-boundary -->
> **Document contract**
> - Purpose: Define the source-adjacent web-client boundary and checks.
> - Audience: Recurring contributors, Maintainers.
> - Status: Current on `dev`.
> - Owner role: runtime-maintainers.
> - Expected outcome: A contributor finds web source, adapters, design authority, and checks.
> - Prerequisites: Node.js and workspace dependencies.
> - Parent: [docs/developers/README.md](../../../docs/developers/README.md).
> - Adjacent topics: [Architecture overview](../../../docs/developers/architecture/README.md); [TypeScript runtime workspace](../README.md).
> - Keywords: `web client`, `React`, `Vite`.
> - Sources: [`builds/typescript/client_web/README.md`](./README.md); [`builds/typescript/client_web/package.json`](./package.json).
> - Tests: [`tools/docs/test/links.test.mjs`](../../../tools/docs/test/links.test.mjs).
<!-- catalog-contract:end web-client-boundary -->

The BrainDrive web client is the production React interface used in browser, Docker, managed, and Tauri desktop deployments. It connects to the BrainDrive gateway for configuration, authentication, chat streaming, projects, files, settings, backups, model providers, and account operations.

Developer routes: [developer documentation index](../../../docs/developers/README.md), [repository map](../../../docs/developers/repository-map.md), and [architecture overview](../../../docs/developers/architecture/README.md#web-client).

Runtime data comes from the gateway. Unit and component tests mock API boundaries, but the running application does not use mock users, conversations, or projects.

## How It Fits

```text
Browser or Tauri
      |
React web client
      |
API adapters in src/api/
      |
BrainDrive gateway
      |
Engine, auth, memory, secrets, and MCP services
```

Browser requests use the relative `/api` base path. During local development, Vite proxies that path to the gateway and removes the `/api` prefix. The default gateway target is `http://127.0.0.1:8787`; set `VITE_GATEWAY_PROXY_TARGET` to use a different target. In Tauri, the client resolves the native runtime URL and adds the desktop transport token.

## Quick Start

### Full Stack

From the repository root, install the three TypeScript workspaces and start the gateway, MCP services, and web client:

```bash
npm --prefix builds/typescript ci
npm --prefix builds/mcp_release ci
npm --prefix builds/typescript/client_web ci
npm --prefix builds/typescript run dev
```

Open `http://127.0.0.1:5073`. The development runtime starts the gateway on port `8787` and the Vite client on port `5073`.

For the Docker development stack, use the canonical repo-root script paths:

```bash
./installer/docker/scripts/install.sh dev  # first installation
./installer/docker/scripts/start.sh dev    # existing installation
```

### Web Client Only

If the BrainDrive gateway is already running:

```bash
cd builds/typescript/client_web
npm ci
npm run dev
```

To proxy to a gateway on another address:

```bash
VITE_GATEWAY_PROXY_TARGET=http://127.0.0.1:9000 npm run dev
```

## Scripts

Run these from `builds/typescript/client_web/`:

| Command | Purpose |
|---|---|
| `npm run dev` | Start Vite on `0.0.0.0:5073` with the gateway proxy |
| `npm run lint` | Run TypeScript, React Hooks, and JSX accessibility lint checks |
| `npm run typecheck` | Run TypeScript checks without emitting files |
| `npm test` | Run the Vitest unit and component suite once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run build` | Type-check and create the production bundle in `dist/` |
| `npm run preview` | Serve the production bundle locally |
| `npm run test:e2e` | Run Playwright across desktop Chrome and mobile browser projects |
| `npm run test:e2e:mobile` | Run only the mobile Chrome and Safari projects |

Playwright commands use `scripts/run-isolated-e2e.mjs`. The runner creates disposable memory, secrets, local-auth, gateway, Vite, and artifact roots; seeds a synthetic local account; selects credential-free Ollama only to suppress provider onboarding; runs the requested projects; and removes only its temporary root. Install the Playwright browsers first, then use `npm run test:e2e` or `npm run test:e2e:mobile`. No provider credential or running model is required for the layout/auth-shell checks. See [change verification](../../../docs/developers/verification.md#open-06-and-browser-e2e); Playwright is not the provider-independent startup baseline.

## Project sidebar

Page navigation has four direct entries in this exact order: **Conversation, Your Files, Tools, Behavior**. Conversation uses a bright white label with an amber icon/edge accent in every view. Your Files, Tools, and Behavior use the slightly muted white navigation label token (`#B0B7C2`). Icons, selected backgrounds/borders, hover backgrounds, and keyboard focus retain their original styling. Selected background and `aria-current` identify the actual current entry. An icon-only **Home** button at the right of the top logo row has a tooltip, accessible name, and 44 px target. It returns to the existing root `your-agent` page through `deselectProject`, matching the clickable logo's destination rather than browser history. The main content shows one compact Expert title, with no identity bar, purpose subtitle, current-view badge, or repeated Expert name in the sidebar/document header. These presentation changes do not generate messages or modify prompt/instruction content.

All four destinations are contiguous below the header, with visible keyboard focus and selected states. Each opens its own central view; the sidebar has no nested file lists or combined tools/settings item. Desktop Collapse and the account-menu icon form a compact right-hand control group inside the existing account/instance footer, with no standalone row. Both icons have matching 44 px visual areas, a shared centerline and 4 px spacing; Collapse has a separate 44 px target. The account identity stays left. The entire footer is one native account-menu button, with the separate Collapse/Expand button positioned above its reserved area as a sibling; no interactive controls are nested. Identity, dots and surrounding footer space all open the same menu. Keyboard focus and tooltips remain visible; Escape closes the menu and returns focus to the account trigger. The menu uses a centered MoreHorizontal icon rather than baseline text dots. Expanded mode keeps the owner name and instance label; the rail uses the same account avatar and menu. Global Settings, Community, and Log Out remain in that existing menu; no separate Settings gear is added. Expanded Collapse is right-aligned to the same edge as the top Home icon. The account trigger and Collapse are independent sibling controls; Collapse receives clicks in its reserved area without activating the account trigger, and toggling closes an open account menu. The narrow rail stacks Expand and the account avatar within the same footer. Both use 44 px targets and preserve focus, page context, current view, and drafts. Behavior remains a separate page destination. The collapsed Expert rail shows a top Home icon and the same four page destinations. Mobile keeps its existing menu and close controls and does not show desktop collapse/expand. The desktop title is anchored to the main area's left edge with a 16 px gutter; the mobile title spacing stays unchanged.

Your Files separates **Direction & progress** (existing `spec.md`, `plan.md`, `todo.md`, `journal.md`) from **Your work**. Missing files have honest empty states; no files or tasks are invented. When `todo.md` is absent, no To-do link is invented. Existing empty/error states remain; this preview does not synchronize page tasks with global `me/todo.md`. These implementation details are kept in review notes rather than the main Your Files view. Core files and outputs use the existing editor and return to Your Files. Unknown files stay available under Your work. Reusable templates and instructions stay in Behavior.

Behavior opens with “See how your Expert helps you” and retains owner-facing instructions, interview guidance, and template labels. Base/supporting files and paths remain under Technical details. Files show as they are; editing Expert behavior comes later. Existing paths and file contents are preserved. Opening guidance does not run an interview or register a skill. Global account/model settings retain their existing profile access and are not added to this page view.

Tools reads existing registered page skill assignments. Connections and Agents show "Coming later". This UI creates no credentials or permissions.

File location is a plain, visible section. A verified local development preview can opt into Finder access instructions with ignored `.env.development.local` values: `VITE_LOCAL_PREVIEW_ORIGIN`, `VITE_LOCAL_PREVIEW_PROJECT_ID`, and `VITE_LOCAL_PREVIEW_FOLDER_PATH`. They must describe the actual host folder, never a container path. Display requires development mode, a loopback browser hostname, an exact origin match, and the configured project. The isolated preview alone supplies these values; the repository contains no real host path. Production builds do not load the development-only environment file, and the development guard removes this lookup from production code. Do not distribute the preview configuration or reuse it in shared/managed deployments. Without it, the section honestly shows a path within BrainDrive storage and does not claim local folder access. Clipboard success/failure is reported. No folder-opening bridge, filesystem access, or extra permission is added.

This UI batch does not modify or test model responses, interview behavior, generated chat links/status/summaries, or approval logic.

## Runtime Integration

The client is wired to the current gateway and desktop runtime:

- `src/api/config-adapter.ts` loads deployment and installation metadata from `/api/config`.
- `src/api/auth-adapter.ts` handles bootstrap status, local signup and login, token refresh, local-owner requests, and managed authentication.
- `src/api/gateway-adapter.ts` owns gateway requests for streaming chat, approvals, conversations, projects, files, skills, settings, providers, backups, exports, credits, and accounts.
- `src/api/useGatewayChat.ts` manages SSE chat events and conversation state.
- `src/hooks/useProjects.ts` loads and mutates real gateway projects and their files.
- `src/api/runtime-api-base.ts` resolves browser and Tauri gateway URLs and desktop authentication headers.
- `src/api/desktop-browser-access.ts` and `src/api/desktop-tailscale-access.ts` bridge desktop-only remote-access controls.

Keep gateway request and response normalization inside `src/api/`. Components should consume adapter or hook interfaces rather than constructing backend URLs directly.

## Runtime Modes

`App.tsx` loads runtime configuration before choosing the auth and application flow:

- `mode` is `local` or `managed` and controls the authentication boundary and mode-specific UI.
- `install_mode` is `dev`, `local`, or `prod`.
- `install_location` is `local` or `managed`.

Managed deployments trust gateway-provided authentication and skip the local login flow. Local deployments use the gateway's configured local or local-owner auth behavior. The same built client is also embedded in the Tauri desktop shell.

Production first signup requires the bootstrap token generated in the installer `.env`. The signup form sends this value only through the `x-paa-bootstrap-token` header; it is not included in the credential request body.

## Project Structure

```text
client_web/
├── e2e/                     # Playwright desktop and mobile layout tests
├── public/                  # Logos, favicon, splash page, and local fonts
├── src/
│   ├── api/                 # Gateway, auth, config, SSE, and desktop adapters
│   ├── components/
│   │   ├── auth/            # Bootstrap, signup, login, and recovery screens
│   │   ├── chat/            # Streaming chat, composer, messages, and errors
│   │   ├── document/        # Project file viewer
│   │   ├── layout/          # App shell, sidebar, and responsive navigation
│   │   ├── markdown/        # Markdown rendering
│   │   ├── onboarding/      # Provider and guided onboarding surfaces
│   │   ├── settings/        # Models, account, backup, and access settings
│   │   └── ui/              # Shared Radix/shadcn-style primitives
│   ├── design/tokens.ts     # TypeScript design-token reference
│   ├── hooks/useProjects.ts # Project and file state backed by the gateway
│   ├── App.tsx              # Runtime configuration and top-level auth flow
│   ├── index.css            # CSS tokens, fonts, and global styles
│   └── main.tsx             # React, router, error boundary, and Tauri startup
├── package.json
├── playwright.config.ts
├── tsconfig.json
└── vite.config.ts
```

Tests live beside the code they cover as `*.test.ts` or `*.test.tsx`.

## Tech Stack

- React 19 and React Router 7
- TypeScript 5.9 in strict mode
- Vite 8
- Tailwind CSS 4
- Radix UI primitives with shadcn-style local components
- `react-markdown`, `remark-gfm`, and `rehype-highlight`
- Vitest 4 and Testing Library
- Playwright 1
- Tauri 2 browser APIs for desktop integration

## Design System

`src/index.css` and `src/design/tokens.ts` are the design source of truth. Reuse their tokens instead of introducing one-off colors or spacing.

- The client is dark mode only.
- Amber (`#F5A623`) is the primary action color.
- Text on amber must be dark (`#03050A`), never white or another light color.
- Montserrat is used for headings and calls to action; Questrial is used for body text.

For UI changes, verify the affected desktop and mobile states in addition to running typecheck, tests, and build.

## Verification

From `builds/typescript/`:

```bash
npm run web:lint
npm run web:typecheck
npm run web:test
npm run web:build
```

Use focused Vitest runs while iterating, then run the complete web suite before handoff. Run the relevant Playwright project when a change affects responsive layout or browser behavior.

## Related Documentation

- [Repository overview](../../../README.md)
- [Contributing guide](../../../CONTRIBUTING.md)
- [Docker development and deployment](../../../installer/docker/README.md)
- [Native development journey](../../../docs/developers/setup/native.md)
- [Change verification](../../../docs/developers/verification.md)
- [Safe debugging](../../../docs/developers/debugging.md)
- [Tailscale remote access](../../../docs/tailscale-remote-access.md)

## License

BrainDrive is licensed under the [MIT License](../../../LICENSE).

## Experts and skills UX prototype

Add Expert and Remove Expert are interface prototypes. The gateway has no Expert install, review, or create endpoints, so those screens call `src/prototype/expertsMock.ts` instead. One flag controls it: the screens are on in `npm run dev` and absent from production builds; set `VITE_EXPERTS_MOCK=false` in `.env.development.local` to hide them. Create your own and Install Expert add a normal page through the existing project create call; the package review shows sample text, not a real package. Remove Expert uses the existing project delete call, which takes the page out of the sidebar and leaves its files in place. Nothing here changes the gateway, memory, or Expert content.
