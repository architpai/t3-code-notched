import { z } from "zod";
import {
  id,
  emptyState,
  shellSchema,
  statusOf,
  type ViewState,
  type ConnectInput,
  type MessagePreview,
} from "../shared/contracts";
import {
  request,
  localOrigin,
  environmentSchema,
  authSchema,
  tokenSchema,
} from "./http";
export interface Credential {
  origin: string;
  environmentId: string;
  token: string;
}
export class T3Client {
  state = emptyState();
  private credential: Credential | null = null;
  private abort = new AbortController();
  private epoch = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private publish: (state: ViewState) => void) {}
  private emit() {
    this.publish(structuredClone(this.state));
  }
  disconnect() {
    this.epoch++;
    this.abort.abort();
    this.abort = new AbortController();
    clearTimeout(this.timer);
    this.credential = null;
    this.state = {
      ...this.state,
      phase: "disconnected",
      error: null,
    };
    this.emit();
  }
  async connect(input: ConnectInput): Promise<Credential> {
    this.disconnect();
    const epoch = this.epoch;
    const origin = localOrigin(input.origin);
    const signal = this.abort.signal;
    this.state = { ...emptyState(), phase: "connecting" };
    this.emit();
    try {
      const env = environmentSchema.parse(
        await request(origin, "/.well-known/t3/environment", null, signal),
      );
      const scope = "orchestration:read";
      const form = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: input.pairingCode,
        subject_token_type:
          "urn:t3:params:oauth:token-type:environment-bootstrap",
        requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
        scope,
        client_label: "T3 Code Notched",
      });
      const grant = tokenSchema.parse(
        await request(origin, "/oauth/token", null, signal, form),
      );
      if (!grant.scope.split(" ").includes("orchestration:read"))
        throw new Error("T3 did not grant the requested access.");
      const credential = {
        origin,
        environmentId: env.environmentId,
        token: grant.access_token,
      };
      if (epoch !== this.epoch) throw new Error("Connection cancelled.");
      this.credential = credential;
      this.state = { ...this.state, environmentId: env.environmentId, origin };
      await this.poll(epoch);
      if (epoch !== this.epoch || this.state.phase !== "live")
        throw new Error(
          this.state.error ?? "T3 connection could not be verified.",
        );
      return credential;
    } catch (error) {
      if (epoch === this.epoch) {
        this.state = {
          ...this.state,
          phase: "stale",
          error: safeError(error),
        };
        this.emit();
      }
      throw error;
    }
  }
  async restore(credential: Credential) {
    this.disconnect();
    const epoch = this.epoch;
    const origin = localOrigin(credential.origin);
    // Identify the environment before sending its saved bearer token.
    const env = environmentSchema.parse(
      await request(
        origin,
        "/.well-known/t3/environment",
        null,
        this.abort.signal,
      ),
    );
    if (env.environmentId !== credential.environmentId || epoch !== this.epoch)
      throw new Error("Saved T3 environment changed. Connect again.");
    this.credential = credential;
    this.state = {
      ...emptyState(),
      origin,
      environmentId: env.environmentId,
      phase: "connecting",
    };
    this.emit();
    await this.poll(epoch);
  }
  private async poll(epoch: number): Promise<void> {
    const c = this.credential;
    if (!c || epoch !== this.epoch) return;
    try {
      const auth = authSchema.parse(
        await request(
          c.origin,
          "/api/auth/session",
          c.token,
          this.abort.signal,
        ),
      );
      if (!auth.authenticated || !auth.scopes.includes("orchestration:read"))
        throw new Error("T3 access expired. Connect again.");
      const shell = shellSchema.parse(
        await request(
          c.origin,
          "/api/orchestration/shell",
          c.token,
          this.abort.signal,
        ),
      );
      if (new Set(shell.threads.map((t) => t.id)).size !== shell.threads.length)
        throw new Error("T3 returned duplicate threads.");
      if (epoch !== this.epoch) return;
      this.state = {
        ...this.state,
        shell,
        phase: "live",
        error: null,
        checkedAt: new Date().toISOString(),
      };
      this.emit();
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.state = {
        ...this.state,
        phase: "stale",
        error: safeError(error),
      };
      this.emit();
    }
    // ponytail: poll one shell without transcripts. Add the shared T3 RPC client when polling cost warrants it.
    if (epoch === this.epoch)
      this.timer = setTimeout(
        () => void this.poll(epoch),
        this.state.shell.threads.some((t) => statusOf(t) === "working")
          ? 1500
          : 4000,
      );
  }
  canOpenThread(threadId: string): boolean {
    const target = id.parse(threadId);
    return (
      this.state.phase === "live" &&
      this.state.shell.threads.some((t) => t.id === target && !t.archivedAt)
    );
  }
  async lastMessage(threadId: string): Promise<MessagePreview> {
    const target = id.parse(threadId);
    const c = this.credential;
    const epoch = this.epoch;
    if (
      !c ||
      this.state.phase !== "live" ||
      !this.state.shell.threads.some((t) => t.id === target && !t.archivedAt)
    )
      return { text: null, error: "Connect to T3 to read the last message." };
    try {
      // Include the previous turn while the newest prompt is waiting for a reply.
      const detail = z
        .object({
          thread: z.object({
            id,
            messages: z
              .array(
                z.object({
                  role: z.enum(["user", "assistant", "system"]),
                  text: z.string(),
                  createdAt: z.iso.datetime({ offset: true }),
                }),
              )
              .max(10_000),
          }),
          // Require pagination metadata; never fall back to a full transcript.
          page: z.object({ hasMore: z.boolean() }),
        })
        .parse(
          await request(
            c.origin,
            `/api/orchestration/threads/${encodeURIComponent(target)}?turnLimit=2`,
            c.token,
            this.abort.signal,
          ),
        );
      if (
        epoch !== this.epoch ||
        this.state.phase !== "live" ||
        detail.thread.id !== target
      )
        return {
          text: null,
          error: "Message could not be verified. Try again.",
        };
      const latest = detail.thread.messages
        .filter((m) => m.role === "assistant")
        .toSorted((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
        .at(-1);
      const text = latest?.text.trim();
      return {
        text: latest ? (text ? text : "Agent message has no text.") : null,
        error: null,
      };
    } catch {
      return { text: null, error: "Cannot load the last message. Try again." };
    }
  }
}
export function safeError(error: unknown): string {
  return error instanceof z.ZodError
    ? "T3 returned an unsupported response."
    : error instanceof Error &&
        /^(T3 |Saved T3|Use the local|Connection cancelled)/.test(error.message)
      ? error.message
      : "Cannot reach T3. Check that it is open and retry.";
}
