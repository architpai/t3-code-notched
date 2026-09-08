# T3 Code Notched

A compact Electron client for an existing T3 Code environment. T3 owns providers,
projects, threads, approvals, and execution. Notched owns the desktop surface.

## Start here

- `README.md`: run commands and supported behavior.
- `docs/architecture.md`: boundaries, upstream references, and deliberate limits.
- `src/shared/contracts.ts`: wire validation and renderer state.
- `src/main/client.ts`: T3 access and freshness.
- `src/main/index.ts`: Electron lifecycle and IPC authorization.
- `src/renderer/main.tsx`: compact/expanded UI; no credentials or provider code.

## Work loop

Use Node 24 and `pnpm install --frozen-lockfile`. Run `pnpm check` before handoff.
For UI changes run `pnpm dev` and use computer use when authorized. `pnpm demo`
is a browser preview with explicitly marked fixture data; it cannot verify live access.
Tests are in `tests/`. Add tests for behavior, not implementation shape.

Keep strict TypeScript. Validate network and IPC data before use. Do not use `any`,
unchecked type casts, arbitrary IPC, or provider-specific logic in React.
Prefer pure functions and narrow modules. Use one package until another client
needs shared code. Read callers before changing a contract.

Do not point a development T3 server at `~/.t3/userdata`, edit a live T3 database,
read desktop cookies, or copy provider credentials. Use a separate base directory
for isolated tests. Live test threads need a user-approved disposable project.
Stop only processes started by this task, using the captured process handle.
Never send secrets to logs, URLs, snapshots, renderer state, git, or reports.

Command acceptance is not provider success. Do not resend uncertain messages.
A stale connection must disable controls. Quitting must leave T3 work running.
Do not expose exact-run interrupt/steer until the upstream contract preserves the
requested run identity. New providers are data, not a new integration hierarchy.

Use visible focus, accessible labels, icons rather than emoji, and reduced-motion
support. Avoid continuous animation and bulk transcript reads. Report which OSes
were actually tested; a build target is not proof of cross-platform behavior.
