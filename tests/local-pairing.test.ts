import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  installed: new Set<string>(),
  exec: vi.fn(async (file: string) => {
    if (!mocks.installed.has(file))
      throw Object.assign(new Error("Not installed"), { code: "ENOENT" });
    return {
      stdout: JSON.stringify({ credential: "fixture-pairing-code" }),
      stderr: "",
    };
  }),
}));
vi.mock("node:fs", () => ({
  existsSync: (file: string) => mocks.installed.has(file),
}));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () =>
    Buffer.from(JSON.stringify({ origin: "http://127.0.0.1:3773" })),
  ),
}));
vi.mock("node:os", () => ({ homedir: () => "/fixture-home" }));
vi.mock("node:util", () => ({ promisify: () => mocks.exec }));
import { localPairing } from "../src/main/local-pairing";
const executable = (name: string) =>
  join("/Applications", `${name}.app`, "Contents", "MacOS", name);
afterEach(() => {
  mocks.installed.clear();
  mocks.exec.mockClear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it.each(["T3 Code (Nightly)", "T3 Code (Alpha)"])(
  "pairs with an already-running %s installation",
  async (name) => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    mocks.installed.add(executable(name));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              environmentId: "fixture",
              serverVersion: "0.0.41-nightly",
            }),
          ),
      ),
    );
    await expect(localPairing()).resolves.toEqual({
      origin: "http://127.0.0.1:3773",
      pairingCode: "fixture-pairing-code",
    });
    expect(mocks.exec).toHaveBeenCalledWith(
      executable(name),
      expect.arrayContaining([
        join(
          "/Applications",
          `${name}.app`,
          "Contents",
          "Resources/app.asar/apps/server/dist/bin.mjs",
        ),
        "--base-dir",
        join("/fixture-home", ".t3"),
      ]),
      expect.any(Object),
    );
  },
);

it("reports a missing installation without invoking a CLI", async () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
  await expect(localPairing()).rejects.toThrow(
    "T3 Code was not found in /Applications",
  );
  expect(mocks.exec).not.toHaveBeenCalled();
});
