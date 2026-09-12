import { z } from "zod";
export const id = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^\x00-\x1f\x7f]+$/);
const time = z.iso.datetime({ offset: true });
export const turnSchema = z.object({
  turnId: id,
  state: z.enum(["running", "completed", "interrupted", "error"]),
  requestedAt: time,
  startedAt: time.nullable(),
  completedAt: time.nullable(),
});
export const threadSchema = z.object({
  id,
  projectId: id,
  title: z.string().max(16_384),
  updatedAt: time,
  latestUserMessageAt: time.nullish(),
  archivedAt: time.nullish(),
  settledOverride: z.enum(["settled", "active"]).nullable().default(null),
  planProgress: z
    .object({
      step: z.string().max(16384),
      completedSteps: z.number().int().nonnegative(),
      totalSteps: z.number().int().nonnegative(),
    })
    .nullish(),
  modelSelection: z.object({
    instanceId: id,
    model: z.string().min(1).max(512),
  }),
  runtimeMode: z.enum([
    "full-access",
    "approval-required",
    "auto-accept-edits",
    "auto",
  ]),
  interactionMode: z.enum(["default", "plan"]),
  latestTurn: turnSchema.nullable(),
  session: z
    .object({
      status: z.enum([
        "idle",
        "starting",
        "running",
        "ready",
        "interrupted",
        "stopped",
        "error",
      ]),
      providerName: z.string().nullable(),
      lastError: z.string().nullable(),
    })
    .nullable(),
  hasPendingApprovals: z.boolean().optional(),
  hasPendingUserInput: z.boolean().optional(),
  backgroundLiveness: z.enum(["working", "monitoring"]).nullish(),
});
export const shellSchema = z.object({
  snapshotSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  projects: z
    .array(
      z.object({
        id,
        title: z.string().optional(),
        workspaceRoot: z.string().max(4096),
      }),
    )
    .max(10_000),
  threads: z.array(threadSchema).max(10_000),
});
export const connectSchema = z
  .object({
    origin: z.string().max(2048),
    pairingCode: z.string().min(1).max(8192),
    remember: z.boolean(),
  })
  .strict();
export type Thread = z.infer<typeof threadSchema>;
export type Shell = z.infer<typeof shellSchema>;
export type ConnectInput = z.infer<typeof connectSchema>;
export type Phase = "disconnected" | "connecting" | "live" | "stale" | "demo";
export interface Notch {
  width: number;
  height: number;
  centerX: number;
}
export const edgeSchema = z.enum(["top", "bottom", "left", "right"]);
export const cornerSchema = z.enum([
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
]);
export type Corner = z.infer<typeof cornerSchema>;
export const dragSchema = z
  .object({
    phase: z.enum(["start", "move", "end", "cancel"]),
    x: z.number().int().min(-100_000).max(100_000),
    y: z.number().int().min(-100_000).max(100_000),
  })
  .strict();
export type DragInput = z.infer<typeof dragSchema>;
/** Ignore small pointer movement so a header click does not become a drag. */
export function isDragMovement(
  start: { x: number; y: number },
  next: { x: number; y: number },
): boolean {
  return Math.hypot(next.x - start.x, next.y - start.y) >= 4;
}
export type Edge = z.infer<typeof edgeSchema>;
export interface ViewState {
  edge: Edge;
  corner: Corner | null;
  contentWidth: number;
  notch: Notch | null;
  phase: Phase;
  error: string | null;
  environmentId: string | null;
  origin: string | null;
  checkedAt: string | null;
  shell: Shell;
}
export interface Result {
  ok: boolean;
  message: string;
}
export interface MessagePreview {
  text: string | null;
  error: string | null;
}
export interface Bridge {
  getState(): Promise<ViewState>;
  subscribe(listener: (state: ViewState) => void): () => void;
  connect(input: ConnectInput): Promise<Result>;
  connectLocal(remember: boolean): Promise<Result>;
  disconnect(): Promise<void>;
  lastMessage(threadId: string): Promise<MessagePreview>;
  usage(): Promise<import("./usage").UsagePreview>;
  resize(
    height: number,
    extension?: number,
    cornerUsageHeight?: number,
  ): Promise<void>;
  movePanel(direction: Edge, nudge: boolean): Promise<void>;
  dragPanel(input: DragInput): Promise<void>;
  openThread(threadId: string): Promise<Result>;
  quit(): Promise<void>;
}
export function emptyState(): ViewState {
  return {
    edge: "top",
    corner: null,
    contentWidth: 418,
    notch: null,
    phase: "disconnected",
    error: null,
    environmentId: null,
    origin: null,
    checkedAt: null,
    shell: { snapshotSequence: 0, projects: [], threads: [] },
  };
}
export function statusOf(
  thread: Thread,
): "working" | "attention" | "failed" | "completed" | "stopped" | "idle" {
  if (thread.hasPendingApprovals || thread.hasPendingUserInput)
    return "attention";
  if (
    thread.session?.status === "error" ||
    thread.latestTurn?.state === "error"
  )
    return "failed";
  if (
    thread.latestTurn?.state === "interrupted" ||
    ["stopped", "interrupted"].includes(thread.session?.status ?? "")
  )
    return "stopped";
  if (
    thread.backgroundLiveness ||
    ["starting", "running"].includes(thread.session?.status ?? "") ||
    thread.latestTurn?.state === "running"
  )
    return "working";
  return thread.latestTurn ? "completed" : "idle";
}

export function canSettleThread(thread: Thread): boolean {
  return (
    !thread.archivedAt && !["working", "attention"].includes(statusOf(thread))
  );
}
export function monitorThreads(threads: Thread[], settled = false): Thread[] {
  const rank = {
    attention: 0,
    working: 1,
    failed: 2,
    stopped: 3,
    completed: 4,
    idle: 5,
  };
  return threads
    .filter(
      (t) =>
        !t.archivedAt &&
        (t.settledOverride === "settled" && canSettleThread(t)) === settled,
    )
    .toSorted(
      (a, b) =>
        rank[statusOf(a)] - rank[statusOf(b)] ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
}

export function monitorHeight(
  expanded: boolean,
  settings: boolean,
  rows: number,
  notice: boolean,
): number {
  return !expanded
    ? 40
    : settings
      ? 300
      : (rows ? 300 : 150) + (notice ? 40 : 0);
}
