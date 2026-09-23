import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "vite";

const server = await createServer({ configFile: "vite.config.ts" });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? "http://localhost:5733/";

const bundler = spawn(process.execPath, ["scripts/build-electron.mjs"], { stdio: "inherit" });
bundler.on("exit", (code) => {
  if (code !== 0) process.exit(code ?? 1);
  const electronBinary = createRequire(import.meta.url)("electron");
  const app = spawn(electronBinary, ["."], {
    stdio: "inherit",
    env: { ...process.env, TRAMA_RENDERER_URL: url },
  });
  app.on("exit", async (appCode) => {
    await server.close();
    process.exit(appCode ?? 0);
  });
});
