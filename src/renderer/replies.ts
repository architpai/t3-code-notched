import { useEffect, useRef, useState } from "react";
import {
  monitorThreads,
  statusOf,
  type Bridge,
  type MessagePreview,
  type ViewState,
  type Thread,
} from "../shared/contracts";

/** Preserve references when polling returns the same text; Markdown and the shell stay idle. */
export function reconcilePreviews(
  previous: Record<string, MessagePreview>,
  next: Record<string, MessagePreview>,
): Record<string, MessagePreview> {
  let unchanged = Object.keys(previous).length === Object.keys(next).length;
  for (const [id, value] of Object.entries(next)) {
    const old = previous[id];
    if (old && old.text === value.text && old.error === value.error)
      next[id] = old;
    else unchanged = false;
  }
  return unchanged ? previous : next;
}

export function replyChanged(
  previous: MessagePreview | undefined,
  next: MessagePreview,
): boolean {
  return (
    previous !== undefined &&
    !next.error &&
    Boolean(next.text) &&
    previous.text !== next.text
  );
}

export function newlySettled(
  previous: Thread[] | null,
  next: Thread[],
): Thread[] {
  if (!previous) return [];
  const active = new Set(monitorThreads(previous).map((thread) => thread.id));
  return monitorThreads(next, true).filter((thread) => active.has(thread.id));
}

export interface NotificationClock {
  duration: number;
  expiresAt: number;
  pausedAt?: number;
}

export function pauseClock(
  clock: NotificationClock | null,
  paused: boolean,
  now: number,
): NotificationClock | null {
  if (!clock || paused === (clock.pausedAt !== undefined)) return clock;
  if (paused) return { ...clock, pausedAt: now };
  return {
    duration: clock.duration,
    expiresAt: clock.expiresAt + now - (clock.pausedAt ?? now),
  };
}

export function countdownDelay(clock: NotificationClock, now: number): number {
  return -Math.min(
    clock.duration,
    Math.max(0, (clock.pausedAt ?? now) - (clock.expiresAt - clock.duration)),
  );
}

export function useReplies(bridge: Bridge, state: ViewState, paused = false) {
  const reading = useRef(paused);
  reading.current = paused;
  const current = useRef(state);
  current.current = state;
  const visible = useRef(new Set<string>());
  const [previews, setPreviews] = useState<Record<string, MessagePreview>>({});
  const [updates, setUpdates] = useState<string[]>([]);
  const [settlements, setSettlements] = useState<Thread[]>([]);
  const [updateClock, setUpdateClock] = useState<NotificationClock | null>(
    null,
  );
  const [settlementClock, setSettlementClock] =
    useState<NotificationClock | null>(null);
  const previousShell = useRef<{
    environment: string | null;
    origin: string | null;
    threads: Thread[];
  } | null>(null);
  useEffect(() => {
    const now = Date.now();
    setUpdateClock((clock) => pauseClock(clock, paused, now));
    setSettlementClock((clock) => pauseClock(clock, paused, now));
  }, [paused]);
  useEffect(() => {
    if (!updateClock || paused || updateClock.pausedAt !== undefined) return;
    const timer = setTimeout(
      () => {
        setUpdates([]);
        setUpdateClock(null);
      },
      Math.max(0, updateClock.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [updateClock, paused]);
  useEffect(() => {
    if (!settlementClock || paused || settlementClock.pausedAt !== undefined)
      return;
    const timer = setTimeout(
      () => {
        setSettlements([]);
        setSettlementClock(null);
      },
      Math.max(0, settlementClock.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [settlementClock, paused]);
  useEffect(() => {
    if (state.phase !== "live" && state.phase !== "demo") {
      previousShell.current = null;
      setSettlements([]);
      setSettlementClock(null);
      return;
    }
    const previous = previousShell.current;
    const sameEnvironment =
      previous?.environment === state.environmentId &&
      previous?.origin === state.origin;
    if (!sameEnvironment) {
      setSettlements([]);
      setSettlementClock(null);
    }
    const changes = newlySettled(
      sameEnvironment ? (previous?.threads ?? null) : null,
      state.shell.threads,
    );
    previousShell.current = {
      environment: state.environmentId,
      origin: state.origin,
      threads: state.shell.threads,
    };
    if (changes.length) {
      setSettlements(changes.slice(-1));
      const clock = { duration: 6000, expiresAt: Date.now() + 6000 };
      setSettlementClock(pauseClock(clock, reading.current, Date.now()));
    }
  }, [state.phase, state.environmentId, state.origin, state.shell]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let cursor = 0;
    const known = new Map<string, MessagePreview>();
    setPreviews({});
    setUpdates([]);
    setUpdateClock(null);
    if (state.phase !== "live" && state.phase !== "demo") return;
    async function poll() {
      const snapshot = current.current;
      const threads = monitorThreads(snapshot.shell.threads);
      const ids = new Set(threads.map((t) => t.id));
      for (const key of known.keys()) if (!ids.has(key)) known.delete(key);
      // ponytail: two background reads per cycle; use upstream events if large queues need lower latency.
      const batch = new Set(
        [...visible.current].filter((id) => ids.has(id)).slice(0, 1),
      );
      for (let i = 0; i < Math.min(2, threads.length); i++) {
        const thread = threads[cursor++ % threads.length];
        if (thread) batch.add(thread.id);
      }
      const results = await Promise.all(
        [...batch].map(async (id) => {
          try {
            return { id, value: await bridge.lastMessage(id) };
          } catch {
            return {
              id,
              value: { text: null, error: "Reply unavailable. Retrying…" },
            };
          }
        }),
      );
      if (disposed) return;
      const changed: string[] = [];
      for (const { id, value } of results) {
        if (
          !current.current.shell.threads.some(
            (t) => t.id === id && !t.archivedAt,
          )
        )
          continue;
        const previous = known.get(id);
        if (replyChanged(previous, value) && threads.some((t) => t.id === id))
          changed.push(id);
        // A failed read must not reset the baseline or replay the same reply later.
        if (!value.error) known.set(id, value);
      }
      const displayed = Object.fromEntries(known);
      for (const { id, value } of results)
        if (value.error && !known.has(id)) displayed[id] = value;
      setPreviews((previous) => reconcilePreviews(previous, displayed));
      if (changed.length) {
        setUpdates((previous) =>
          [...previous.filter((id) => !changed.includes(id)), ...changed].slice(
            -2,
          ),
        );
        const characters = changed.reduce(
          (sum, id) => sum + (known.get(id)?.text?.length ?? 0),
          0,
        );
        const duration = Math.min(10000, 5000 + (characters / 80) * 1000);
        const clock = { duration, expiresAt: Date.now() + duration };
        setUpdateClock(pauseClock(clock, reading.current, Date.now()));
      }
      timer = setTimeout(
        () => void poll(),
        threads.some((t) => statusOf(t) === "working") ? 1500 : 4000,
      );
    }
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [bridge, state.phase, state.environmentId, state.origin]);
  return {
    previews,
    updates,
    settlements,
    updateClock,
    settlementClock,
    dismissUpdates: () => {
      setUpdates([]);
      setSettlements([]);
      setUpdateClock(null);
      setSettlementClock(null);
    },
    visible,
  };
}
