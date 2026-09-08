# T3 Code Notched

A compact desktop monitor for an existing T3 Code environment. It shows active
threads, progress, requests, and recent agent replies in a panel at the screen edge.
T3 Code owns agent execution and controls. Quitting Notched leaves that work running.

This repository is a work in progress, not a release. Native behavior has been
tested on macOS. Windows and Linux still need native testing.

## Development

Requires Node 24.13.1+ and pnpm 11.19.0. macOS builds also require Xcode Command
Line Tools to compile the display-geometry helper.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

| Command             | Purpose                                                     |
| ------------------- | ----------------------------------------------------------- |
| `pnpm demo`         | Browser preview with marked fixture data; no live T3 access |
| `pnpm check`        | Type checks, tests, and production build                    |
| `pnpm format:check` | Formatting check                                            |
| `pnpm build`        | Build the desktop app                                       |
| `pnpm start`        | Open the production build                                   |
| `pnpm dist`         | Create local packages for the build host                    |

## Connect

Open T3 Code, expand the panel, and choose **Connect local T3**. Automatic pairing
supports the standard macOS installation. For other platforms or a custom
installation, create a pairing credential with T3's CLI:

```sh
t3 auth pairing create --base-dir /path/to/t3-home --ttl 5m --label "T3 Code Notched" --json
```

Enter the local HTTP origin and returned `credential` under **Use a pairing code**.
Do not share the credential. Notched requests `orchestration:read`; access applies
to the environment, not one project.

Notched checks API responses and access permissions without requiring a fixed T3
version. An incompatible API can still prevent connection. Stale connections
disable actions and hide reply text.

Tokens stay in memory unless **Remember securely** is selected. Saved tokens use
Electron safeStorage; Linux's unprotected `basic_text` backend is refused.
Disconnect removes the saved token. Revoke the Notched session in T3 to revoke
server access.

## Use

- Click the header to expand or collapse. Drag it to a screen edge or corner.
- Use **Command/Ctrl + Shift + Space** to show or hide the panel; Escape collapses it.
- Use the numbered buttons, **Previous/Next**, or **Command/Ctrl + 1–9** to switch threads.
- With a header button focused, arrow keys select an edge; Shift+arrow moves along it.
- **Open T3 Code** opens or focuses the desktop app. Select the chat in T3.
- Settings control the local color theme and auto-collapse delay.

Recent agent replies refresh automatically. Changed replies and newly settled
threads can show brief notifications while the panel is collapsed. Hover or focus
pauses a notification; its dismiss button closes it. Existing replies are not
replayed as notifications when connecting.

Reply reads cover the latest two turns. The selected thread and two active threads
refresh per cycle; large queues take longer to cycle through. Replies render
Markdown without active links, remote images, or raw HTML. They are not saved to
disk. Use T3 for full history, approvals, settlement, and all agent controls.

## Validation

Tests cover connection validation, read-only access, environment binding,
cancellation, bounded replies, status mapping, placement, and notifications.
The GitHub workflow runs checks on macOS, Windows, and Linux; it does not publish
packages or releases. CI success does not prove native behavior on each OS.

For macOS full-screen placement, run `swift scripts/check-macos-space.swift Electron`
while another app is full screen. For the motion check, close the development app
and start an isolated, disconnected instance:

```sh
pnpm dev --user-data-dir=/tmp/notched-motion-check --remote-debugging-port=9234
# In another terminal:
node scripts/check-macos-motion.mjs
```

Keep local captures and investigation notes in `.local/`, which Git ignores.
See [architecture](docs/architecture.md) for module boundaries and known limits.
