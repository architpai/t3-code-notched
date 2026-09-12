import { afterEach, expect, it } from "vitest";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { readUsage } from "../src/main/usage";
import {
  usageConfigSchema,
  usageLabel,
  providerAllowances,
} from "../src/shared/usage";

const now = new Date().toISOString();
const provider = {
  instanceId: "custom",
  driver: "custom-driver",
  displayName: "Custom provider",
  usageLimits: {
    checkedAt: now,
    windows: [
      { id: "session", label: "Session", usedPercent: 20, resetsAt: now },
      { id: "weekly", label: "Weekly", usedPercent: 75.5 },
    ],
  },
};
let server: WebSocketServer | undefined;
afterEach(async () => {
  if (!server) return;
  for (const client of server.clients) client.terminate();
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});
async function fixture(value: unknown, silent = false) {
  server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No test port");
  const requests: unknown[] = [];
  const headers: Array<{ url: string | undefined; auth: string | undefined }> =
    [];
  server.on("connection", (socket, req) => {
    headers.push({ url: req.url, auth: req.headers.authorization });
    socket.on("message", (data) => {
      requests.push(JSON.parse(data.toString()));
      if (!silent) socket.send(JSON.stringify(value));
    });
  });
  return { origin: `http://127.0.0.1:${address.port}`, requests, headers };
}
function response(value: unknown) {
  return { _tag: "Exit", requestId: "1", exit: { _tag: "Success", value } };
}
it("reads only config with a header token and drops unrelated account data", async () => {
  const f = await fixture(
    response({
      providers: [{ ...provider, auth: { secret: "fixture-only" } }],
      secret: "fixture-only",
    }),
  );
  const result = await readUsage(
    f.origin,
    "test-token",
    new AbortController().signal,
  );
  expect(result).toEqual({ providers: [provider], error: null });
  expect(f.headers).toEqual([{ url: "/ws", auth: "Bearer test-token" }]);
  expect(f.requests).toEqual([
    {
      _tag: "Request",
      id: "1",
      tag: "server.getConfig",
      payload: {},
      headers: [],
    },
  ]);
  expect(usageLabel(result, "custom").text).toBe("24% left");
  expect(usageLabel(result, "custom").title).toContain("Resets");
  expect(usageLabel(result, "unknown").text).toBe("Usage —");
});
it.each([
  response({
    providers: [
      {
        ...provider,
        usageLimits: {
          ...provider.usageLimits,
          windows: [{ id: "bad", label: "Bad", usedPercent: 101 }],
        },
      },
    ],
  }),
  response({ providers: [provider, provider] }),
  { ...response({ providers: [provider] }), requestId: "wrong" },
  { _tag: "Exit", requestId: "1", exit: { _tag: "Failure", cause: [] } },
])(
  "rejects invalid or failed responses without exposing their contents",
  async (value) => {
    const f = await fixture(value);
    const result = await readUsage(
      f.origin,
      "test-token",
      new AbortController().signal,
    );
    expect(result.providers).toEqual([]);
    expect(result.error).toContain("Usage unavailable");
  },
);
it("handles older providers and failed probes without showing a false allowance", async () => {
  const f = await fixture(
    response({ providers: [{ instanceId: "old", driver: "old" }] }),
  );
  const result = await readUsage(
    f.origin,
    "test-token",
    new AbortController().signal,
  );
  expect(result.error).toBeNull();
  expect(usageLabel(result).text).toBe("Usage —");
  const failed = usageConfigSchema.parse({
    providers: [
      {
        ...provider,
        usageLimits: {
          ...provider.usageLimits,
          unavailable: { reason: "probeFailed" },
        },
      },
    ],
  });
  expect(usageLabel({ ...failed, error: null }).text).toBe("Usage —");
});
it("cancels an in-flight read and refuses an already cancelled read", async () => {
  const f = await fixture({}, true);
  const abort = new AbortController();
  const pending = readUsage(f.origin, "test-token", abort.signal);
  await once(server!, "connection");
  abort.abort();
  expect((await pending).error).not.toBeNull();
  expect(
    (await readUsage(f.origin, "test-token", abort.signal)).error,
  ).not.toBeNull();
  expect(f.headers).toHaveLength(1);
});

it("keeps each provider's allowance separate", () => {
  const other = {
    ...provider,
    instanceId: "other",
    driver: "second",
    usageLimits: {
      ...provider.usageLimits,
      windows: [{ id: "weekly", label: "Weekly", usedPercent: 5 }],
    },
  };
  const usage = { providers: [provider, other], error: null };
  expect(usageLabel(usage, "custom").text).toBe("24% left");
  expect(usageLabel(usage, "other").text).toBe("95% left");
});

it("hides missing usage and selects five-hour then weekly limits", () => {
  const usage = usageConfigSchema.parse({
    providers: [
      {
        ...provider,
        usageLimits: {
          checkedAt: now,
          windows: [
            {
              id: "weekly-model",
              kind: "weekly",
              label: "Weekly · Model",
              usedPercent: 90,
            },
            { id: "weekly", kind: "weekly", label: "Weekly", usedPercent: 40 },
            {
              id: "session",
              kind: "session",
              label: "Session",
              windowDurationMins: 300,
              usedPercent: 0,
            },
          ],
        },
      },
      { instanceId: "no-usage", driver: "opencode", enabled: true },
      { ...provider, instanceId: "disabled", enabled: false },
      {
        ...provider,
        instanceId: "empty",
        usageLimits: { checkedAt: now, windows: [] },
      },
    ],
  });
  expect(
    providerAllowances({ ...usage, error: null }, false).map((p) => p.rows),
  ).toEqual([[{ id: "session", label: "5h", text: "100% left" }]]);
  expect(providerAllowances({ ...usage, error: null }, true)[0]?.rows).toEqual([
    { id: "session", label: "5h", text: "100% left" },
    { id: "weekly", label: "Week", text: "60% left" },
  ]);
  usage.providers[0]!.usageLimits!.windows =
    usage.providers[0]!.usageLimits!.windows.filter((w) => w.kind === "weekly");
  expect(
    providerAllowances({ ...usage, error: null }, false)[0]?.rows[0]?.id,
  ).toBe("weekly");
  expect(providerAllowances({ ...usage, error: "Offline" }, true)).toEqual([]);
});

it("applies independent per-view window choices without changing defaults", () => {
  const usage = usageConfigSchema.parse({
    providers: [
      {
        ...provider,
        usageLimits: {
          checkedAt: now,
          windows: [
            {
              id: "session",
              kind: "session",
              label: "Session",
              windowDurationMins: 300,
              usedPercent: 20,
            },
            { id: "weekly", kind: "weekly", label: "Weekly", usedPercent: 40 },
            {
              id: "fable",
              kind: "weekly",
              label: "Weekly · Fable",
              usedPercent: 60,
            },
          ],
        },
      },
    ],
  });
  const preview = { ...usage, error: null };
  const preferences = {
    custom: { collapsed: ["session", "fable"], expanded: ["weekly"] },
  };
  expect(
    providerAllowances(preview, false, preferences)[0]?.rows.map((r) => r.id),
  ).toEqual(["session", "fable"]);
  expect(
    providerAllowances(preview, true, preferences)[0]?.rows.map((r) => r.id),
  ).toEqual(["weekly"]);
  expect(
    providerAllowances(preview, false, { custom: { collapsed: [] } }),
  ).toEqual([]);
  expect(
    providerAllowances(preview, true, {
      custom: { collapsed: [] },
    })[0]?.rows.map((r) => r.id),
  ).toEqual(["session", "weekly"]);
  expect(
    providerAllowances(preview, false, { custom: { collapsed: ["removed"] } }),
  ).toEqual([]);
  expect(providerAllowances(preview, false)[0]?.rows[0]?.id).toBe("session");
  expect(
    providerAllowances(preview, false, preferences)[0]?.rows[1]?.label,
  ).toBe("Weekly · Fable");
});
