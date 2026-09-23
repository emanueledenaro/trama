import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  external: ["electron"],
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
