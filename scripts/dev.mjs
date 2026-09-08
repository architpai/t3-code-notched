import { createServer } from "vite";
import { spawn } from "node:child_process";
import electron from "electron";
import { buildDesktop } from "./build.mjs";
await buildDesktop();
const server = await createServer();
await server.listen();
const env = { ...process.env, NOTCHED_DEV_URL: "http://127.0.0.1:5178" };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [".", ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
});
child.on("exit", async (code) => {
  await server.close();
  process.exitCode = code ?? 0;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
