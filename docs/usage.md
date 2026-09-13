# Using Notched

Connection setup, permissions, controls, and async questions.

## Connect to T3 Code

### Automatic connection on macOS

1. Start T3 Code.
2. Expand Notched and open connection settings.
3. Select **Remember securely** if you want to keep the connection after quitting.
4. Select **Connect local T3**.

Automatic connection checks `/Applications/T3 Code (Nightly).app` first, then
`/Applications/T3 Code (Alpha).app`. It reads the runtime address from
`~/.t3/userdata/server-runtime.json`. T3 can already be running when Notched starts.
For a different installation, use a pairing code.

### Connect with a pairing code

Use the pairing CLI from your T3 installation. If it is available as `t3`, run:

```sh
t3 auth pairing create --base-dir /path/to/t3-home --ttl 5m --label "T3 Code Notched" --json
```

Replace `/path/to/t3-home` with your running T3 environment's base directory.
Then expand **Use a pairing code** in Notched:

1. Enter your T3 server's local HTTP address in **T3 address**.
2. Copy the returned `credential` into **Pairing code**.
3. Select **Connect with code** before the code expires.

Only local loopback HTTP addresses are accepted. Notched does not start a T3
server for you.

### Connection and data storage

By default, Notched requests `orchestration:read` and `orchestration:operate`,
which grants broader T3 operation access. Turn off **Allow question answers**
before connecting to request read-only access.
Notched exposes only async question answers through this access. Both scopes
cover the connected T3 environment, rather than one project.

Connection tokens stay in memory unless you select **Remember securely**.
Saved tokens use Electron's secure storage; an unprotected storage backend is
refused. **Disconnect** removes the saved token. To revoke server access, revoke
the Notched session in T3.

Notched does not save replies to disk. It does save interface preferences and
panel placement. If the connection becomes stale, it hides reply text and
disables actions that need a live connection.

## Settings and controls

Settings include a color theme, an auto-collapse delay, and **Show provider
usage**, which is off by default. Usage shows the remaining allowance reported
by T3, not a cost estimate. Providers without usable usage data are hidden.
You can choose which reported limits appear in each panel mode.

| Shortcut                                            | Action                      |
| --------------------------------------------------- | --------------------------- |
| `Cmd/Ctrl + Shift + Space`                          | Show or hide the panel      |
| `Esc`                                               | Collapse the panel          |
| `Cmd/Ctrl + 1`–`9`                                  | Select thread 1–9           |
| Arrow keys, with the expand/collapse button focused | Choose a screen edge        |
| `Shift + Arrow`, with the same button focused       | Move along the current edge |

## Limits

- Replies refresh by polling; text does not stream token by token.
- Reply reads cover the latest two turns. Use T3 for the full conversation.
- Large thread lists take longer to refresh because background reads are limited.
- Reply links are inactive. Remote images and raw HTML are not rendered.
- Prompts, approvals, interrupt, and steer controls stay in T3 Code.

## Async questions

Read and answer questions while the agent continues working. This feature targets
T3 Code Nightly `v0.0.41-nightly.20260913.1625` and compatible builds. It uses T3's
async question contract, without a model-name restriction.

1. **Allow question answers** is enabled by default for new connections. Select
   **Connect local T3** or **Reconnect local T3**. The setting stays visible while
   connected. Existing saved read-only connections need the setting enabled and a reconnect. You can also open settings from a question's **Reconnect to enable sending** button.
2. A new async question opens the notch and selects its thread. The question
   stays open without an idle timeout. You can still collapse the panel manually;
   the same question will not repeatedly open it.
3. Click an option or press **1–9** while Notched has focus. You can also type
   your own answer in the text box. Number keys select options without sending;
   they work normally while you type. Use **Next** for additional questions. Complete each question, then
   select **Submit** or press **Enter**. Use **Shift+Enter** for a new line. The panel collapses when T3 accepts the answer.

You can select or type a draft with a read-only connection, but sending is disabled.
Selecting the permission checkbox does not change existing access: reconnect to apply it.
Answers go through T3's normal message path and can affect ongoing work or resume
an idle agent. Acceptance by T3 does not confirm that the agent has processed the
answer. If the result is uncertain, check T3; Notched blocks repeat sends for that
question for the rest of the app session, including after reconnection.

The first version supports text and single-choice async questions. Blocking
questions, attachments, and question dismissal stay in T3. Draft answers remain
in memory while switching threads or collapsing the panel; quitting clears them.
The browser demo includes a sample question and sends nothing to T3.

[Back to the README](../README.md).
