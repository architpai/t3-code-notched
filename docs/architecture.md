# Architecture

Notched is a desktop surface for one local T3 Code environment. New connections enable async question answers by default using T3 operation access.
Users can disable answers before connecting for read-only access. It
does not start servers or providers, send new prompts, approve requests, or settle
threads.

```text
React UI -> typed preload methods -> Electron main -> local T3 HTTP API
                                    |-> OS placement and safeStorage
```

## Modules

- `src/shared/contracts.ts`: API schemas, view state, bridge types, and status rules.
- `src/shared/placement.ts`: pure edge, corner, and display geometry.
- `src/main/client.ts`: authentication, polling, connection freshness, and reply reads.
- `src/main/local-pairing.ts`: runtime discovery and the installed T3 pairing CLI.
- `src/main/credentials.ts`: encrypted local token storage.
- `src/main/index.ts`: Electron lifecycle, IPC authorization, and native placement.
- `src/renderer/`: presentation, reply notifications, and inactivity handling.
- `src/native/Notch.swift`: macOS camera-cutout geometry.

## T3 boundary

The initial API implementation was checked against T3 v0.0.38, commit
`c0995d2eaf8ec787b3318ed1169ae266ed1529f8`. This is a source reference, not a
version restriction. A read-only connection to T3 0.0.40 was also verified.

Notched validates the API subset it uses with Zod. Additional object fields are
ignored; invalid required fields reject the response. New releases are accepted
when their responses remain compatible. No private T3 workspace package is used
as a public SDK.

Relevant upstream sources at the initial baseline:

- [HTTP environment API](https://github.com/pingdotgg/t3code/tree/c0995d2eaf8ec787b3318ed1169ae266ed1529f8/apps/server/src)
- [Orchestration contracts](https://github.com/pingdotgg/t3code/blob/c0995d2eaf8ec787b3318ed1169ae266ed1529f8/packages/contracts/src/orchestration.ts)
- [Desktop integration](https://github.com/pingdotgg/t3code/tree/c0995d2eaf8ec787b3318ed1169ae266ed1529f8/apps/desktop/src)

Only loopback HTTP origins are accepted. Local pairing reads T3's runtime origin
and invokes its pairing CLI. It does not read desktop cookies or provider
credentials. Pairing requests `orchestration:read` and optionally `orchestration:operate` when
the user enables question answers. Saved tokens are bound to
the environment ID, which is checked before sending the token.

The renderer is sandboxed, uses context isolation, and has no Node access.
Main validates IPC inputs and checks the sender frame. Tokens stay in main;
secure storage refuses an unprotected backend. Navigation, new windows, and
permission requests are blocked.

## Optional provider usage

Notched targets T3 Code Nightly. The usage contract was checked against upstream
commit `08463e2c401ce87858aaaebcb70ed86fb002fb5f` (`providerUsageLimits.ts`,
`server.ts`, `rpc.ts`, and `ws.ts`). Usage reads call `server.getConfig` through
T3's Effect JSON RPC at `/ws`, with the existing `orchestration:read` bearer token
in the upgrade header. A short-lived socket reads the configuration and closes.
Only validated provider names, instance IDs, limits, and observation times reach
React. Provider auth data and other configuration fields are discarded.

Provider icons and allowances occupy a separate extension to the right of the
status orbs. The original header stays aligned with the camera cutout. Disabled
or uninstalled providers and providers without usable limits are excluded.
Collapsed mode prefers a five-hour window, then weekly. Expanded mode shows both
windows vertically. Per-environment preferences can select any reported window
independently for collapsed and expanded mode. Empty selections hide a provider;
missing selections retain the automatic defaults. Preferences use validated local
storage. Large provider lists scroll within a bounded extension.

Usage is off by default. When enabled, it reads at most once per minute; concurrent
reads share one request. Responses have an 8 MiB limit and a 10-second timeout.
Disconnect cancels reads. Failed usage reads show no allowance and do not disable
the thread monitor; stale shell connections hide the usage display. T3 owns the
provider probes. Notched does not read provider files or request probes itself.

## Polling and replies

Shell polling runs every 1.5 seconds during work and every 4 seconds otherwise.
A failed poll marks cached shell data stale and disables actions. Disconnect
cancels requests; generation checks discard late responses.

Replies use `GET /api/orchestration/threads/:threadId?turnLimit=2`. Main requires
page metadata and a matching thread ID, then selects the newest assistant message.
Every HTTP response has an 8 MiB limit. There is no history pagination or disk cache.

Each renderer cycle reads the selected thread and two active threads. Background
reads rotate through the active list, including while collapsed. This limits
concurrent reads to three but adds latency for large queues. Failed reads retain
the previous baseline. Reconnection resets it.

A changed reply shows one notification for 5–10 seconds. Settlement notifications
compare consecutive live shell snapshots and last six seconds. Initial connection,
reconnection, deletion, and archival do not replay settlement notifications.
Markdown permits no raw HTML, remote images, or active links.

## Desktop behavior

The panel stores display ID, edge, corner, and normalized offset in `placement.json`.
Drag inputs use validated screen coordinates. Placement stays inside a current
display, ignores gaps between displays, and snaps to an edge or corner on release using the panel bounds, not the grab
point. Collapsed corners stack the brand, status, and provider usage vertically.
Display changes and lost pointer input end dragging.

On macOS, the native helper reads NSScreen safe-area and auxiliary geometry at
launch and display changes. Electron uses full display bounds and
`enableLargerThanScreen` to place the panel at the physical camera cutout.
The window joins desktop Spaces and full-screen apps.

Native resizing and short CSS transitions respect reduced-motion settings.
Renderer resize requests are serialized and superseded heights are dropped.
Content keeps its final width during native expansion. Hidden replies stop
rendering after the closing transition.

Opening a thread focuses the T3 desktop app through its fixed bundle ID or
registered scheme. It does not claim to select that chat inside T3.

## Limits

Native Windows/Linux placement, secure storage, signing, and installers need
verification. Wayland can restrict placement and global shortcuts. Polling is not
token streaming, and short motion checks do not establish long-term power use or
frame rate. Add capabilities only when their T3 contracts and lifecycle behavior
are understood and tested.

## Async question answers

The contract was checked against T3 Nightly `v0.0.41-nightly.20260913.1625`
and source commit `c29976458a7dbbb61c83b3d06ea894869b718607`.
`src/shared/questions.ts` validates `user-input.requested` activities with
`responseMode: "message"`. Other question modes remain in T3. The existing
`turnLimit=2` detail read includes pending activities pinned by T3; no history
pagination or extra background transcript reads are added.

The renderer receives only validated question fields and submission status.
Resolved or failed requests disappear on refresh. Failed reads hide question
controls. Drafts remain in renderer memory and are not stored on disk.

New pending request identities select their thread and expand the panel once.
A pending question suspends the idle timer and takes priority over reply or
settlement notifications. The current question is not replaced while being
answered; other questions wait. Manual collapse acknowledges the current pending
identities locally, without dismissing them in T3. Settings remain accessible
while connected, with explicit reconnection to apply a permission change.
Read-only connections permit local drafts but cannot submit. The form shows one
question at a time. Options and the custom answer share the panel scroll area. Plain
1–9 keys select options only while the question is visible and focus is not in
an editable field; selection never submits. Enter submits; Shift+Enter adds a
line, and IME composition is preserved. Agent text precedes the form. Submit
sits outside the scrolling content so it remains visible. Question panels grow
to their content, up to 600 pixels and within the screen bounds; ordinary
thread panels keep their compact height limit.

`notched:answer-question` accepts only a thread ID, request ID, and bounded text
answers. Main checks the live connection, the answer permission, server-granted scope,
and thread membership. It re-reads the pending question and validates every
answer before POSTing `thread.user-input.respond` to `/api/orchestration/dispatch`.
T3 owns the answer-to-message conversion; this is not an exact-run steer API.
It can steer current work or resume an idle session.

A per-environment/request submission guard prevents concurrent sends and retries
within the app session, including reconnection. A lost or invalid response remains
uncertain; no automatic retry is made. The guard stores no answer text and is
limited to 1000 submissions per app session. Restarting clears it, so uncertain
answers must be checked in T3 before another manual attempt. A valid dispatch
sequence confirms acceptance only, not provider success.

The saved credential includes the answer permission. Older saved credentials retain
read-only behavior even if their server token has operation scope. Operation
scope itself is broader than question answers; the main/preload boundary exposes
only this narrow response operation.
