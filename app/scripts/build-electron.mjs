import { execFileSync } from "node:child_process";
import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

// The short commit of the build, shown next to the version in Informazioni su Trama; empty outside git.
function buildCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  // Provider SDKs stay in node_modules: they spawn bundled CLIs and are loaded lazily with import().
  external: [
    "electron",
    "@anthropic-ai/claude-agent-sdk",
    "@agentclientprotocol/sdk",
    "@opencode-ai/sdk",
    "@opencode-ai/sdk/*",
    "@earendil-works/*",
  ],
  logLevel: "info",
  define: { __TRAMA_COMMIT__: JSON.stringify(buildCommit()) },
};

const configs = [
  { ...shared, entryPoints: ["src/main/main.ts"], outfile: "dist-electron/main.cjs" },
  { ...shared, entryPoints: ["src/preload/preload.ts"], outfile: "dist-electron/preload.cjs" },
];

if (watch) {
  for (const config of configs) {
    const ctx = await context(config);
    await ctx.watch();
  }
} else {
  await Promise.all(configs.map((config) => build(config)));
}
