import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  Settings2,
  X,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import {
  emptyState,
  statusOf,
  canSettleThread,
  monitorThreads,
  monitorHeight,
  isDragMovement,
  type Bridge,
  type Result,
  type Thread,
  type MessagePreview,
  type DragInput,
} from "../shared/contracts";
import { MessageMarkdown } from "./MessageMarkdown";
import { demoBridge } from "./demo";
import { watchInactivity } from "./inactivity";
import { useReplies, countdownDelay } from "./replies";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/geist-mono/400.css";
import "./style.css";
declare global {
  interface Window {
    notched?: Bridge;
  }
}
const bridge = window.notched ?? demoBridge();
const demo = !window.notched;
const labels = {
  working: "Working",
  attention: "Needs you",
  failed: "Failed",
  completed: "Done",
  stopped: "Stopped",
  idle: "Idle",
};
function LastMessage({
  threadId,
  readable,
  preview,
  visible,
  active,
}: {
  threadId: string;
  readable: boolean;
  preview: MessagePreview | undefined;
  visible: Set<string>;
  active: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) {
      visible.delete(threadId);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) visible.add(threadId);
      else visible.delete(threadId);
    });
    if (element.current) observer.observe(element.current);
    return () => {
      observer.disconnect();
      visible.delete(threadId);
    };
  }, [threadId, visible, active]);
  return (
    <div
      ref={element}
      className="message-preview markdown-content"
      aria-label="Agent reply"
      tabIndex={0}
    >
      {!readable ? (
        "Reconnect to read the reply."
      ) : preview?.error ? (
        preview.error
      ) : preview?.text ? (
        <MessageMarkdown text={preview.text} />
      ) : (
        "Waiting for an agent reply…"
      )}
    </div>
  );
}

function App() {
  const dragHeader = useRef<HTMLElement>(null);
  const headerButton = useRef<HTMLButtonElement>(null);
  const didDrag = useRef(false);
  const dragPoint = useRef<DragInput | null>(null);
  const dragFrame = useRef(0);
  const dragPointer = useRef<number | null>(null);
  const sendDrag = (input: DragInput) => {
    void bridge
      .dragPanel(input)
      .catch(() => setNotice("Could not move the panel. Try the arrow keys."));
  };
  const endDrag = (phase: "end" | "cancel", point = dragPoint.current) => {
    cancelAnimationFrame(dragFrame.current);
    dragFrame.current = 0;
    if (didDrag.current && dragPoint.current && point)
      sendDrag({ ...point, phase });
    dragPoint.current = null;
    const pointer = dragPointer.current;
    dragPointer.current = null;
    if (pointer !== null && dragHeader.current?.hasPointerCapture(pointer))
      dragHeader.current.releasePointerCapture(pointer);
  };
  const restoreDragFocus = useRef(false);
  const [state, setState] = useState(emptyState());
  const [notificationHovered, setNotificationHovered] = useState(false);
  const [notificationFocused, setNotificationFocused] = useState(false);
  const readingNotification = notificationHovered || notificationFocused;
  const replies = useReplies(bridge, state, readingNotification);
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem("notched-theme");
      return saved &&
        ["graphite", "midnight", "forest", "light"].includes(saved)
        ? saved
        : "graphite";
    } catch {
      return "graphite";
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("notched-theme", theme);
    } catch {
      /* Storage can be unavailable. */
    }
  }, [theme]);
  const [idleSeconds, setIdleSeconds] = useState(() => {
    try {
      const saved = localStorage.getItem("notched-idle-seconds");
      const seconds = saved === null ? 30 : Number(saved);
      return [0, 15, 30, 60, 120, 300].includes(seconds) ? seconds : 30;
    } catch {
      return 30;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("notched-idle-seconds", String(idleSeconds));
    } catch {
      /* Storage can be unavailable. */
    }
  }, [idleSeconds]);
  const [expanded, setExpanded] = useState(demo);
  const [settings, setSettings] = useState(false);
  const [retainReply, setRetainReply] = useState(expanded);
  useEffect(() => {
    if (expanded) {
      setRetainReply(true);
      return;
    }
    // Keep the old reply only through the exit; hidden updates must not parse Markdown.
    const timer = setTimeout(() => setRetainReply(false), 200);
    return () => clearTimeout(timer);
  }, [expanded]);
  const [shortcutModifier, setShortcutModifier] = useState<"⌘" | "Ctrl" | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const runContent = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(260);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [origin, setOrigin] = useState("http://127.0.0.1:3773");
  const [pairingCode, setPairingCode] = useState("");
  const [remember, setRemember] = useState(false);
  const changeExpanded = (value: boolean) => {
    setExpanded(value);
    if (!value) setSettings(false);
    replies.dismissUpdates();
  };
  useEffect(() => {
    if (!expanded || pending || readingNotification) return;
    return watchInactivity(document, idleSeconds * 1000, () => {
      if (dragPoint.current) return;
      changeExpanded(false);
    });
  }, [expanded, pending, idleSeconds, readingNotification]);
  useEffect(() => {
    let disposed = false;
    const off = bridge.subscribe((value) => {
      if (!disposed) setState(value);
    });
    void bridge.getState().then((value) => {
      if (!disposed) setState(value);
    });
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        endDrag("cancel");
        changeExpanded(false);
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      disposed = true;
      endDrag("cancel");
      off();
      document.removeEventListener("keydown", key);
    };
  }, []);
  const queue = useMemo(
    () => monitorThreads(state.shell.threads),
    [state.shell.threads],
  );
  const visible = queue;
  const selected = visible.find((t) => t.id === selectedId) ?? visible[0];
  const selectedIndex = selected ? visible.indexOf(selected) : 0;
  useEffect(() => {
    if (selected) setSelectedId(selected.id);
  }, [selected?.id]);
  const selectThread = (index: number) => {
    const thread = visible[index];
    if (!thread) return;
    setSelectedId(thread.id);
    setSettings(false);
    changeExpanded(true);
  };
  useEffect(() => {
    const switchThread = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        !/^[1-9]$/.test(event.key)
      )
        return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input, select, textarea, [contenteditable=true]")
      )
        return;
      const index = Number(event.key) - 1;
      if (!visible[index]) return;
      event.preventDefault();
      selectThread(index);
    };
    document.addEventListener("keydown", switchThread);
    return () => document.removeEventListener("keydown", switchThread);
  }, [visible]);
  useEffect(() => {
    const modifiers = (event: KeyboardEvent) =>
      setShortcutModifier(event.metaKey ? "⌘" : event.ctrlKey ? "Ctrl" : null);
    const clear = () => setShortcutModifier(null);
    const hidden = () => {
      if (document.hidden) {
        setSettings(false);
        clear();
      }
    };
    document.addEventListener("keydown", modifiers);
    document.addEventListener("keyup", modifiers);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("blur", clear);
    return () => {
      document.removeEventListener("keydown", modifiers);
      document.removeEventListener("keyup", modifiers);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("blur", clear);
    };
  }, []);
  const activeLabel = `${queue.length} active`;
  const counts = (
    ["working", "attention", "failed", "stopped", "completed", "idle"] as const
  )
    .map((status) => ({
      status,
      count: queue.filter((thread) => statusOf(thread) === status).length,
    }))
    .filter(({ count }) => count > 0);
  const breakdown = counts
    .map(({ status, count }) => `${count} ${labels[status].toLowerCase()}`)
    .join(" · ");
  const stateOrbs = (
    <span className={`state-orbs ${counts.length > 3 ? "many" : ""}`}>
      {(counts.length ? counts : [{ status: "idle" as const, count: 0 }]).map(
        ({ status, count }) => (
          <span
            className={`state-orb ${status}`}
            key={`${status}:${count}`}
            role="img"
            aria-label={
              count
                ? `${count} ${labels[status].toLowerCase()} threads`
                : "No active threads"
            }
            title={
              count
                ? `${count} ${labels[status].toLowerCase()}`
                : "No active threads"
            }
          >
            {count > 99 ? "99+" : count}
          </span>
        ),
      )}
    </span>
  );
  const settlement = replies.settlements.find((t) =>
    state.shell.threads.some(
      (current) =>
        current.id === t.id &&
        current.settledOverride === "settled" &&
        canSettleThread(current),
    ),
  );
  const notificationClock = settlement
    ? replies.settlementClock
    : replies.updateClock;
  const countdownStyle = useMemo<React.CSSProperties | undefined>(
    () =>
      notificationClock
        ? {
            animationPlayState:
              notificationClock.pausedAt === undefined ? "running" : "paused",
            animationDuration: `${notificationClock.duration}ms`,
            animationDelay: `${countdownDelay(notificationClock, Date.now())}ms`,
          }
        : undefined,
    [notificationClock],
  );
  const notifications = replies.updates.slice(-1).flatMap((id) => {
    const thread = queue.find((t) => t.id === id);
    return thread && replies.previews[id]?.text ? [thread] : [];
  });
  const notifying =
    ((!expanded && notifications.length > 0) || Boolean(settlement)) &&
    ["live", "demo"].includes(state.phase);
  useEffect(() => {
    if (!notifying) {
      setNotificationHovered(false);
      setNotificationFocused(false);
    }
  }, [notifying]);
  const open = expanded || notifying;
  const summary =
    state.phase === "demo"
      ? `Demo data · ${activeLabel}`
      : state.phase === "live"
        ? activeLabel
        : state.phase === "connecting"
          ? "Connecting…"
          : state.phase === "stale"
            ? "Connection lost"
            : "Connect T3";
  const project = (thread: Thread) => {
    const p = state.shell.projects.find((p) => p.id === thread.projectId);
    return (
      p?.title ??
      p?.workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1) ??
      "Project"
    );
  };
  async function action(fn: () => Promise<Result>) {
    setPending(true);
    setNotice("");
    try {
      const result = await fn();
      if (!result.ok) setNotice(result.message);
      return result;
    } catch {
      setNotice("Change not confirmed. Check T3.");
    } finally {
      setPending(false);
    }
  }
  async function connect(local: boolean) {
    const result = await action(() =>
      local
        ? bridge.connectLocal(remember)
        : bridge.connect({ origin, pairingCode, remember }),
    );
    setPairingCode("");
    if (result?.ok) setSettings(false);
  }
  const showSettings =
    settings || state.phase === "disconnected" || state.phase === "connecting";
  useEffect(() => {
    if (!expanded || showSettings || notifying || !runContent.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setCardHeight(Math.ceil(entry.contentRect.height));
    });
    observer.observe(runContent.current);
    return () => observer.disconnect();
  }, [expanded, showSettings, notifying]);
  const limit = monitorHeight(
    expanded,
    showSettings,
    visible.length,
    Boolean(notice || state.error || state.phase === "stale"),
  );
  const height = notifying
    ? 210
    : expanded && !showSettings
      ? Math.min(
          limit,
          Math.max(
            150,
            cardHeight +
              Math.max(40, state.notch?.height ?? 40) +
              (notice || state.error || state.phase === "stale" ? 40 : 0) +
              2,
          ),
        )
      : limit;
  const resizeTask = useRef(Promise.resolve());
  useEffect(() => {
    let cancelled = false;
    // Animated AppKit resizing blocks its IPC reply. Skip superseded sizes instead of queuing animations.
    resizeTask.current = resizeTask.current
      .catch(() => {})
      .then(() => {
        if (!cancelled) return bridge.resize(height);
      });
    void resizeTask.current.catch(() =>
      setNotice("Could not resize the notch."),
    );
    return () => {
      cancelled = true;
    };
  }, [height]);
  useEffect(() => {
    if (restoreDragFocus.current) {
      headerButton.current?.focus();
      restoreDragFocus.current = false;
    }
  }, [state.edge, state.corner, state.notch]);
  const brand = (
    <span className="brand">
      <i
        key={state.phase}
        className={`signal ${state.phase}`}
        aria-label={`Connection ${state.phase}`}
      />
      <b className="mark">
        t3<span>n</span>
      </b>
    </span>
  );
  const moveDrag = (point: DragInput) => {
    if (!dragPoint.current) return;
    if (!didDrag.current) {
      if (!isDragMovement(dragPoint.current, point)) return;
      didDrag.current = true;
      sendDrag(dragPoint.current);
    }
    dragPoint.current = point;
  };
  const panelStyle: React.CSSProperties & { "--body-width": string } = {
    "--body-width": `${Math.max(1, state.contentWidth)}px`,
    ...(demo
      ? {
          height: Math.min(
            !open && state.corner
              ? 84
              : Math.max(
                  state.edge === "left" || state.edge === "right" ? 160 : 40,
                  height,
                ),
            window.innerHeight,
          ),
          width: open
            ? 420
            : state.corner
              ? 84
              : state.edge === "left" || state.edge === "right"
                ? 48
                : 360,
        }
      : {}),
  };
  return (
    <main
      className={`panel edge-${state.edge} ${state.corner ? `corner corner-${state.corner}` : ""} ${demo ? "demo-panel" : ""} ${open ? "expanded" : "compact"} ${state.notch ? "notched" : ""}`}
      style={panelStyle}
    >
      <header
        ref={dragHeader}
        className={state.notch ? "camera-header" : undefined}
        title="Click to expand or collapse · Drag to any screen edge · Arrows choose edge · Shift+arrow slides"
        style={
          state.notch
            ? {
                gridTemplateColumns: `1fr ${state.notch.width}px 1fr`,
                height: Math.max(40, state.notch.height),
                minHeight: Math.max(40, state.notch.height),
              }
            : undefined
        }
        onClickCapture={(event) => {
          if (didDrag.current && event.detail !== 0) {
            event.stopPropagation();
            event.preventDefault();
            didDrag.current = false;
          }
        }}
        onClick={() => changeExpanded(!expanded)}
        onPointerDown={(event) => {
          if (event.button !== 0 || dragPointer.current !== null) return;
          didDrag.current = false;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragPointer.current = event.pointerId;
          dragPoint.current = {
            phase: "start",
            x: Math.round(event.screenX),
            y: Math.round(event.screenY),
          };
        }}
        onPointerMove={(event) => {
          if (event.pointerId !== dragPointer.current || !dragPoint.current)
            return;
          moveDrag({
            phase: "move",
            x: Math.round(event.screenX),
            y: Math.round(event.screenY),
          });
          if (event.buttons === 0) {
            endDrag("end");
            return;
          }
          if (didDrag.current && !dragFrame.current)
            dragFrame.current = requestAnimationFrame(() => {
              dragFrame.current = 0;
              if (dragPoint.current) sendDrag(dragPoint.current);
            });
        }}
        onPointerUp={(event) => {
          if (event.pointerId !== dragPointer.current) return;
          const point: DragInput = {
            phase: "end",
            x: Math.round(event.screenX),
            y: Math.round(event.screenY),
          };
          moveDrag(point);
          endDrag("end", point);
        }}
        onPointerCancel={() => {
          endDrag("cancel");
        }}
        onLostPointerCapture={() => {
          endDrag("cancel");
        }}
        onKeyDown={(event) => {
          if (event.target instanceof Element && event.target.closest(".icon"))
            return;
          const direction =
            event.key === "ArrowUp"
              ? "top"
              : event.key === "ArrowDown"
                ? "bottom"
                : event.key === "ArrowLeft"
                  ? "left"
                  : event.key === "ArrowRight"
                    ? "right"
                    : null;
          if (direction) {
            event.preventDefault();
            restoreDragFocus.current = true;
            void bridge.movePanel(direction, event.shiftKey);
          }
        }}
      >
        {state.notch ? (
          <>
            <div className="camera-left">
              <button
                ref={headerButton}
                aria-label={expanded ? "Collapse panel" : "Expand panel"}
              >
                {brand}
              </button>
              {expanded && (
                <button
                  className="icon"
                  aria-label="Connection settings"
                  onPointerDown={(event) => {
                    didDrag.current = false;
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSettings(!settings);
                  }}
                >
                  <Settings2 size={13} />
                </button>
              )}
            </div>
            <span aria-hidden="true" />
            <button
              className="camera-status"
              aria-label={`${summary}. ${breakdown}. ${expanded ? "Collapse" : "Expand"}`}
              title={`${summary}. ${breakdown}`}
            >
              {["live", "demo"].includes(state.phase) ? (
                stateOrbs
              ) : (
                <span>
                  {state.phase === "stale"
                    ? "Offline"
                    : state.phase === "connecting"
                      ? "Linking"
                      : "Connect"}
                </span>
              )}
            </button>
          </>
        ) : (
          <>
            <button
              ref={headerButton}
              className="summary"
              aria-label={`${summary}. ${breakdown}. ${expanded ? "Collapse" : "Expand"} panel`}
              title={`${summary}. ${breakdown}`}
            >
              {brand}
              {!["live", "demo"].includes(state.phase) && (
                <span className="summary-text">{summary}</span>
              )}
            </button>
            {expanded && (
              <button
                className="icon"
                aria-label="Connection settings"
                onPointerDown={(event) => {
                  didDrag.current = false;
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  setSettings(!settings);
                }}
              >
                <Settings2 size={14} />
              </button>
            )}
            {["live", "demo"].includes(state.phase) && stateOrbs}
          </>
        )}
      </header>
      <div className="panel-body" inert={!open} aria-hidden={!open}>
        {notifying ? (
          <section
            className="notifications"
            onPointerEnter={() => setNotificationHovered(true)}
            onPointerLeave={() => setNotificationHovered(false)}
            onFocus={() => setNotificationFocused(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                setNotificationFocused(false);
            }}
            aria-label="Agent updates"
            aria-live="polite"
          >
            <div className="notification-heading">
              <span>{settlement ? "Thread settled" : "Agent updates"}</span>
              <button
                className="icon notification-dismiss"
                aria-label="Dismiss updates"
                title="Dismiss notification"
                onClick={replies.dismissUpdates}
              >
                {notificationClock && (
                  <svg
                    key={`${notificationClock.expiresAt}:${notificationClock.pausedAt ?? "running"}`}
                    className="notification-ring"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle className="ring-track" cx="12" cy="12" r="10" />
                    <circle
                      className="ring-remaining"
                      cx="12"
                      cy="12"
                      r="10"
                      pathLength="1"
                      style={countdownStyle}
                    />
                  </svg>
                )}
                <X size={10} aria-hidden="true" />
              </button>
            </div>
            {(settlement ? [settlement] : notifications).map((thread) => (
              <div className="notification-card" key={thread.id}>
                <button
                  className="title notification-title"
                  title="Open or focus T3 Code"
                  onClick={() =>
                    void action(() => bridge.openThread(thread.id))
                  }
                >
                  <strong>{thread.title || "Untitled"}</strong>
                  <ArrowUpRight size={12} aria-hidden="true" />
                  <span className={`run-status ${statusOf(thread)}`}>
                    {settlement ? "Settled" : labels[statusOf(thread)]}
                  </span>
                </button>
                <div
                  className="notification-message markdown-content"
                  tabIndex={0}
                  aria-label="Agent update"
                >
                  {settlement ? (
                    "Moved out of the active threads."
                  ) : (
                    <MessageMarkdown
                      text={replies.previews[thread.id]?.text ?? ""}
                    />
                  )}
                </div>
              </div>
            ))}
          </section>
        ) : showSettings ? (
          <section className="settings" aria-label="Connection settings">
            <div className="connection-state">
              <i className={`signal ${state.phase}`} />
              <strong>
                {state.phase === "live"
                  ? "Connected to T3"
                  : state.phase === "stale"
                    ? "Connection lost"
                    : state.phase === "demo"
                      ? "Demo connection"
                      : "Connect to T3"}
              </strong>
            </div>
            {state.origin && (
              <p className="connection-origin">{state.origin}</p>
            )}
            {state.phase !== "live" && (
              <>
                <button
                  className="primary"
                  disabled={pending || demo}
                  onClick={() => void connect(true)}
                >
                  {pending ? "Connecting…" : "Connect local T3"}
                </button>
                <div className="options">
                  <label>
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                    />
                    Remember securely
                  </label>
                </div>
                <details>
                  <summary>Use a pairing code</summary>
                  <div className="pairing">
                    <label>
                      T3 address
                      <input
                        value={origin}
                        onChange={(e) => setOrigin(e.target.value)}
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      Pairing code
                      <input
                        type="password"
                        value={pairingCode}
                        onChange={(e) => setPairingCode(e.target.value)}
                        autoComplete="off"
                      />
                    </label>
                    <button
                      disabled={pending || !pairingCode || demo}
                      onClick={() => void connect(false)}
                    >
                      Connect with code
                    </button>
                  </div>
                </details>
              </>
            )}
            <label className="theme-setting">
              Color theme
              <select
                value={theme}
                onChange={(event) => setTheme(event.target.value)}
              >
                <option value="graphite">Graphite</option>
                <option value="midnight">Midnight</option>
                <option value="forest">Forest</option>
                <option value="light">Light</option>
              </select>
            </label>
            <label className="theme-setting">
              Auto-collapse after
              <select
                value={idleSeconds}
                onChange={(event) => setIdleSeconds(Number(event.target.value))}
              >
                <option value={0}>Off</option>
                <option value={15}>15 seconds</option>
                <option value={30}>30 seconds</option>
                <option value={60}>1 minute</option>
                <option value={120}>2 minutes</option>
                <option value={300}>5 minutes</option>
              </select>
            </label>
            <p>Idle time counts interaction with this notch.</p>
            <p>T3 Code · Local environment</p>
            <div className="options">
              {state.origin && (
                <button onClick={() => void bridge.disconnect()}>
                  Disconnect
                </button>
              )}
              <button onClick={() => void bridge.quit()}>Quit Notched</button>
            </div>
          </section>
        ) : (
          <div ref={runContent} className="thread-content">
            {selected && (
              <aside className="thread-rail">
                {visible.length > 1 && (
                  <nav className="thread-switcher" aria-label="Switch thread">
                    <button
                      className="icon"
                      aria-label="Previous thread"
                      disabled={selectedIndex === 0}
                      onClick={() => selectThread(selectedIndex - 1)}
                    >
                      <ChevronUp size={13} />
                    </button>
                    {visible.slice(0, 9).map((thread, index) => (
                      <button
                        key={thread.id}
                        aria-label={`Thread ${index + 1}: ${thread.title}. ${labels[statusOf(thread)]}`}
                        aria-pressed={thread.id === selected?.id}
                        title={`${thread.title} · ${labels[statusOf(thread)]} · Cmd/Ctrl+${index + 1}`}
                        onClick={() => selectThread(index)}
                      >
                        {shortcutModifier && (
                          <span className="shortcut-modifier">
                            {shortcutModifier}
                          </span>
                        )}
                        {index + 1}
                        <i className={`signal ${statusOf(thread)}`} />
                      </button>
                    ))}
                    <button
                      className="icon"
                      aria-label="Next thread"
                      disabled={selectedIndex >= visible.length - 1}
                      onClick={() => selectThread(selectedIndex + 1)}
                    >
                      <ChevronDown size={13} />
                    </button>
                  </nav>
                )}
                <button
                  className="thread-open-label"
                  aria-label={`Open T3 Code app for ${selected.title || "Untitled"}`}
                  title="Open or focus T3 Code. Select this thread in the app."
                  disabled={state.phase !== "live" && state.phase !== "demo"}
                  onClick={() =>
                    void action(() => bridge.openThread(selected.id))
                  }
                >
                  <span>
                    Open in
                    <br />
                    T3 Code
                  </span>
                  <ArrowUpRight size={12} aria-hidden="true" />
                </button>
              </aside>
            )}
            <section className="runs" aria-label="Active threads">
              {visible.length === 0 && (
                <p className="empty">No active threads</p>
              )}
              {(selected ? [selected] : []).map((thread) => {
                const status = statusOf(thread);
                const activity =
                  thread.planProgress && status === "working"
                    ? `${thread.planProgress.completedSteps}/${thread.planProgress.totalSteps} · ${thread.planProgress.step}`
                    : status === "attention"
                      ? "Continue in T3"
                      : thread.backgroundLiveness === "monitoring"
                        ? "Monitoring in background"
                        : thread.modelSelection.model;
                return (
                  <article
                    className={`run ${replies.updates.includes(thread.id) ? "reply-updated" : ""}`}
                    key={thread.id}
                  >
                    <i
                      className={`signal ${status}`}
                      aria-label={labels[status]}
                      title={labels[status]}
                    />
                    <div className="run-text">
                      <span className="title">
                        <strong title={thread.title}>
                          {thread.title || "Untitled"}
                        </strong>
                      </span>
                      <span
                        className="run-detail"
                        title={`${project(thread)} · ${activity}`}
                      >
                        {project(thread)}
                        <span> · {activity}</span>
                      </span>
                      {(expanded || retainReply) && (
                        <LastMessage
                          key={`${state.environmentId}:${thread.id}:${state.phase}`}
                          preview={replies.previews[thread.id]}
                          visible={replies.visible.current}
                          threadId={thread.id}
                          active={expanded}
                          readable={["live", "demo"].includes(state.phase)}
                        />
                      )}
                    </div>
                  </article>
                );
              })}
            </section>
          </div>
        )}
        {(notice || state.error || state.phase === "stale") && (
          <div className="notice" role="status">
            {notice || state.error || "Showing last known state."}
            {state.phase === "stale" && (
              <button onClick={() => setSettings(true)}>Reconnect</button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
