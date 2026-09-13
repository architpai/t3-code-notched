import {
  emptyState,
  type Bridge,
  type ViewState,
  type Thread,
} from "../shared/contracts";
import { moveDock, type Dock } from "../shared/placement";
const now = new Date().toISOString();
function thread(
  id: string,
  title: string,
  provider: string,
  model: string,
  state: "running" | "completed" | "attention",
): Thread {
  return {
    id,
    projectId: "demo-project",
    title,
    updatedAt: now,
    settledOverride: null,
    modelSelection: { instanceId: provider.toLowerCase(), model },
    runtimeMode: "approval-required",
    interactionMode: "default",
    latestTurn: {
      turnId: `turn-${id}`,
      state: state === "running" ? "running" : "completed",
      requestedAt: now,
      startedAt: now,
      completedAt: state === "running" ? null : now,
    },
    session: {
      status: state === "running" ? "running" : "ready",
      providerName: provider,
      lastError: null,
    },
    hasPendingApprovals: state === "attention",
    hasPendingUserInput: id === "layout",
  };
}
export function demoBridge(): Bridge {
  let dock: Dock = { edge: "top", offset: 0.5 };
  const listeners = new Set<(state: ViewState) => void>();
  let state: ViewState = {
    ...emptyState(),
    phase: "demo",
    canAnswerQuestions: true,
    environmentId: "demo",
    origin: null,
    checkedAt: now,
    shell: {
      snapshotSequence: 1,
      projects: [
        {
          id: "demo-project",
          title: "t3-code-notched",
          workspaceRoot: "/demo/t3-code-notched",
        },
      ],
      threads: [
        thread(
          "layout",
          "Refine the compact panel",
          "Codex",
          "gpt-6-astra",
          "running",
        ),
        thread(
          "keyboard",
          "Check keyboard navigation and full title wrapping in the compact notch",
          "Claude",
          "claude-sonnet",
          "attention",
        ),
        thread(
          "states",
          "Verify connection states",
          "OpenCode",
          "configured model",
          "completed",
        ),
      ],
    },
  };
  return {
    getState: async () => state,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    connect: async () => ({
      ok: false,
      message: "Open the desktop app to connect to T3.",
    }),
    connectLocal: async () => ({
      ok: false,
      message: "Open the desktop app to connect to T3.",
    }),
    disconnect: async () => {},
    usage: async () => ({
      providers: ["codex", "claude", "opencode"].map((driver) => ({
        instanceId: driver,
        driver,
        usageLimits: {
          checkedAt: now,
          windows: [
            {
              id: "session",
              label: "Session",
              kind: "session" as const,
              windowDurationMins: 300,
              usedPercent: 38,
              resetsAt: new Date(Date.now() + 7200000).toISOString(),
            },
            {
              id: "weekly",
              label: "Weekly",
              kind: "weekly" as const,
              windowDurationMins: 10080,
              usedPercent: 64,
              resetsAt: new Date(Date.now() + 172800000).toISOString(),
            },
          ],
        },
      })),
      error: null,
    }),
    answerQuestion: async (input) => {
      state = {
        ...state,
        shell: {
          ...state.shell,
          snapshotSequence: state.shell.snapshotSequence + 1,
          threads: state.shell.threads.map((t) =>
            t.id === input.threadId ? { ...t, hasPendingUserInput: false } : t,
          ),
        },
      };
      for (const listener of listeners) listener(state);
      return {
        ok: true,
        message: "Demo answer accepted. No agent was contacted.",
        retryable: false,
      };
    },
    lastMessage: async (threadId) => ({
      questions:
        threadId === "layout" &&
        state.shell.threads.find((t) => t.id === threadId)?.hasPendingUserInput
          ? [
              {
                requestId: "demo-question",
                responseMode: "message",
                questions: [
                  {
                    id: "0",
                    header: "Question",
                    question:
                      "Which theme should I use for the settings panel?",
                    options: [
                      {
                        label: "Match the system",
                        description: "Use the current desktop appearance.",
                      },
                      {
                        label: "Graphite",
                        description: "Keep the dark theme.",
                      },
                    ],
                    allowCustomAnswer: true,
                    multiSelect: false,
                  },
                ],
              },
            ]
          : [],
      text: '## Update\n\nThe compact panel is **ready**.\n\n- Replies support Markdown.\n- Use `Cmd+1` to switch threads.\n\n```ts\nconst view = "compact";\n```\n\n| Check | Result |\n| --- | --- |\n| Layout | Ready |\n| Keyboard | Ready |',
      error: null,
    }),
    movePanel: async (direction, nudge) => {
      dock = moveDock(
        { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
        dock,
        direction,
        nudge,
      );
      state = {
        ...state,
        edge: dock.edge,
        corner: dock.corner ?? null,
        contentWidth:
          Math.min(420, window.innerWidth) -
          (dock.edge === "left" || dock.edge === "right" ? 48 : 0) -
          2,
      };
      for (const listener of listeners) listener(state);
    },
    resize: async () => {},
    dragPanel: async () => {},
    openThread: async () => ({
      ok: false,
      message: "Demo data has no T3 chat.",
    }),
    quit: async () => {},
  };
}
