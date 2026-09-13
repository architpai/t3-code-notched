import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { localOrigin, request, environmentSchema } from "./http";
export async function localPairing(): Promise<{
  origin: string;
  pairingCode: string;
}> {
  if (process.platform !== "darwin")
    throw new Error("T3 local pairing requires macOS. Use a pairing code.");
  const name = ["T3 Code (Nightly)", "T3 Code (Alpha)"].find((name) =>
    existsSync(join("/Applications", `${name}.app`, "Contents", "MacOS", name)),
  );
  if (!name)
    throw new Error(
      "T3 Code was not found in /Applications. Use a pairing code.",
    );
  const app = join("/Applications", `${name}.app`, "Contents");
  const home = join(homedir(), ".t3");
  const data = await readFile(
    join(home, "userdata", "server-runtime.json"),
  ).catch(() => {
    throw new Error(
      "T3 runtime is unavailable. Open T3 Code, or use a pairing code.",
    );
  });
  if (data.length > 8192) throw new Error("T3 runtime file is too large.");
  const runtime = z
    .object({ origin: z.string() })
    .parse(JSON.parse(data.toString()));
  const origin = localOrigin(runtime.origin);
  environmentSchema.parse(
    await request(
      origin,
      "/.well-known/t3/environment",
      null,
      AbortSignal.timeout(10_000),
    ),
  );
  const result = await promisify(execFile)(
    join(app, "MacOS", name),
    [
      join(app, "Resources/app.asar/apps/server/dist/bin.mjs"),
      "auth",
      "pairing",
      "create",
      "--base-dir",
      home,
      "--ttl",
      "5m",
      "--label",
      "T3 Code Notched",
      "--json",
    ],
    {
      timeout: 10_000,
      maxBuffer: 16_384,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    },
  ).catch(() => {
    throw new Error(
      "T3 pairing failed. Use a pairing code from your T3 installation.",
    );
  });
  const grant = z
    .object({ credential: z.string().min(1).max(8192) })
    .parse(JSON.parse(result.stdout));
  return { origin, pairingCode: grant.credential };
}
