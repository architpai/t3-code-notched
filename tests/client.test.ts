import { afterEach, describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { T3Client } from "../src/main/client";
import { localOrigin } from "../src/main/http";
import {
  panelBounds,
  dockAt,
  dragBounds,
  moveDock,
} from "../src/shared/placement";
import {
  statusOf,
  threadSchema,
  canSettleThread,
  monitorThreads,
  monitorHeight,
  isDragMovement,
} from "../src/shared/contracts";
const now = new Date().toISOString();
const thread = {
  id: "thread-1",
  projectId: "project-1",
  title: "Disposable test",
  updatedAt: now,
  modelSelection: { instanceId: "a-custom-provider", model: "my-custom-model" },
  runtimeMode: "auto",
  interactionMode: "default",
  latestTurn: {
    turnId: "turn-1",
    state: "completed",
    requestedAt: now,
    startedAt: now,
    completedAt: now,
  },
  session: {
    status: "ready",
    providerName: "Custom Provider",
    lastError: null,
  },
};
let server: Server | undefined;
let client: T3Client | undefined;
afterEach(async () => {
  client?.disconnect();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  server = undefined;
});
async function fixture(
  options: {
    refuse?: boolean;
    version?: string;
    delay?: number;
    shell?: unknown;
    detail?: unknown;
    detailDelay?: number;
    operate?: boolean;
    loseDispatch?: boolean;
  } = {},
) {
  const commands: unknown[] = [];
  const scopes: Array<string | null> = [];
  const authorizations: Array<{ path: string; auth: string | undefined }> = [];
  server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += String(chunk);
    const path = req.url ?? "";
    authorizations.push({ path, auth: req.headers.authorization });
    const send = (value: unknown) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(value));
    };
    if (path === "/.well-known/t3/environment")
      return send({
        environmentId: "test-environment",
        serverVersion: options.version ?? "0.0.38",
      });
    if (path === "/oauth/token") {
      scopes.push(new URLSearchParams(body).get("scope"));
      return send({
        access_token: "fake-test-token",
        token_type: "Bearer",
        scope: new URLSearchParams(body).get("scope"),
      });
    }
    if (path === "/api/auth/session") {
      if (options.refuse) {
        res.statusCode = 403;
        return send({});
      }
      return send({
        authenticated: true,
        scopes: options.operate
          ? ["orchestration:read", "orchestration:operate"]
          : ["orchestration:read"],
      });
    }
    if (path === "/api/orchestration/shell") {
      if (options.delay)
        await new Promise((resolve) => setTimeout(resolve, options.delay));
      return send(
        options.shell ?? {
          snapshotSequence: 12,
          projects: [{ id: "project-1", workspaceRoot: "/tmp/test" }],
          threads: [thread],
        },
      );
    }
    if (path === "/api/orchestration/dispatch") {
      commands.push(JSON.parse(body));
      if (options.loseDispatch) return res.destroy();
      return send({ sequence: 13 });
    }
    if (path === "/api/orchestration/threads/thread-1?turnLimit=2") {
      if (options.detailDelay)
        await new Promise((resolve) =>
          setTimeout(resolve, options.detailDelay),
        );
      return send(
        options.detail ?? {
          thread: {
            id: "thread-1",
            messages: [
              {
                role: "user",
                text: "Previous request",
                createdAt: "2026-09-06T00:00:00Z",
              },
              { role: "user", text: "Latest request", createdAt: now },
              {
                role: "assistant",
                text: "Previous reply",
                createdAt: "2026-09-06T00:00:00Z",
              },
              {
                role: "assistant",
                text: "Latest assistant reply",
                createdAt: now,
              },
            ],
          },
          page: { hasMore: true },
        },
      );
    }
    res.statusCode = 404;
    send({});
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No test port");
  client = new T3Client(() => {});
  return {
    origin: `http://127.0.0.1:${address.port}`,
    commands,
    scopes,
    authorizations,
  };
}
describe("T3 boundary", () => {
  it("reads only two recent turns on demand with read-only access and returns only the latest assistant text", async () => {
    const f = await fixture();
    await client!.connect({
      origin: f.origin,
      pairingCode: "fake",
      remember: false,
      allowAnswers: false,
    });
    expect(f.authorizations.some((r) => r.path.includes("/threads/"))).toBe(
      false,
    );
    expect(client!.canOpenThread("thread-1")).toBe(true);
    expect(client!.canOpenThread("unknown")).toBe(false);
    expect(await client!.lastMessage("unknown")).toMatchObject({
      text: null,
      error: expect.any(String),
    });
    expect(await client!.lastMessage("thread-1")).toEqual({
      text: "Latest assistant reply",
      error: null,
      questions: [],
    });
    expect(
      f.authorizations
        .filter((r) => r.path.includes("/threads/"))
        .map((r) => r.path),
    ).toEqual(["/api/orchestration/threads/thread-1?turnLimit=2"]);
    client!.disconnect();
    expect(client!.canOpenThread("thread-1")).toBe(false);
    expect(await client!.lastMessage("thread-1")).toMatchObject({
      text: null,
      error: expect.any(String),
    });
    expect(f.commands).toEqual([]);
  });
  it.each([
    { thread: { id: "wrong", messages: [] }, page: { hasMore: false } },
    { thread: { id: "thread-1", messages: [] } },
    {
      thread: {
        id: "thread-1",
        messages: [{ role: "user", text: 123, createdAt: now }],
      },
      page: { hasMore: false },
    },
  ])(
    "rejects mismatched, unbounded, or invalid detail responses",
    async (detail) => {
      const f = await fixture({ detail });
      await client!.connect({
        origin: f.origin,
        pairingCode: "fake",
        remember: false,
      });
      expect(await client!.lastMessage("thread-1")).toMatchObject({
        text: null,
        error: expect.any(String),
      });
      expect(client!.state.phase).toBe("live");
    },
  );
  it.each([
    [[], null],
    [[{ role: "user", text: "User prompt only", createdAt: now }], null],
    [
      [{ role: "assistant", text: "", createdAt: now }],
      "Agent message has no text.",
    ],
    [
      [
        {
          role: "assistant",
          text: "old".repeat(100) + "x".repeat(1200),
          createdAt: now,
        },
      ],
      "old".repeat(100) + "x".repeat(1200),
    ],
  ])(
    "handles missing, empty and long agent messages",
    async (messages, expected) => {
      const f = await fixture({
        detail: {
          thread: { id: "thread-1", messages },
          page: { hasMore: false },
        },
      });
      await client!.connect({
        origin: f.origin,
        pairingCode: "fake",
        remember: false,
      });
      expect(await client!.lastMessage("thread-1")).toEqual({
        text: expected,
        error: null,
        questions: [],
      });
    },
  );
  it("allows desktop opening only for known live non-archived threads", async () => {
    const f = await fixture();
    await client!.connect({
      origin: f.origin,
      pairingCode: "fake",
      remember: false,
    });
    client!.state.environmentId = "env/with?query";
    client!.state.shell.threads = [
      { ...threadSchema.parse(thread), id: "chat/with#fragment" },
    ];
    expect(client!.canOpenThread("chat/with#fragment")).toBe(true);
    client!.state.shell.threads[0]!.archivedAt = now;
    expect(client!.canOpenThread("chat/with#fragment")).toBe(false);
    client!.state.shell.threads[0]!.archivedAt = null;
    client!.state.phase = "stale";
    expect(client!.canOpenThread("chat/with#fragment")).toBe(false);
  });
  it("discards a message read when the connection changes", async () => {
    const f = await fixture({ detailDelay: 100 });
    await client!.connect({
      origin: f.origin,
      pairingCode: "fake",
      remember: false,
    });
    const pending = client!.lastMessage("thread-1");
    client!.disconnect();
    expect(await pending).toMatchObject({
      text: null,
      error: expect.any(String),
    });
  });
  it("requests only read access and never dispatches thread commands", async () => {
    const f = await fixture();
    await client!.connect({
      origin: f.origin,
      pairingCode: "fake",
      remember: false,
      allowAnswers: false,
    });
    expect(client!.state.phase).toBe("live");
    expect(f.scopes).toEqual(["orchestration:read"]);
    expect(f.commands).toEqual([]);
    expect(
      f.authorizations.find((r) => r.path === "/.well-known/t3/environment")
        ?.auth,
    ).toBeUndefined();
  });
  it.each(["0.0.37", "0.0.40", "99.0.0-alpha.1"])(
    "connects and restores a compatible T3 %s",
    async (version) => {
      const f = await fixture({ version });
      const credential = await client!.connect({
        origin: f.origin,
        pairingCode: "fake",
        remember: false,
      });
      expect(client!.state.phase).toBe("live");
      client!.disconnect();
      await client!.restore(credential);
      expect(client!.state.phase).toBe("live");
    },
  );
  it("rejects incompatible shell data regardless of version", async () => {
    const f = await fixture({ version: "0.0.40", shell: { threads: null } });
    await expect(
      client!.connect({
        origin: f.origin,
        pairingCode: "fake",
        remember: false,
      }),
    ).rejects.toThrow();
    expect(client!.state.phase).toBe("stale");

    expect(client!.state.error).toBe("T3 returned an unsupported response.");
  });
  it("does not claim connection authority when auth is refused", async () => {
    const f = await fixture({ refuse: true });
    await expect(
      client!.connect({
        origin: f.origin,
        pairingCode: "fake",
        remember: false,
      }),
    ).rejects.toThrow();

    expect(client!.state.phase).toBe("stale");
  });
  it("cannot revive a disconnected generation", async () => {
    const f = await fixture({ delay: 150 });
    const pending = client!.connect({
      origin: f.origin,
      pairingCode: "fake",
      remember: false,
    });
    const outcome = pending.catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, 40));
    client!.disconnect();
    await outcome;
    expect(client!.state.phase).toBe("disconnected");
  });
  it("pins a saved token to its environment before sending it", async () => {
    const f = await fixture();
    await expect(
      client!.restore({
        origin: f.origin,
        environmentId: "another-environment",
        token: "fake-saved-secret",
      }),
    ).rejects.toThrow("changed");
    expect(f.authorizations.every((v) => v.auth === undefined)).toBe(true);
  });
});
describe("pure policy", () => {
  it("handles work, attention, failure, and background monitoring", () => {
    const t = threadSchema.parse(thread);
    const settled = {
      ...t,
      id: "settled",
      settledOverride: "settled" as const,
    };
    const working = {
      ...settled,
      id: "working",
      backgroundLiveness: "working" as const,
    };
    const archived = { ...t, id: "archived", archivedAt: now };
    expect(
      monitorThreads([t, settled, working, archived]).map((t) => t.id),
    ).toEqual(["working", t.id]);
    expect(
      monitorThreads([t, settled, working, archived], true).map((t) => t.id),
    ).toEqual(["settled"]);
    expect(canSettleThread(working)).toBe(false);
    expect(canSettleThread(t)).toBe(true);
    expect(statusOf(t)).toBe("completed");
    const stopped = {
      ...t,
      session: {
        status: "stopped" as const,
        providerName: null,
        lastError: null,
      },
    };
    expect(statusOf(stopped)).toBe("stopped");
    expect(canSettleThread(stopped)).toBe(true);
    expect(
      statusOf({
        ...t,
        latestTurn: { ...t.latestTurn!, state: "interrupted" },
      }),
    ).toBe("stopped");
    expect(
      statusOf({ ...t, latestTurn: { ...t.latestTurn!, state: "running" } }),
    ).toBe("working");
    expect(statusOf({ ...t, backgroundLiveness: "monitoring" })).toBe(
      "working",
    );
    expect(statusOf({ ...t, hasPendingApprovals: true })).toBe("attention");
    expect(
      statusOf({
        ...t,
        session: { status: "error", providerName: null, lastError: "failed" },
      }),
    ).toBe("failed");
  });
  it("rejects remote and credential-bearing origins", () => {
    for (const input of [
      "https://example.com",
      "http://192.168.1.1:3000",
      "http://user@localhost:3773",
      "http://localhost:3773/?token=x",
      "http://localhost:3773/path",
    ]) {
      expect(() => localOrigin(input)).toThrow();
    }
    expect(localOrigin("http://127.0.0.1:3773/")).toBe("http://127.0.0.1:3773");
  });
  it("keeps every drag frame inside a display, including gaps, negative origins and smaller monitors", () => {
    const panel = { x: 0, y: 0, width: 380, height: 260 };
    for (const area of [
      { x: 0, y: 0, width: 1512, height: 982 },
      { x: -1920, y: -1080, width: 1920, height: 1080 },
      { x: 1600, y: 300, width: 200, height: 100 },
    ])
      for (const point of [
        { x: -99999, y: -99999 },
        { x: 99999, y: 99999 },
        { x: 400, y: 150 },
      ]) {
        const moved = dragBounds(area, panel, point, { x: 20, y: 20 });
        expect(moved.x).toBeGreaterThanOrEqual(area.x);
        expect(moved.y).toBeGreaterThanOrEqual(area.y);
        expect(moved.x + moved.width).toBeLessThanOrEqual(area.x + area.width);
        expect(moved.y + moved.height).toBeLessThanOrEqual(
          area.y + area.height,
        );
      }
    expect(
      dragBounds(
        { x: 0, y: 0, width: 1512, height: 982 },
        panel,
        { x: 1500, y: 980 },
        { x: 20, y: 20 },
      ),
    ).toEqual({ x: 1132, y: 722, width: 380, height: 260 });
  });
  it("anchors each edge, opens inward, and clamps corners and small displays", () => {
    const area = { x: -1600, y: -900, width: 1600, height: 900 };
    for (const edge of ["top", "bottom", "left", "right"] as const) {
      for (const offset of [0, 0.25, 0.5, 1]) {
        const compact = panelBounds(area, 40, null, { edge, offset });
        const expanded = panelBounds(area, 2000, null, { edge, offset });
        expect(expanded.height).toBe(600);
        for (const rect of [compact, expanded]) {
          expect(rect.x).toBeGreaterThanOrEqual(area.x);
          expect(rect.y).toBeGreaterThanOrEqual(area.y);
          expect(rect.x + rect.width).toBeLessThanOrEqual(area.x + area.width);
          expect(rect.y + rect.height).toBeLessThanOrEqual(
            area.y + area.height,
          );
          if (edge === "top") expect(rect.y).toBe(area.y);
          if (edge === "bottom")
            expect(rect.y + rect.height).toBe(area.y + area.height);
          if (edge === "left") expect(rect.x).toBe(area.x);
          if (edge === "right")
            expect(rect.x + rect.width).toBe(area.x + area.width);
        }
        if (edge === "bottom") expect(expanded.y).toBeLessThan(compact.y);
        if (edge === "right") expect(expanded.x).toBeLessThan(compact.x);
      }
    }
    expect(dockAt(area, { x: -1200, y: -890 })).toEqual({
      edge: "top",
      offset: 0.25,
    });
    expect(dockAt(area, { x: -1200, y: -10 })).toEqual({
      edge: "bottom",
      offset: 0.25,
    });
    expect(dockAt(area, { x: -1590, y: -450 })).toEqual({
      edge: "left",
      offset: 0.5,
    });
    expect(dockAt(area, { x: -10, y: -450 })).toEqual({
      edge: "right",
      offset: 0.5,
    });
    expect(
      panelBounds({ x: 0, y: 0, width: 30, height: 30 }, 260, null, {
        edge: "right",
        offset: 1,
      }),
    ).toEqual({ x: 0, y: 0, width: 30, height: 30 });
  });
  it("fits displays with negative coordinates and small work areas", () => {
    const notch = { width: 184, height: 32, centerX: 756 };
    expect(
      panelBounds({ x: 0, y: 0, width: 1512, height: 982 }, 40, notch),
    ).toEqual({ x: 576, y: 0, width: 360, height: 40 });
    expect(
      panelBounds({ x: -1512, y: -982, width: 1512, height: 982 }, 135, notch),
    ).toEqual({ x: -966, y: -982, width: 420, height: 135 });
    expect(monitorHeight(false, false, 63, false)).toBe(40);
    expect(monitorHeight(true, false, 1, false)).toBe(300);
    expect(monitorHeight(true, false, 1, false, true)).toBe(600);
    expect(monitorHeight(false, false, 1, false, true)).toBe(40);
    expect(monitorHeight(true, true, 1, false, true)).toBe(300);
    expect(monitorHeight(true, false, 63, false)).toBe(300);
    expect(panelBounds({ x: 0, y: 0, width: 300, height: 100 }, 260)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 100,
    });
    expect(
      panelBounds({ x: -1920, y: 24, width: 1920, height: 1056 }, 40),
    ).toEqual({ x: -1140, y: 24, width: 360, height: 40 });
    expect(panelBounds({ x: 0, y: 0, width: 600, height: 400 }, 260)).toEqual({
      x: 90,
      y: 0,
      width: 420,
      height: 260,
    });
  });
});

it("keeps a header click distinct from a drag on any screen origin", () => {
  const start = { x: -1200, y: 40 };
  expect(isDragMovement(start, start)).toBe(false);
  expect(isDragMovement(start, { x: -1198, y: 42 })).toBe(false);
  expect(isDragMovement(start, { x: -1196, y: 40 })).toBe(true);
  expect(isDragMovement(start, { x: -1203, y: 37 })).toBe(true);
});

it("snaps every screen corner to a compact box and opens inward", () => {
  const area = { x: -1200, y: -800, width: 1200, height: 800 };
  for (const [x, y, corner] of [
    [-1190, -790, "top-left"],
    [-10, -790, "top-right"],
    [-1190, -10, "bottom-left"],
    [-10, -10, "bottom-right"],
  ] as const) {
    const dock = dockAt(area, { x, y });
    expect(dock).toHaveProperty("corner", corner);
    const closed = panelBounds(area, 40, null, dock);
    const open = panelBounds(area, 260, null, dock);
    expect(closed.width).toBe(112);
    expect(closed.height).toBe(76);
    expect(open.width).toBe(420);
    expect(open.height).toBe(260);
    const left = corner.endsWith("left");
    const top = corner.startsWith("top");
    expect(left ? open.x : open.x + open.width).toBe(left ? area.x : 0);
    expect(top ? open.y : open.y + open.height).toBe(top ? area.y : 0);
    expect(left ? closed.x : closed.x + closed.width).toBe(left ? area.x : 0);
    expect(top ? closed.y : closed.y + closed.height).toBe(top ? area.y : 0);
  }
  expect(dockAt(area, { x: -600, y: -790 })).not.toHaveProperty("corner");
});

it("can nudge back out of a corner without getting stuck", () => {
  const area = { x: 0, y: 0, width: 1000, height: 800 };
  let dock = dockAt(area, { x: 0, y: 0 });
  expect(dock.corner).toBe("top-left");
  for (let i = 0; i < 4; i++) dock = moveDock(area, dock, "right", true);
  expect(dock.corner).toBeUndefined();
  expect(dock.edge).toBe("top");
  expect(dock.offset).toBeCloseTo(0.096);
  expect(moveDock(area, dock, "bottom", false)).toEqual({
    edge: "bottom",
    offset: 0.5,
  });
});

it("extends the panel rightwards without moving the camera cutout", () => {
  const area = { x: 0, y: 0, width: 1512, height: 982 };
  const notch = { width: 184, height: 32, centerX: 756 };
  const base = panelBounds(area, 40, notch);
  const extended = panelBounds(
    area,
    40,
    notch,
    { edge: "top", offset: 0.5 },
    192,
  );
  expect(extended).toEqual({ ...base, width: base.width + 192 });
  for (const edge of ["top", "bottom", "left", "right"] as const) {
    const bounds = panelBounds(area, 40, null, { edge, offset: 1 }, 600);
    expect(bounds.x).toBeGreaterThanOrEqual(area.x);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(area.width);
  }
});

it("snaps using the dragged panel boundary even when the grab point is far from the corner", () => {
  const area = { x: -1200, y: -800, width: 1200, height: 800 };
  const panel = { x: -800, y: -500, width: 400, height: 200 };
  for (const [x, y, corner] of [
    [-1190, -790, "top-left"],
    [-410, -790, "top-right"],
    [-1190, -210, "bottom-left"],
    [-410, -210, "bottom-right"],
  ] as const) {
    for (const grab of [
      { x: 10, y: 10 },
      { x: 200, y: 30 },
      { x: 390, y: 190 },
    ]) {
      const moved = dragBounds(
        area,
        panel,
        { x: x + grab.x, y: y + grab.y },
        grab,
      );
      expect(dockAt(area, moved).corner).toBe(corner);
    }
  }
});
it("does not widen a compact corner to place usage beside the status", () => {
  const rect = panelBounds(
    { x: 0, y: 0, width: 1200, height: 800 },
    40,
    null,
    { edge: "top", offset: 0, corner: "top-left" },
    200,
  );
  expect(rect.width).toBe(112);
});

const asyncRequest = {
  requestId: "async-1",
  responseMode: "message",
  questions: [
    {
      id: "0",
      header: "Choice",
      question: "Which theme?",
      options: [{ label: "Dark", description: "", value: "dark" }],
      allowCustomAnswer: false,
    },
  ],
};
const questionDetail = {
  thread: {
    id: "thread-1",
    messages: [],
    activities: [
      {
        id: "a",
        kind: "user-input.requested",
        createdAt: now,
        payload: asyncRequest,
      },
    ],
  },
  page: { hasMore: true },
};
const answer = {
  threadId: "thread-1",
  requestId: "async-1",
  answers: { "0": "dark" },
};
it("respects disabled answers and enables answers by default on a new connection", async () => {
  const f = await fixture({ operate: true, detail: questionDetail });
  await client!.connect({
    origin: f.origin,
    pairingCode: "fake",
    remember: false,
    allowAnswers: false,
  });
  expect(client!.state.canAnswerQuestions).toBe(false);
  expect((await client!.lastMessage("thread-1")).questions).toMatchObject([
    asyncRequest,
  ]);
  expect((await client!.answerQuestion(answer)).ok).toBe(false);
  const credential = await client!.connect({
    origin: f.origin,
    pairingCode: "fake",
    remember: false,
  });
  expect(f.scopes.at(-1)).toBe("orchestration:read orchestration:operate");
  expect(client!.state.canAnswerQuestions).toBe(true);
  expect(
    (await client!.answerQuestion({ ...answer, answers: { "0": "invalid" } }))
      .ok,
  ).toBe(false);
  const results = await Promise.all([
    client!.answerQuestion(answer),
    client!.answerQuestion(answer),
  ]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(f.commands).toHaveLength(1);
  expect(f.commands[0]).toMatchObject({
    ...answer,
    type: "thread.user-input.respond",
    commandId: expect.any(String),
  });
  expect(JSON.stringify(f.commands)).not.toContain("fake-test-token");
  expect(
    (await client!.lastMessage("thread-1")).questions?.[0]?.submission,
  ).toBe("accepted");
  await client!.restore(credential);
  expect((await client!.answerQuestion(answer)).ok).toBe(false);
  expect(f.commands).toHaveLength(1);
});
it("blocks uncertain resends even after reconnecting", async () => {
  const f = await fixture({
    operate: true,
    detail: questionDetail,
    loseDispatch: true,
  });
  const credential = await client!.connect({
    origin: f.origin,
    pairingCode: "fake",
    remember: false,
    allowAnswers: true,
  });
  expect(await client!.answerQuestion(answer)).toMatchObject({
    ok: false,
    retryable: false,
    message: expect.stringContaining("not confirmed"),
  });
  await client!.restore(credential);
  expect(
    (await client!.lastMessage("thread-1")).questions?.[0]?.submission,
  ).toBe("uncertain");
  expect((await client!.answerQuestion(answer)).ok).toBe(false);
  expect(f.commands).toHaveLength(1);
});
it("does not answer a resolved question, a different thread, or without the granted scope", async () => {
  const f = await fixture({ detail: questionDetail });
  await client!.connect({
    origin: f.origin,
    pairingCode: "fake",
    remember: false,
    allowAnswers: true,
  });
  expect(client!.state.canAnswerQuestions).toBe(false);
  expect((await client!.answerQuestion(answer)).ok).toBe(false);
  expect(f.commands).toEqual([]);
});
it("rechecks question resolution before dispatch", async () => {
  const detail = structuredClone(questionDetail);
  const f = await fixture({ operate: true, detail });
  await client!.connect({
    origin: f.origin,
    pairingCode: "fake",
    remember: false,
    allowAnswers: true,
  });
  expect((await client!.lastMessage("thread-1")).questions).toHaveLength(1);
  detail.thread.activities = [];
  expect((await client!.answerQuestion(answer)).ok).toBe(false);
  expect(
    (await client!.answerQuestion({ ...answer, threadId: "other" })).ok,
  ).toBe(false);
  expect((await client!.lastMessage("thread-1")).questions).toEqual([]);
  expect(f.commands).toEqual([]);
});
it("cancels an answer if disconnected during its fresh question read", async () => {
  const f = await fixture({
    operate: true,
    detail: questionDetail,
    detailDelay: 100,
  });
  await client!.connect({
    origin: f.origin,
    pairingCode: "fake",
    remember: false,
    allowAnswers: true,
  });
  const pending = client!.answerQuestion(answer);
  client!.disconnect();
  expect((await pending).ok).toBe(false);
  expect(client!.state.canAnswerQuestions).toBe(false);
  expect(f.commands).toEqual([]);
});
