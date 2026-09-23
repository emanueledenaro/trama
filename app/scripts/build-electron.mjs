import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

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
