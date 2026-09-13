# T3 Code Notched

Notched is a compact Electron client for an existing local T3 Code environment.
T3 owns providers, projects, threads, approvals, and execution. Notched displays
status and replies, handles desktop placement, and sends supported async answers.

## What matters

- Keep the panel fast and quiet. Bound reply reads, avoid continuous animation,
  and do not fetch full transcripts to update a status indicator.
- Keep T3 in control. Do not add provider credentials, provider processes, or
  direct database access to Notched.
- Prefer the smallest correct change. Read the callers before changing a
  contract; reuse existing helpers and native controls before adding machinery.
- Support compatible T3 APIs, not model names or release channels. Stable and
  Nightly builds can differ in capability. Do not claim support from a version
  string alone, or require a React integration for each new provider.

## Terms and boundaries

- **Environment:** one local T3 server and the state it owns.
- **Project:** a workspace registered in that environment.
- **Thread:** a conversation and its work history.
- **Provider:** the agent runtime managed by T3.
- **Async question:** a request that can remain pending while the agent works.
- **Accepted answer:** T3 accepted the command; this does not prove the agent
  processed it successfully.

The data path is React → typed preload methods → Electron main → local T3 HTTP.
Validate network responses and IPC inputs before use. Keep strict TypeScript:
no `any`, unchecked casts, arbitrary IPC channels, or provider logic in React.
Credentials stay in main; only protected Electron storage may persist them.

## Start here

Read `README.md` for setup, `docs/usage.md` for user behavior, and
`docs/architecture.md` for API references and constraints.

- `src/shared/`: wire schemas, question validation, usage, and placement rules.
- `src/main/`: T3 access, local pairing, credentials, lifecycle, and IPC checks.
- `src/preload/`: the narrow bridge exposed to the renderer.
- `src/renderer/`: panel UI, replies, question drafts, and preferences.
- `src/native/Notch.swift`: macOS screen-cutout geometry.
- `tests/`: behavior checks. `scripts/`: development, builds, and installation.

## Development

Use Node 24 (24.13.1 or later) and pnpm 11.19.0.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` runs Electron. `pnpm demo` runs a browser sample and cannot prove
native placement, local pairing, or real T3 access. Both use port 5178; do not
start them together or stop another process to free the port.

`pnpm install:mac` installs the app and enables installation after later builds.
When `.local/install-macos` exists, `pnpm check` also updates `/Applications`.
A build does not update a running Electron process. After changes, verify the
actual app version being tested; restart your task's app when needed.

## Protect the active session

The developer may be using T3 to direct this work.

- Never start a test server against `~/.t3/userdata`, edit its live database,
  read desktop cookies, or copy provider credentials.
- Use a separate T3 base directory and Electron user-data directory for tests.
  Prefer sample data. Real agent test threads need an approved disposable project.
- Stop only processes started by this task, using their captured handles.
  Never kill processes by a name or path pattern.
- Never put secrets in logs, URLs, screenshots, renderer state, git, or reports.
- Quitting Notched must leave T3 and its agent work running.

## Check the complete behavior

Follow a change through schemas, main, preload, renderer, and relevant callers.
Check local and manual pairing, reconnects, stale data, and saved credentials
when changing connection behavior. A stale connection must block live actions.

For questions, check arrival, draft selection, custom text, keyboard input,
submission, failure, and resolution. Keep agent text before the question and
Submit outside scrolling content. Enter submits; Shift+Enter inserts a line.
Preserve text composition and avoid taking number keys from text fields.

Question answers are enabled for new connections by default. Saved read-only
connections stay read-only until reconnected with answer access. Validate the
pending request again before dispatch. Never resend an uncertain answer.
Do not expose exact-run interrupt or steer until T3 preserves the requested run
identity through its command contract.

## Verification

Run the smallest useful behavior check while working, then `pnpm check` before
handoff. Use existing tests for regressions; test outcomes rather than source
layout, component attributes, or callback wiring.

For UI changes, run `pnpm dev` and check the native app through computer use
when authorized. Test the affected interaction, not only its browser preview.
Use visible focus, accessible labels, icons rather than emoji, and reduced motion.
Report which operating systems were actually tested. Build targets and CI jobs
do not prove native behavior on other platforms.

## Documentation and handoff

Keep the README short. Put task instructions in `docs/usage.md` and durable
boundary decisions in `docs/architecture.md`. Update incorrect guidance in place;
do not append a work log or duplicate details already clear in code.

README screenshots must show the native macOS app with sample data and an
accurate caption. Keep temporary captures and investigation files out of git.
Only commit images that serve the published documentation.

Describe what changed, how it was checked, and remaining limits. Do not commit,
push, or open a pull request unless requested. If asked for a PR, describe the
problem and resulting behavior, include relevant validation, and attach native
UI evidence when the change is visual.

`CLAUDE.md` imports this file. Keep shared instructions here so both entry points
stay consistent.
