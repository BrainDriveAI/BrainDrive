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

App-published project documents use the normal read-only `DocumentView`. Optional validated quality metadata appears as a bordered text status in the document header with an accessible name; it never changes the Markdown body or enables editing. Files without this metadata retain the existing generic document behavior.

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
| `npm run test:e2e:browser-access` | Build and test expired-token app launch through the real LAN bridge on non-loopback HTTP |

Playwright commands use `scripts/run-isolated-e2e.mjs`. The runner creates disposable memory, secrets, local-auth, gateway, web, and artifact roots; seeds a synthetic local account; selects credential-free Ollama only to suppress provider onboarding; runs the requested projects; and removes only its temporary root. The browser-access command serves the production bundle through the real LAN bridge and requires a reachable non-loopback IPv4 interface. Install the Playwright browsers first. No provider credential or running model is required for these checks. See [change verification](../../../docs/developers/verification.md#open-06-and-browser-e2e); Playwright is not the provider-independent startup baseline.

By default the runner is disposable with no artifacts retained. An explicitly authorized synthetic evidence run may set `BRAINDRIVE_E2E_RETAIN_EVIDENCE_ROOT` to an absolute external task-owned directory. That opt-in retains only the three allowlisted synthetic screenshots (`resume-builder-owner-review.png`, `resume-builder-career-preview.png`, and `resume-builder-version-comparison.png`), strict content-free recovery and inference manifests (`spec10-browser-recovery-matrix.json` and `spec10-browser-inference-matrix.json`) when their focused tests are selected, and a content-free `sanitized-browser-run.json` summary. Each manifest must pass the runner's exact IDs, fields, counters, states, and size validation before it is copied. The raw Playwright trace is never retained because it may contain credentials, loopback endpoints, or private temporary paths. The task owner is responsible for reviewing and later removing the external evidence directory.

## Project sidebar

Page navigation has four direct entries in this exact order: **Conversation, Your Files, Tools, Behavior**. Conversation uses a bright white label with an amber icon/edge accent in every view. Your Files, Tools, and Behavior use the slightly muted white navigation label token (`#B0B7C2`). Icons, selected backgrounds/borders, hover backgrounds, and keyboard focus retain their original styling. Selected background and `aria-current` identify the actual current entry. An icon-only **Home** button at the right of the top logo row has a tooltip, accessible name, and 44 px target. It returns to the existing root `your-agent` page through `deselectProject`, matching the clickable logo's destination rather than browser history. The main content shows one compact Expert title, with no identity bar, purpose subtitle, current-view badge, or repeated Expert name in the sidebar/document header. These presentation changes do not generate messages or modify prompt/instruction content.

All four destinations are contiguous below the header, with visible keyboard focus and selected states. Each opens its own central view; the sidebar has no nested file lists or combined tools/settings item. Desktop Collapse and the account-menu icon form a compact right-hand control group inside the existing account/instance footer, with no standalone row. Both icons have matching 44 px visual areas, a shared centerline and 4 px spacing; Collapse has a separate 44 px target. The account identity stays left. The entire footer is one native account-menu button, with the separate Collapse/Expand button positioned above its reserved area as a sibling; no interactive controls are nested. Identity, dots and surrounding footer space all open the same menu. Keyboard focus and tooltips remain visible; Escape closes the menu and returns focus to the account trigger. The menu uses a centered MoreHorizontal icon rather than baseline text dots. Expanded mode keeps the owner name and instance label; the rail uses the same account avatar and menu. Global Settings, Community, and Log Out remain in that existing menu; no separate Settings gear is added. Expanded Collapse is right-aligned to the same edge as the top Home icon. The account trigger and Collapse are independent sibling controls; Collapse receives clicks in its reserved area without activating the account trigger, and toggling closes an open account menu. The narrow rail stacks Expand and the account avatar within the same footer. Both use 44 px targets and preserve focus, page context, current view, and drafts. Behavior remains a separate page destination. The collapsed Expert rail shows a top Home icon and the same four page destinations; the global rail remains for Home/Apps. Mobile keeps its existing menu and close controls and does not show desktop collapse/expand. The desktop title is anchored to the main area's left edge with a 16 px gutter; the mobile title spacing stays unchanged.

Your Files separates **Direction & progress** (existing `spec.md`, `plan.md`, `todo.md`, `journal.md`) from **Your work**. Missing files have honest empty states; no files or tasks are invented. When `todo.md` is absent, no To-do link is invented. Existing empty/error states remain; this preview does not synchronize page tasks with global `me/todo.md`. These implementation details are kept in review notes rather than the main Your Files view. Core files and outputs use the existing editor and return to Your Files. Published output retains its metadata/read-only state. Unknown files stay available under Your work. Reusable templates and instructions stay in Behavior.

Behavior opens with “See and change how your Expert helps you” and retains owner-facing instructions, interview guidance, and template labels. Base/supporting files, customization overlays, and paths remain under Technical details. Existing paths and file contents are preserved. Opening guidance does not run an interview or register a skill. Global account/model settings retain their existing profile access and are not added to this page view.

Tools reads existing registered page skill assignments. Page connection permissions, agent assignments, and app assignments are unavailable prototype capabilities, clearly marked. The proposed connection model is one global account connection with separate page permission; this UI creates no credentials or permissions. The existing app catalog remains global.

File location is a plain, visible section. A verified local development preview can opt into Finder access instructions with ignored `.env.development.local` values: `VITE_LOCAL_PREVIEW_ORIGIN`, `VITE_LOCAL_PREVIEW_PROJECT_ID`, and `VITE_LOCAL_PREVIEW_FOLDER_PATH`. They must describe the actual host folder, never a container path. Display requires development mode, a loopback browser hostname, an exact origin match, and the configured project. The isolated preview alone supplies these values; the repository contains no real host path. Production builds do not load the development-only environment file, and the development guard removes this lookup from production code. Do not distribute the preview configuration or reuse it in shared/managed deployments. Without it, the section honestly shows a path within BrainDrive storage and does not claim local folder access. Clipboard success/failure is reported. No folder-opening bridge, filesystem access, or extra permission is added.

DocumentView stays keyed by project/file identity to preserve isolated unsaved drafts across navigation. Existing chat input draft storage is unchanged. This UI batch does not modify or test model responses, interview behavior, generated chat links/status/summaries, or approval logic.

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

The Apps surface loads the deterministic host catalog from `/api/apps` and renders every verified first-party entry through one app card component. Cards default to the compact view, which retains app identity, status, description, and lifecycle controls while hiding trust, capability, and retention details; owners can reveal those sections with the detail toggle. Each app card uses compact host-authored description copy and exposes the verified package summary in an accessible hover/focus tooltip when available. Lifecycle and session calls use the host route key from that catalog; card text remains plain React text, privileged controls come only from `available_actions`, and per-app busy/error/session state cannot disable an unrelated card. The same catalog can also include an additive `packages` projection. Apps renders those installed app/provider/dependency package records in a separate lifecycle section with safe package identity, component kind, lifecycle state, health class, version, operation IDs, dependency IDs, target labels, retention class, dependency readiness, and projected action labels. Required generic operation dependency failures render an owner-visible blocked status and do not show Launch/Start labels; unknown readiness is not treated as launchable; optional failures render degraded status and remain launchable only when the Host projection still includes Launch. Selection-required states point to owner/admin provider selection and do not choose or switch providers from the app surface. Search/Read dependencies show first-use/install/update data handling copy: queries and URLs may be sent to the selected provider, provider keys and unrelated owner data are not sent, owner-managed provider costs are outside BrainDrive, and denied or revoked approval leaves Search/Read unavailable. Provider-only and dependency-service packages do not show Launch unless a launchable app component exists, and package lifecycle action labels remain disabled until a later package mutation route supplies authority. After the owner first opens Apps, the shell keeps that workspace mounted but hidden during navigation to other BrainDrive surfaces. Returning to Apps therefore restores the same selected iframe and unsaved in-memory UI state; temporarily hiding the browser tab is also non-terminal. Explicit Close, page teardown, lifecycle invalidation, and host expiry retain their existing teardown behavior. The sandbox frame keeps the opaque-origin proxy, CSP, nonce/window checks, and bridge limits while labeling the selected app generically. Consequential capability confirmations use a host-authored capability identity/title/action projection. For the current Resume Builder evaluation, the owner's in-app action automatically completes the host confirmation replay for an exact allowlist of Resume data mutations, eliminating the redundant second dialog without changing server enforcement; Brief Builder and host export, clipboard, and external-link confirmations remain explicit. Resume export, Career return, and model-settings recovery remain explicit trusted Resume adapters and are not inherited by other apps.

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

The generic sandbox confirmation dialog consumes host-reviewed presentation for both first-party apps. Brief Builder's product workflow remains inside its signed one-screen package; the shell contributes only app-keyed transport, isolation, and owner confirmation.
