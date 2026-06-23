# BrainDrive Client

Web interface for BrainDrive — a React SPA that talks to the BrainDrive backend through an adapter layer.

## Quick Start

```bash
cd client
npm install
npm run dev        # http://localhost:5073
```

## Scripts

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Preview production build |
| `npm run typecheck` | TypeScript check (no emit) |
| `npm test` | Run Vitest tests |
| `npm run test:watch` | Run tests in watch mode |

## Tech Stack

- **React 19** + TypeScript (strict mode)
- **Vite 6** — SPA bundler, no SSR
- **Tailwind CSS 4** — utility-first with BrainDrive design tokens
- **shadcn/ui** — copy-paste components (Radix primitives)
- **Vercel AI SDK** (`@ai-sdk/react`) — `useChat` for streaming (not yet wired)
- **react-markdown** + remark-gfm + rehype-highlight — markdown rendering
- **Lucide React** — SVG icons

## Project Structure

```
client/
├── public/
│   ├── braindrive-logo.svg       # Full logo (sidebar, login)
│   └── favicon.svg               # Brain icon (browser tab)
├── src/
│   ├── App.tsx                   # Root — auth flow → main interface
│   ├── main.tsx                  # Entry point (ErrorBoundary, Router)
│   ├── components/
│   │   ├── auth/                 # Login, Signup, ForgotPassword, AuthFlow
│   │   ├── chat/                 # ChatPanel, MessageList, Composer, EmptyState,
│   │   │                        #   TypingIndicator, ErrorMessage, ConnectionBanner
│   │   ├── layout/              # AppShell, Sidebar, SidebarCollapsed, ProfileMenu
│   │   ├── onboarding/          # WhyFinderScreen (built, deferred from flow — D32)
│   │   ├── settings/            # SettingsModal (6 tabs, mode-aware)
│   │   ├── ui/                  # shadcn/ui primitives (ScrollArea, Separator, etc.)
│   │   └── ErrorBoundary.tsx    # App-level crash recovery
│   ├── hooks/
│   │   └── useThreads.ts        # Thread state (mock data, replaced in Phase 4)
│   ├── design/
│   │   └── tokens.ts            # BrainDrive design tokens (reference)
│   └── utils/
│       └── file-utils.ts        # Shared file validation, formatting, types
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Design System

Colors, typography, and spacing are defined as CSS custom properties in `src/index.css` and as a TypeScript reference in `src/design/tokens.ts`. The design system uses:

- **Amber accent** (`#F5A623`) — CTAs, send button, active states. Text on amber is always dark (`#03050A`), never white.
- **Blue foundation** — backgrounds, text, borders
- **Montserrat** — headings and CTAs
- **Questrial** — body text
- **Dark mode only** (light mode deferred to V1.1). Do not introduce white/near-white (`#FFFFFF`, `#FAFAFA`) surfaces, cards, or buttons.

Contrast rule for buttons and labels: all product surfaces are dark, so white or near-white text belongs only on a dark fill. Never put light text on a light fill. If a control looks washed out or invisible, the fill is wrong; fix the background instead of changing text away from the design tokens.

## Deployment Modes

The same client serves both local (Docker) and managed (braindrive.ai) hosting. A `mode` prop flows through the app and controls:

- **Auth screens** — username (local) vs email (managed)
- **Settings tabs** — Account + Billing only show for managed
- **Model Provider** — API key entry (local) vs "managed by BrainDrive" (managed)
- **Export messaging** — more prominent on managed (exit-to-ownership)
- **Tier label** — "BrainDrive Local" / "BrainDrive Concierge"

In production, mode comes from `GET /api/config`. During development, a toggle in the bottom-right corner switches modes.

## Current Status

**All pre-backend UI is built.** The interface is fully functional as a visual shell — auth, settings, file upload, chat components, error states, empty state. Everything uses placeholder/mock data.

**What's placeholder (will change when backend is wired):**
- Mock messages in `mockMessages.ts`
- Mock threads in `mockThreads.ts`
- Hardcoded user "Dave Waring" in sidebar profile
- Auth flow accepts any credentials
- File upload attaches but doesn't send
- Typing indicator / connection state managed locally

**What's permanent:**
- Component structure and layout
- Design tokens and styling
- File upload UI (picker, drag-and-drop, validation)
- Settings modal structure and mode-aware tabs
- Error boundary, error messages, connection banner
- Responsive mobile layout

## Next Steps

Backend integration is blocked on the API contract spike with Dave J (T-298). See `projects/active/braindrive-repo/v1-api-contract-recommendations.md` for proposed routes. After that:

1. **Phase 2** — Wire auth to real endpoints (httpOnly cookies)
2. **Phase 3** — Wire chat to Gateway via `useGatewayChat` adapter
3. **Phase 4** — Wire threads to Gateway conversation list/history
4. **Phase 5** — WhyFinder onboarding flow (if re-enabled)
5. **Phase 6** — Settings, file upload, mobile polish with real backend

## License

MIT — see [LICENSE](../LICENSE) in the repo root.

## Related Docs

- [V1 Interface Spec](../../BrainDrive-Library/projects/active/braindrive-repo/v1-interface-spec.md)
- [V1 Interface Build Plan](../../BrainDrive-Library/projects/active/braindrive-repo/v1-interface-build-plan.md)
- [V1 Interface Test Plan](../../BrainDrive-Library/projects/active/braindrive-repo/v1-interface-test-plan.md)
- [API Contract Recommendations](../../BrainDrive-Library/projects/active/braindrive-repo/v1-api-contract-recommendations.md)
