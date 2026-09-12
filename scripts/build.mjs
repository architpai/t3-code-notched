import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { build } from "esbuild";
import { build as buildRenderer } from "vite";
export async function buildDesktop() {
  if (process.platform === "darwin") {
    mkdirSync("dist/native", { recursive: true });
    mkdirSync(".local/swift-cache", { recursive: true });
    execFileSync(
      "xcrun",
      [
        "swiftc",
        "-O",
        "-target",
        `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macos12.0`,
        "-module-cache-path",
        ".local/swift-cache",
        "src/native/Notch.swift",
        "-o",
        "dist/native/notch-geometry",
      ],
      { stdio: "inherit" },
    );
  }
  await build({
    entryPoints: ["src/main/index.ts"],
    outfile: "dist/main/index.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    external: ["electron"],
  });
  await build({
    entryPoints: ["src/preload/index.ts"],
    outfile: "dist/preload/index.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
  });
}
if (process.argv[1]?.endsWith("build.mjs")) {
  await buildDesktop();
  await buildRenderer();
  if (process.platform === "darwin") await import("./install-macos.mjs");
}
