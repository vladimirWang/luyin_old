# Prototype Instructions

Run the local server yourself and open the preview in the in-app browser. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Authentication decisions: Enterprise WeChat is the only supported login method. Every client route except `/login`, including the 404 route, must require a persisted Enterprise WeChat user identity. Keep the detailed Enterprise WeChat user in the Zustand auth store and initiate OAuth automatically when the app is opened inside Enterprise WeChat.

Authentication flow decisions: centralize Enterprise WeChat user-agent detection in `client/src/utils/wecom.js`. When an unauthenticated user opens the app inside Enterprise WeChat, start OAuth automatically and render `LoginFailed.jsx` through the public `/login?status=failed` state if automatic login fails. Outside Enterprise WeChat, unauthenticated users remain on the standard `/login` QR-code flow.

Navigation decisions: the protected workbench uses `/recorder`, `/records`, and `/detail` for the recorder, recording list, and recording detail views. Preserve the selected recording in the detail route query string. The records header exposes the current Enterprise WeChat user through a compact avatar menu with logout.

Record preview routing decisions: drive `RecordPreviewOverlay` from the dynamic `/records/:recordingId` route. Opening a recording card navigates to that route, while closing the overlay returns through router history; do not use component-local expanded-recording state as the source of truth.

Routing implementation decisions: `App` is the protected workbench layout and renders child routes with React Router's `Outlet`. Route declarations render dedicated page-level components directly (`/recorder` → `Recorder`, `/records` → `Records`, `/detail` → `Detail`). Do not pass route-name strings into `App`, conditionally render route pages in `App`, or move page-only properties and methods into `App` or a broad context. Keep page-specific state and behavior in the owning route component; only layout behavior genuinely used by `App` belongs there.

Router ownership decisions: `client/src/AppRouter.jsx` owns `BrowserRouter`, route guards, redirects, and all route declarations. Keep `client/src/main.jsx` as the application bootstrap only, and do not move the global router provider into the workbench layout `App`.

Shared constant decisions: keep cross-route persistence keys and storage identifiers in `client/src/constant.js` and import them explicitly after moving code between route components. Page-only tuning values may remain in their owning module.

Database startup decisions: `docker-entrypoint.sh` selects the Prisma schema strategy with `PRISMA_SCHEMA_MODE`. Use `push` for development schema synchronization and `migrate` for checked-in production migrations; missing or unknown values must fall back to `prisma migrate deploy`, never to a destructive push option.

Recording persistence decisions: Prisma is the only data-access implementation for `Recording` and `TranscriptSegment` reads, creates, updates, soft deletes, restores, and permanent deletes. Legacy aggregate helpers may remain temporarily for non-recording entities, but they must delegate recording persistence to the Prisma repository and must never issue raw `SELECT`, `DELETE`, or `INSERT` statements against `recordings` or `transcript_segments`.

Database access decisions: prefer Prisma for all new or reworked database reads and writes. Do not introduce new raw SQL when Prisma can express the operation; when touching legacy raw-SQL persistence, migrate the in-scope operation to Prisma where practical.

Test deployment decisions: `py_server` is intentionally disabled because the current application flow does not use it. `start_test.sh` must not build, start, wait for, or report `py_server`, and must not remove or otherwise manage stale Compose orphan containers.

Records menu decisions: the avatar dropdown uses a compact, content-driven width with mobile viewport bounds instead of a fixed width, and its icon-only action buttons center their icons.

Detail component decisions: `client/src/pages/Detail/Detail.jsx` is the route-level owner and page orchestrator; do not reintroduce a broad `DetailView` wrapper. Split cohesive visual regions and message/composer parts into `client/src/pages/Detail/components`, and keep route loading in focused hooks under `client/src/pages/Detail/hooks`. Keep the chat-history panel as a controlled component: its owner controls visibility through `open` and `onClose`, while panel-only state such as the history/favorites tab remains inside the panel.

Server router dependency decisions: functions needed by server routes should be imported directly from focused utility modules whenever practical. Do not pass importable utility functions through router `configure()` dependency objects; reserve configuration injection for behavior that genuinely belongs to the application composition root or would otherwise create circular dependencies.

Tencent Meeting webhook payload decisions: handle the canonical `payload.event` and `item.token_info` fields only; do not add aliases for alternative event or token-info field names. Keep `TENCENT_MEETING_SOURCE_PREFIX` equal to `"tencent-meeting"` without the colon, and add or skip the separator explicitly where a full source key is built or parsed.

Tencent Meeting transcript sync decisions: automatically query `/v1/records/transcripts/details` for the canonical `smart.transcripts` webhook event and for the recorder-specific canonical `recording.audio-completed` event. Recorder completion performs an immediate attempt followed by a bounded retry window because recorder transcripts do not emit `smart.transcripts`, and it may fall back to TXT transcript files exposed by the single-recording detail response. Do not poll transcript details from `recording.completed`, audio-download completion, cloud discovery, or pending-import sweeps, and do not fall back to per-paragraph detail fan-out.

Tencent Meeting webhook routing decisions: expose `/api/tencentMeeting/webhook` as the canonical callback and dispatch only by canonical `payload.event`. Persist callback payloads and processing status with Prisma. `recording.started` only provides persisted recorder-owner context, `recording.completed` imports cloud-recording metadata and queues audio, `recording.audio-completed` imports each canonical `record_file_id` and queues its audio download, `smart.transcripts` alone queues transcript synchronization, and `common.sts-token` only stores the Redis token before resuming pending audio imports.

Tencent Meeting STS token decisions: Redis is the only persistence store for STS token data; do not persist tokens in local files or use a process-local token fallback. Run the token validity check from `server/cron/tencentMeeting.js` immediately at startup and every five minutes, and use a Redis distributed request lock so multiple application instances do not submit duplicate token requests. Persist canonical `token_info` fields from the `common.sts-token` webhook with a Redis TTL derived from `expire_ts`.

Recording ownership decisions: `ownerName` is an immutable producer-name snapshot, not a client-editable label. Manual uploads must derive `userId`, `ownerClientId`, and `ownerName` from a server-signed Enterprise WeChat identity obtained during OAuth; never trust name or user-ID request headers for ownership. Tencent Meeting imports use the creator/owner display name returned by Tencent Meeting and may resolve a missing name from the verified Enterprise WeChat directory using the creator userid. Because recorder `recording.audio-completed` callbacks omit identity, correlate them with the nearest preceding `recording.started` context from the persisted webhook history and only replace an empty or generic Tencent recorder owner name. One started context may apply to multiple subsequent audio-completed files until a newer started event arrives or the context expires.

Visual direction: login and not-found screens follow the recording-list reference style—cool gray-blue atmospheric background, oversized heavy black display type, translucent white cards with generous radii, near-black primary actions, coral secondary accents, circular outline-icon controls, and soft low-contrast shadows.
