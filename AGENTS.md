# Prototype Instructions

Run the local server yourself and open the preview in the in-app browser. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Authentication decisions: Enterprise WeChat is the only supported login method. Every client route except `/login`, including the 404 route, must require a persisted Enterprise WeChat user identity. Keep the detailed Enterprise WeChat user in the Zustand auth store and initiate OAuth automatically when the app is opened inside Enterprise WeChat.

Authentication flow decisions: centralize Enterprise WeChat user-agent detection in `client/src/utils/wecom.js`. When an unauthenticated user opens the app inside Enterprise WeChat, start OAuth automatically and render `LoginFailed.jsx` through the public `/login?status=failed` state if automatic login fails. Outside Enterprise WeChat, unauthenticated users remain on the standard `/login` QR-code flow.

Navigation decisions: the protected workbench uses `/recorder`, `/records`, and `/detail` for the recorder, recording list, and recording detail views. Preserve the selected recording in the detail route query string. The records header exposes the current Enterprise WeChat user through a compact avatar menu with logout.

Routing implementation decisions: `App` is the protected workbench layout and renders child routes with React Router's `Outlet`. Route declarations render dedicated page-level components directly (`/recorder` → `Recorder`, `/records` → `Records`, `/detail` → `Detail`). Do not pass route-name strings into `App`, conditionally render route pages in `App`, or move page-only properties and methods into `App` or a broad context. Keep page-specific state and behavior in the owning route component; only layout behavior genuinely used by `App` belongs there.

Router ownership decisions: `client/src/AppRouter.jsx` owns `BrowserRouter`, route guards, redirects, and all route declarations. Keep `client/src/main.jsx` as the application bootstrap only, and do not move the global router provider into the workbench layout `App`.

Shared constant decisions: keep cross-route persistence keys and storage identifiers in `client/src/constant.js` and import them explicitly after moving code between route components. Page-only tuning values may remain in their owning module.

Database startup decisions: `docker-entrypoint.sh` selects the Prisma schema strategy with `PRISMA_SCHEMA_MODE`. Use `push` for development schema synchronization and `migrate` for checked-in production migrations; missing or unknown values must fall back to `prisma migrate deploy`, never to a destructive push option.

Records menu decisions: the avatar dropdown uses a compact, content-driven width with mobile viewport bounds instead of a fixed width, and its icon-only action buttons center their icons.

Visual direction: login and not-found screens follow the recording-list reference style—cool gray-blue atmospheric background, oversized heavy black display type, translucent white cards with generous radii, near-black primary actions, coral secondary accents, circular outline-icon controls, and soft low-contrast shadows.
