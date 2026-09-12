import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

if (process.platform !== "darwin")
  throw new Error("Local app installation requires macOS.");
const marker = ".local/install-macos";
if (process.argv.includes("--enable")) {
  mkdirSync(".local", { recursive: true });
  writeFileSync(marker, "Install production builds in /Applications.\n");
  execFileSync(process.execPath, ["scripts/build.mjs"], { stdio: "inherit" });
} else if (existsSync(marker)) {
  execFileSync(
    process.execPath,
    [
      "node_modules/electron-builder/out/cli/cli.js",
      "--mac",
      "--dir",
      "-c.mac.identity=-",
    ],
    {
      stdio: "inherit",
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
    },
  );
  const name = "T3 Code Notched.app";
  const source = join(
    "release",
    process.arch === "arm64" ? "mac-arm64" : "mac",
    name,
  );
  const destination = join("/Applications", name);
  const staging = mkdtempSync("/Applications/.notched-install-");
  const next = join(staging, name);
  const previous = join(staging, "previous.app");
  try {
    execFileSync("ditto", [source, next]);
    execFileSync("codesign", ["--verify", "--deep", "--strict", next]);
    if (existsSync(destination)) renameSync(destination, previous);
    try {
      renameSync(next, destination);
    } catch (error) {
      if (existsSync(previous)) renameSync(previous, destination);
      throw error;
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  execFileSync(
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
    ["-f", destination],
  );
  console.log(`Installed ${destination}`);
}
