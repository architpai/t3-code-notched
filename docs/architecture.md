# Architecture

Notched is a read-only desktop surface for one local T3 Code environment. It does
not start servers or providers, send prompts, approve requests, or settle threads.

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
credentials. Pairing requests only `orchestration:read`. Saved tokens are bound to
the environment ID, which is checked before sending the token.

The renderer is sandboxed, uses context isolation, and has no Node access.
Main validates IPC inputs and checks the sender frame. Tokens stay in main;
secure storage refuses an unprotected backend. Navigation, new windows, and
permission requests are blocked.

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
display, ignores gaps between displays, and snaps to an edge or corner on release.
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
