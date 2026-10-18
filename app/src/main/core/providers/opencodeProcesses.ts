import type { ChildProcess } from "node:child_process";

/**
 * Every `opencode serve` Trama started and has not seen exit: none may outlive the process that started it. Without
 * this, a test process or an app that ended before the SIGKILL fallback left the server and its children running, and
 * they piled up by the hundred.
 */
const liveServers = new Set<ChildProcess>();
let exitHooksInstalled = false;

export function trackServer(child: ChildProcess): void {
  liveServers.add(child);
  child.once("exit", () => liveServers.delete(child));
  if (exitHooksInstalled) return;
  exitHooksInstalled = true;
  const cleanup = () => {
    for (const server of liveServers) killGroup(server, "SIGKILL");
  };
  process.once("exit", cleanup);
  // SIGTERM/SIGINT skip Node's exit event. Clean up synchronously, then restore the signal's default exit.
  // SIGKILL cannot run JavaScript cleanup. Windows retains its existing direct-child exit cleanup.
  if (process.platform !== "win32") {
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      process.once(signal, () => {
        cleanup();
        // A once listener is removed before it runs, so sending the signal again does not recurse.
        process.kill(process.pid, signal);
      });
    }
  }
}

/** Signals the server and every process it started: it runs in its own process group off Windows. */
function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already gone.
    }
  }
}

export function stopProcess(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  killGroup(child, "SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) killGroup(child, "SIGKILL");
  }, 1_500).unref();
}

