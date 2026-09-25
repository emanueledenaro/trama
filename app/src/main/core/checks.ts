import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, readlink, realpath, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { git, runProcess } from "./process";

export type ReadOnlyCheck = "git_status" | "git_diff_check" | "swift_build" | "swift_test" | "node_test" | "node_typecheck";

export const CHECKS: Record<ReadOnlyCheck, { summary: string; title: string }> = {
  git_status: { summary: "uncommitted changes and branch of the checkout", title: "stato Git" },
  git_diff_check: { summary: "whitespace errors and conflict markers in the uncommitted changes", title: "spazi e marcatori di conflitto" },
  swift_build: { summary: "swift build of the package", title: "swift build" },
  swift_test: { summary: "swift test of the package", title: "swift test" },
  node_test: { summary: "npm test of the Node package", title: "test Node" },
  node_typecheck: { summary: "npm run typecheck of the Node package", title: "typecheck Node" },
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

/**
 * The Node package of the checkout: the root when it has a package.json, otherwise the first direct
 * subfolder that has one (as `app/` in Trama). Returns its path relative to the root and its scripts.
 */
export function nodePackage(root: string): { dir: string; scripts: Record<string, string> } | null {
  const read = (dir: string) => {
    try {
      const pkg = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")) as { scripts?: Record<string, string> };
      return { dir, scripts: pkg.scripts ?? {} };
    } catch {
      return null;
    }
  };
  if (existsSync(join(root, "package.json"))) return read("");
  let entries: string[] = [];
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
      .map((e) => e.name)
      .sort();
  } catch {
    return null;
  }
  for (const name of entries) if (existsSync(join(root, name, "package.json"))) return read(name);
  return null;
}

export function availableChecks(root: string): ReadOnlyCheck[] {
  const checks: ReadOnlyCheck[] = [];
  if (existsSync(join(root, ".git"))) checks.push("git_status", "git_diff_check");
  if (existsSync(join(root, "Package.swift"))) checks.push("swift_build", "swift_test");
  const pkg = nodePackage(root);
  if (pkg?.scripts.test) checks.push("node_test");
  if (pkg?.scripts.typecheck) checks.push("node_typecheck");
  return checks;
}

export function checkCommand(check: ReadOnlyCheck, root: string, scratch: string): string[] {
  switch (check) {
    case "git_status":
      return ["git", "-C", root, "--no-optional-locks", "status", "--porcelain=v1", "--branch", "--untracked-files=normal"];
    case "git_diff_check":
      return ["git", "-C", root, "--no-optional-locks", "diff", "--check", "HEAD"];
    case "node_test":
    case "node_typecheck": {
      const pkg = nodePackage(root);
      return ["npm", "--prefix", join(root, pkg?.dir ?? ""), "run", check === "node_test" ? "test" : "typecheck"];
    }
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

function scratchEnv(scratch: string): string[] {
  return [
    "/usr/bin/env",
    `TMPDIR=${join(scratch, "tmp")}/`,
    `XDG_CACHE_HOME=${join(scratch, "xdg")}`,
    `npm_config_cache=${join(scratch, "npm")}`,
    "npm_config_update_notifier=false",
    "npm_config_offline=true",
  ];
}

/** Wraps a command in Codex's sandbox: read-only everywhere, writable only in `scratch`, no network at all. */
export function sandboxedCommand(codexExecutable: string, command: string[], scratch: string): string[] {
  const profile = `permissions.${PROFILE}={extends=":read-only",filesystem={":workspace_roots"={"."="write"}},network={enabled=false}}`;
  return [codexExecutable, "sandbox", "-P", PROFILE, "-C", scratch, "--include-managed-config", "-c", profile, "--", ...scratchEnv(scratch), ...command];
}

/**
 * Seatbelt profile of Trama's own sandbox on macOS: writes only in SCRATCH, IP only on loopback.
 * Rules checked on macOS 26 with a direct connect to 1.1.1.1: `(deny network*)` alone also blocks listen on
 * 127.0.0.1, and a broad `(allow network* (local ip "localhost:*"))` reopens internet too, so bind, inbound
 * and outbound are allowed one by one. Outbound unix sockets stay denied: allowing them reopened internet.
 * SCRATCH must be a real path, since Seatbelt matches resolved paths.
 */
export const LOCAL_NETWORK_PROFILE = `(version 1)
(allow default)
(deny file-write*)
(allow file-write* (subpath (param "SCRATCH")) (literal "/dev/null") (literal "/dev/zero") (regex #"^/dev/tty") (subpath "/dev/fd"))
(deny network*)
(allow network-bind (local ip "localhost:*"))
(allow network-inbound (local ip "localhost:*"))
(allow network-outbound (remote ip "localhost:*"))`;

export type LocalSandbox = { kind: "seatbelt"; executable: string } | { kind: "bubblewrap"; executable: string };

let detectedSandbox: Promise<LocalSandbox | null> | null = null;

/**
 * Trama's own sandbox for checks that need a local server (Node tests): sandbox-exec on macOS, bubblewrap
 * with a private network namespace (loopback only) on Linux. Windows has no equivalent that a desktop app
 * can start without administrator rights, so there, and when bubblewrap is missing or refused by the
 * kernel, checks stay in Codex's sandbox, which also blocks loopback.
 */
export function detectLocalSandbox(): Promise<LocalSandbox | null> {
  detectedSandbox ??= (async () => {
    if (process.platform === "darwin") return existsSync("/usr/bin/sandbox-exec") ? { kind: "seatbelt", executable: "/usr/bin/sandbox-exec" } : null;
    if (process.platform !== "linux") return null;
    for (const executable of ["/usr/bin/bwrap", "/usr/local/bin/bwrap"]) {
      if (!existsSync(executable)) continue;
      const probe = await runProcess(executable, [...bubblewrapArgs("/tmp"), "/bin/true"], { cwd: "/", timeoutMs: 10_000 }).catch(() => null);
      return probe?.exitCode === 0 ? { kind: "bubblewrap", executable } : null;
    }
    return null;
  })();
  return detectedSandbox;
}

function bubblewrapArgs(scratch: string): string[] {
  return ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--bind", scratch, scratch, "--unshare-net", "--die-with-parent", "--"];
}

/** Wraps a command in Trama's sandbox: read-only everywhere, writable only in `scratch`, network only on loopback. */
export function localSandboxedCommand(sandbox: LocalSandbox, command: string[], scratch: string): string[] {
  const prefix =
    sandbox.kind === "seatbelt"
      ? [sandbox.executable, "-p", LOCAL_NETWORK_PROFILE, "-D", `SCRATCH=${scratch}`]
      : [sandbox.executable, ...bubblewrapArgs(scratch)];
  return [...prefix, ...scratchEnv(scratch), ...command];
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

/**
 * A worktree has no node_modules and the sandbox has no network, so Trama lends it the dependencies of the
 * project checkout, only when both lockfiles match. node_modules is a real folder (a `node_modules/` ignore
 * rule does not match a symlink) holding one link per package, so git keeps ignoring it and the candidate's
 * diff and status stay the same. Returns why it could not, or null when the dependencies are in place.
 */
export async function lendNodeDependencies(worktreeRoot: string, projectRoot: string): Promise<string | null> {
  const pkg = nodePackage(worktreeRoot);
  if (!pkg) return null;
  const target = join(worktreeRoot, pkg.dir, "node_modules");
  const exists = await lstat(target).then(() => true).catch(() => false);
  if (exists) return null;
  const source = join(projectRoot, pkg.dir, "node_modules");
  if (!existsSync(source)) return "Il checkout del progetto non ha le dipendenze installate (node_modules): esegui npm ci nel progetto.";
  const lock = async (root: string) => readFile(join(root, pkg.dir, "package-lock.json"), "utf8").catch(() => null);
  const [mine, theirs] = await Promise.all([lock(worktreeRoot), lock(projectRoot)]);
  if (mine === null || mine !== theirs) {
    return "Le dipendenze del candidato sono diverse da quelle del checkout (package-lock.json): servirebbe npm ci, che le verifiche non eseguono perché non hanno rete.";
  }
  await mkdir(target);
  const ignored = await git(["check-ignore", "-q", join(pkg.dir, "node_modules/")], worktreeRoot).then(() => true).catch(() => false);
  if (!ignored) {
    await rm(target, { recursive: true, force: true });
    return "git non ignora node_modules in questo progetto: Trama non collega le dipendenze per non cambiare il candidato.";
  }
  for (const entry of await readdir(source)) {
    if (!TOOL_CACHES.includes(entry)) await symlink(join(source, entry), join(target, entry));
  }
  return null;
}

/** Folders build tools write inside node_modules (Vite and Vitest), which is read-only in the sandbox. */
const TOOL_CACHES = [".vite", ".vite-temp"];

/** Points the tool caches of node_modules at the check's scratch folder, the only place the sandbox lets it write. */
async function redirectToolCaches(nodeModules: string, scratch: string): Promise<void> {
  if (!existsSync(nodeModules)) return;
  for (const name of TOOL_CACHES) {
    const link = join(nodeModules, name);
    const target = join(scratch, "node-cache", name);
    await mkdir(target, { recursive: true });
    const existing = await lstat(link).catch(() => null);
    // A real folder belongs to the person's own tooling; a link elsewhere is a stale redirect, pointed again here.
    if (existing && !existing.isSymbolicLink()) continue;
    if (existing && (await readlink(link)) === target) continue;
    if (existing) await rm(link);
    await symlink(target, link);
  }
}

export async function runReadOnlyCheck(
  check: ReadOnlyCheck,
  checkoutRoot: string,
  options: { codexExecutable: string; scratchRoot: string; timeoutMs?: number; dependencyRoot?: string | null; localSandbox?: LocalSandbox | null },
): Promise<CheckResult> {
  const root = await realpath(checkoutRoot);
  if (!availableChecks(root).includes(check)) throw new Error(`The check ${check} does not apply to this project.`);
  if ((check === "node_test" || check === "node_typecheck") && options.dependencyRoot) {
    const refused = await lendNodeDependencies(root, options.dependencyRoot);
    if (refused) {
      const head = (await git(["rev-parse", "--verify", "HEAD"], root).catch(() => "")).trim() || null;
      return { check, command: [], exitCode: -1, output: refused, durationMs: 0, headSHA: head, checkoutUnchanged: true };
    }
  }
  const key = createHash("sha256").update(root).digest("hex").slice(0, 16);
  const scratch = join(options.scratchRoot, key);
  for (const sub of ["", "tmp", "xdg", "cache"]) await mkdir(join(scratch, sub), { recursive: true, mode: 0o700 });
  const resolvedScratch = await realpath(scratch);
  const rel = relative(root, resolvedScratch);
  if (resolvedScratch === homedir() || !rel.startsWith("..") || !relative(resolvedScratch, root).startsWith("..")) {
    throw new Error("The scratch directory overlaps the checkout.");
  }
  const isNode = check === "node_test" || check === "node_typecheck";
  if (isNode) await redirectToolCaches(join(root, nodePackage(root)?.dir ?? "", "node_modules"), resolvedScratch);
  const inner = checkCommand(check, root, resolvedScratch);
  // Node tests often open a server on 127.0.0.1: they get Trama's sandbox, which keeps loopback, when the system has one.
  const local = isNode ? (options.localSandbox === undefined ? await detectLocalSandbox() : options.localSandbox) : null;
  const [executable, ...args] = local ? localSandboxedCommand(local, inner, resolvedScratch) : sandboxedCommand(options.codexExecutable, inner, resolvedScratch);
  const before = await checkoutState(root);
  const started = Date.now();
  const result = await runProcess(executable!, args, { cwd: resolvedScratch, timeoutMs: options.timeoutMs ?? CHECK_TIMEOUT_MS });
  const after = await checkoutState(root);
  const head = existsSync(join(root, ".git")) ? (await git(["rev-parse", "--verify", "HEAD"], root).catch(() => "")).trim() || null : null;
  const raw = result.stdout + result.stderr;
  // Say so when a failure comes from the sandbox, not from the code.
  const sandboxNote = !/listen EPERM|connect EPERM/.test(raw)
    ? ""
    : local
      ? "\n[Trama] Alcuni fallimenti vengono dalla sandbox: la rete è permessa solo verso 127.0.0.1, internet è bloccato."
      : "\n[Trama] Alcuni fallimenti vengono dalla sandbox senza rete: su questo sistema Trama non ha una sandbox che lasci la rete locale, quindi i test che aprono un server su 127.0.0.1 non possono girare qui.";
  return {
    check,
    command: inner,
    exitCode: result.timedOut ? -1 : result.exitCode,
    output: tail(raw + (result.timedOut ? "\n[timeout]" : "")) + sandboxNote,
    durationMs: Date.now() - started,
    headSHA: head,
    checkoutUnchanged: before !== null && before === after,
  };
}
