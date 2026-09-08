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
  const home = join(homedir(), ".t3");
  const data = await readFile(join(home, "userdata", "server-runtime.json"));
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
  if (process.platform !== "darwin")
    throw new Error("Use a pairing code from T3 on this platform.");
  const app = "/Applications/T3 Code (Alpha).app/Contents";
  const result = await promisify(execFile)(
    join(app, "MacOS/T3 Code (Alpha)"),
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
  );
  const grant = z
    .object({ credential: z.string().min(1).max(8192) })
    .parse(JSON.parse(result.stdout));
  return { origin, pairingCode: grant.credential };
}
