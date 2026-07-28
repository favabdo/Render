# NileChat — Enterprise Monorepo

WhatsApp Cloud API customer-support dashboard. Node.js/Express + SQL Server backend,
React + Vite frontend.

## Structure

```
project/
  client/    React + Vite frontend (feature-based architecture)
  server/    Express API (layered: controllers → services → repositories → database)
  docs/      Misc reference docs (legacy Vercel entry point, kept for history)
  shared/    Reserved for future cross-package types/constants
```

## Quick start

```bash
# 1. Backend
cd server
npm install
cp .env.example .env      # fill in DB_*, JWT_SECRET, WHATSAPP_*, RESEND_API_KEY...
npm start                 # http://localhost:3000

# 2. Frontend (separate terminal)
cd client
npm install
npm run dev                # http://localhost:5173, proxies /api /auth /webhook to :3000
```

## Client scripts

| Script | Does |
|---|---|
| `npm run dev` | Vite dev server with hot reload + API proxy |
| `npm run build` | Production build → `client/dist` |
| `npm run lint` | oxlint — fast static analysis |
| `npm run format` | Prettier — auto-formats `src/**/*.{js,jsx,css}` |
| `npm run test` | Vitest — unit/component tests (`src/**/__tests__`) |
| `npm run preview` | Serve the production build locally |

## Client architecture

- **`features/<name>/`** — one folder per business area (auth, chats, contacts, templates,
  scheduled-tasks, settings, profile, ai, analytics). Each contains its own `pages/`,
  `components/`, `services/` (API calls), and occasionally `store/`, `utils/`.
- **`components/ui`** — small reusable primitives shared across features (`Avatar`, `Modal`).
- **`components/layout`** — app chrome (`Sidebar`, `DashboardLayout`).
- **`components/shared`** — cross-cutting UI (`ToastContainer`, `ErrorBoundary`, `RouteLoader`,
  `AnimatedBackground`).
- **`store/`** — app-wide Zustand stores (`authStore`, `toastStore`). Feature-local stores
  (e.g. `chatsStore`, `scheduledTasksStore`) live inside their feature folder.
- **`hooks/`** — cross-feature hooks (`useSocket`, `useSocketContext`, `useDragReorder`).
- **`routes/AppRouter.jsx`** — all dashboard pages are `React.lazy()`-loaded and wrapped in a
  single `<Suspense>` with `RouteLoader` as fallback, so the initial bundle only ships what the
  login screen needs.
- **`components/shared/ErrorBoundary.jsx`** wraps the whole app in `App.jsx` — a render error
  in one page shows a recovery screen instead of a blank white page.

No component calls `fetch`/`axios` directly — every network call goes through a `services/*.js`
file, which is what the tests and any future API changes target.

## Testing

```bash
cd client && npm run test
```

Currently covers the pure, high-value logic that's cheapest to keep correct over time: date
formatting, avatar initials/color hashing, the auth store's login/logout persistence, the chats
feature's API-response mappers, and the `Avatar` component's render branches. This is a
starting point, not exhaustive coverage — Chats/Settings/Contacts page-level integration tests
and Playwright e2e flows are natural next additions once there's a real (non-mocked) backend
environment available to test against.

## Environment variables (server/.env)

See `server/.env.example` for the full list — the essentials are: `DB_SERVER`, `DB_NAME`,
`DB_USER`, `DB_PASSWORD` (SQL Server), `JWT_SECRET`, `WHATSAPP_VERIFY_TOKEN` (webhook
verification), and `RESEND_API_KEY` (agent invite emails). Never commit a filled-in `.env`.

## Known scope boundaries

A few original features intentionally weren't ported because the backend has no endpoint for
them yet: device management, contact merging, and "previous conversations" in the chat customer
panel. They're not stubbed with fake data — the UI simply omits them until the API exists.
