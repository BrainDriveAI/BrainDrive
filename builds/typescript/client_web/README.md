# BrainDrive Web Client

The BrainDrive web client is the production React interface used in browser, Docker, managed, and Tauri desktop deployments. It connects to the BrainDrive gateway for configuration, authentication, chat streaming, projects, files, settings, backups, model providers, and account operations.

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

For the Docker development stack:

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

Playwright tests require a running gateway and installed Playwright browsers. The Playwright configuration starts or reuses the Vite server.

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
- [Tailscale remote access](../../../docs/tailscale-remote-access.md)

## License

BrainDrive is licensed under the [MIT License](../../../LICENSE).
