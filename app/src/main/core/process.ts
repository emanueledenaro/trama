import { spawn } from "node:child_process";

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Runs a command without a shell, with a timeout and a cap on the captured output. */
export function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; outputLimit?: number } = {},
): Promise<ProcessResult> {
  const limit = options.outputLimit ?? 8 * 1_048_576;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, options.timeoutMs ?? 30_000);
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < limit) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < limit) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr, timedOut });
    });
  });
}

export const GIT_SAFE_OPTIONS = ["-c", "credential.helper=", "-c", "core.hooksPath=/dev/null", "-c", "gc.auto=0"];

export function gitEnvironment(readOnly: boolean): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    ...(readOnly ? { GIT_OPTIONAL_LOCKS: "0" } : {}),
  };
}

export async function git(args: string[], cwd: string, readOnly = true, timeoutMs = 30_000): Promise<string> {
  const result = await runProcess("git", [...GIT_SAFE_OPTIONS, ...args], { cwd, env: gitEnvironment(readOnly), timeoutMs });
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} exited with ${result.exitCode}`);
  return result.stdout;
}
