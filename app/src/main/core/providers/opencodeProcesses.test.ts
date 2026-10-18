import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { describe, it } from "vitest";

const lifecycleUrl = pathToFileURL(`${import.meta.dirname}/opencodeProcesses.ts`).href;
const idle = "setInterval(() => {}, 1000);";
const serverSource = `
  const { spawn } = require('node:child_process');
  process.on('SIGTERM', () => {});
  // A broken probe must stop itself even if its parent fails before reporting the PIDs.
  setTimeout(() => process.kill(-process.pid, 'SIGKILL'), 10_000).unref();
  const descendant = spawn(process.execPath, ['--title=trama-opencode-lifecycle-descendant', '-e', ${JSON.stringify(idle)}], { stdio: 'ignore' });
  descendant.once('spawn', () => process.send({ descendantPid: descendant.pid }));
  ${idle}
`;
const ownerSource = `
  const { spawn } = await import('node:child_process');
  const { trackServer } = await import(${JSON.stringify(lifecycleUrl)});
  const server = spawn(process.execPath, ['--title=trama-opencode-lifecycle-server', '-e', ${JSON.stringify(serverSource)}], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  trackServer(server);
  server.once('message', ({ descendantPid }) => process.send({ serverPid: server.pid, descendantPid }));
  process.on('message', () => process.exit(23));
`;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilStopped(pid: number): Promise<boolean> {
  const deadline = Date.now() + 2_000;
  while (alive(pid) && Date.now() < deadline) await delay(20);
  return !alive(pid);
}

async function killProbe(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
}

describe("OpenCode server ownership", () => {
  // Windows does not use detached process groups or deliver these POSIX termination signals.
  for (const termination of ["exit", "SIGTERM", "SIGINT"] as const) {
    it.skipIf(process.platform === "win32")(`removes only the owned process tree on ${termination}`, async () => {
      const owner = spawn(process.execPath, ["--title=trama-opencode-lifecycle-owner", "--experimental-strip-types", "--input-type=module", "-e", ownerSource], {
        stdio: ["ignore", "ignore", "inherit", "ipc"],
      });
      const unrelated = spawn(process.execPath, ["--title=trama-opencode-lifecycle-unrelated", "-e", idle], { stdio: "ignore" });
      let serverPid: number | undefined;
      let descendantPid: number | undefined;
      try {
        const [message] = await once(owner, "message", { signal: AbortSignal.timeout(5_000) });
        ({ serverPid, descendantPid } = message as { serverPid: number; descendantPid: number });
        assert.ok(alive(serverPid));
        assert.ok(alive(descendantPid));
        const ownerExited = once(owner, "exit", { signal: AbortSignal.timeout(5_000) });
        if (termination === "exit") owner.send("exit");
        else owner.kill(termination);
        const [code, signal] = await ownerExited;
        if (termination === "exit") assert.equal(code, 23);
        else assert.equal(signal, termination, "the parent must retain its signal termination status");
        assert.equal(await waitUntilStopped(serverPid), true, `server ${serverPid} survived ${termination}`);
        assert.equal(await waitUntilStopped(descendantPid), true, `descendant ${descendantPid} survived ${termination}`);
        assert.ok(unrelated.pid && alive(unrelated.pid), "an unrelated process must remain running");
      } finally {
        // Even a failing regression must not leave its deliberately detached probes on the machine.
        if (serverPid !== undefined) {
          try { process.kill(-serverPid, "SIGKILL"); } catch { /* Already gone. */ }
        }
        if (descendantPid !== undefined) {
          try { process.kill(descendantPid, "SIGKILL"); } catch { /* Already gone. */ }
        }
        await killProbe(owner);
        await killProbe(unrelated);
        if (serverPid !== undefined) assert.equal(await waitUntilStopped(serverPid), true);
        if (descendantPid !== undefined) assert.equal(await waitUntilStopped(descendantPid), true);
      }
    });
  }
});
