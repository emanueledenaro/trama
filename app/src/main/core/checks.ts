import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { git, runProcess } from "./process";

export type ReadOnlyCheck = "git_status" | "git_diff_check" | "swift_build" | "swift_test";

export const CHECKS: Record<ReadOnlyCheck, { summary: string; title: string }> = {
  git_status: { summary: "uncommitted changes and branch of the checkout", title: "stato Git" },
  git_diff_check: { summary: "whitespace errors and conflict markers in the uncommitted changes", title: "spazi e marcatori di conflitto" },
  swift_build: { summary: "swift build of the package", title: "swift build" },
  swift_test: { summary: "swift test of the package", title: "swift test" },
};

export const ALL_CHECKS = Object.keys(CHECKS) as ReadOnlyCheck[];
export const MAXIMUM_OUTPUT_BYTES = 16_000;
export const CHECK_TIMEOUT_MS = 600_000;
const PROFILE = "trama_check_sandbox_v1";

export interface CheckResult {
  check: ReadOnlyCheck;
  command: string[];
  exitCode: number;
  output: string;
  durationMs: number;
  headSHA: string | null;
  checkoutUnchanged: boolean;
}

export function availableChecks(root: string): ReadOnlyCheck[] {
  const checks: ReadOnlyCheck[] = [];
  if (existsSync(join(root, ".git"))) checks.push("git_status", "git_diff_check");
  if (existsSync(join(root, "Package.swift"))) checks.push("swift_build", "swift_test");
  return checks;
}

export function checkCommand(check: ReadOnlyCheck, root: string, scratch: string): string[] {
  switch (check) {
    case "git_status":
      return ["git", "-C", root, "--no-optional-locks", "status", "--porcelain=v1", "--branch", "--untracked-files=normal"];
    case "git_diff_check":
      return ["git", "-C", root, "--no-optional-locks", "diff", "--check", "HEAD"];
    case "swift_build":
    case "swift_test":
      return [
        ...(process.platform === "darwin" ? ["/usr/bin/xcrun", "swift"] : ["swift"]),
        check === "swift_build" ? "build" : "test",
        "--package-path",
        root,
        "--scratch-path",
        join(scratch, ".build"),
        "--cache-path",
        join(scratch, "cache"),
        "--disable-sandbox",
      ];
  }
}

/** Wraps a command in Codex's sandbox: read-only everywhere, writable only in `scratch`, no network. */
export function sandboxedCommand(codexExecutable: string, command: string[], scratch: string): string[] {
  const profile = `permissions.${PROFILE}={extends=":read-only",filesystem={":workspace_roots"={"."="write"}},network={enabled=false}}`;
  return [
    codexExecutable,
    "sandbox",
    "-P",
    PROFILE,
    "-C",
    scratch,
    "--include-managed-config",
    "-c",
    profile,
    "--",
    "/usr/bin/env",
    `TMPDIR=${join(scratch, "tmp")}/`,
    `XDG_CACHE_HOME=${join(scratch, "xdg")}`,
    ...command,
  ];
}

async function checkoutState(root: string): Promise<string | null> {
  if (!existsSync(join(root, ".git"))) return "";
  try {
    const status = await git(["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all"], root);
    const head = await git(["rev-parse", "--verify", "HEAD"], root).catch(() => "");
    return `${head.trim()}\n${status}`;
  } catch {
    return null;
  }
}

const tail = (text: string) => {
  const buffer = Buffer.from(text, "utf8");
  return buffer.length <= MAXIMUM_OUTPUT_BYTES ? text : `…${buffer.subarray(buffer.length - MAXIMUM_OUTPUT_BYTES).toString("utf8")}`;
};

export async function runReadOnlyCheck(
  check: ReadOnlyCheck,
  checkoutRoot: string,
  options: { codexExecutable: string; scratchRoot: string; timeoutMs?: number },
): Promise<CheckResult> {
  const root = await realpath(checkoutRoot);
  if (!availableChecks(root).includes(check)) throw new Error(`The check ${check} does not apply to this project.`);
  const key = createHash("sha256").update(root).digest("hex").slice(0, 16);
  const scratch = join(options.scratchRoot, key);
  for (const sub of ["", "tmp", "xdg", "cache"]) await mkdir(join(scratch, sub), { recursive: true, mode: 0o700 });
  const resolvedScratch = await realpath(scratch);
  const rel = relative(root, resolvedScratch);
  if (resolvedScratch === homedir() || !rel.startsWith("..") || !relative(resolvedScratch, root).startsWith("..")) {
    throw new Error("The scratch directory overlaps the checkout.");
  }
  const inner = checkCommand(check, root, resolvedScratch);
  const [executable, ...args] = sandboxedCommand(options.codexExecutable, inner, resolvedScratch);
  const before = await checkoutState(root);
  const started = Date.now();
  const result = await runProcess(executable!, args, { cwd: resolvedScratch, timeoutMs: options.timeoutMs ?? CHECK_TIMEOUT_MS });
  const after = await checkoutState(root);
  const head = existsSync(join(root, ".git")) ? (await git(["rev-parse", "--verify", "HEAD"], root).catch(() => "")).trim() || null : null;
  return {
    check,
    command: inner,
    exitCode: result.timedOut ? -1 : result.exitCode,
    output: tail(result.stdout + result.stderr + (result.timedOut ? "\n[timeout]" : "")),
    durationMs: Date.now() - started,
    headSHA: head,
    checkoutUnchanged: before !== null && before === after,
  };
}
