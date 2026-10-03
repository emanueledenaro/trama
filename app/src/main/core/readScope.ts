/**
 * What an agent session may read (issue #206): its working folder, the project it works on and the folders
 * Trama authorizes, such as the bundled skills. Codex's own home, with its memories, the person's other
 * projects and the rest of the home folder stay out, for every provider.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { containedWriteTarget } from "./providers/providerSupport";
import { isInside } from "./providers/types";

/** Codex's home folder, where its configuration, sessions and memories live. */
export function codexHomeDirectory(home = homedir()): string {
  return resolve(process.env.CODEX_HOME || join(home, ".codex"));
}

/** `~`, `~/x`, `$HOME/x` and `${HOME}/x` with the home folder written out; other paths unchanged. */
export function expandHome(path: string, home = homedir()): string {
  if (path === "~" || path === "$HOME" || path === "${HOME}") return home;
  const match = /^(?:~|\$HOME|\$\{HOME\})[\\/](.*)$/.exec(path);
  return match ? join(home, match[1]!) : path;
}

/**
 * The folders a session may read: `cwd` first, then the extra roots Trama authorizes, each resolved and
 * also listed by its real path when a symlink leads there (as `/tmp` on macOS). Duplicates are dropped.
 */
export function readableRoots(cwd: string, extra: readonly string[] = []): string[] {
  const roots: string[] = [];
  for (const root of [cwd, ...extra]) {
    const absolute = resolve(root);
    let real = absolute;
    try {
      real = realpathSync.native(absolute);
    } catch {
      // A missing folder is kept as written: nothing can be read there anyway.
    }
    for (const path of [absolute, real]) if (!roots.includes(path)) roots.push(path);
  }
  return roots;
}

/** True when reading `path` (relative to `cwd`, `~` expanded, symlinks resolved) stays inside one of `roots`. */
export function isReadable(roots: readonly string[], cwd: string, path: string, home = homedir()): boolean {
  const expanded = expandHome(path.replace(/^@/, ""), home);
  const absolute = isAbsolute(expanded) ? expanded : join(cwd, expanded);
  return roots.some((root) => containedWriteTarget(root, absolute) !== null);
}

/** Installation prefixes a shell may read whole: the system's and those of known toolchain installers. */
const SYSTEM_PREFIX = /^\/(?:usr|usr\/local|opt\/homebrew|opt\/local|opt\/[^/]+|nix\/store\/[^/]+)$/;
/** Version managers under the home folder: each pattern names one installed version, relative to the home. */
const HOME_TOOLCHAIN_PREFIXES = [
  /^\.nvm\/versions\/node\/[^/]+$/,
  /^\.volta\/tools\/image\/[^/]+\/[^/]+$/,
  /^\.asdf\/installs\/[^/]+\/[^/]+$/,
  /^\.local\/share\/mise\/installs\/[^/]+\/[^/]+$/,
  /^\.local\/share\/fnm\/node-versions\/[^/]+\/installation$/,
  /^\.pyenv\/versions\/[^/]+$/,
  /^\.rbenv\/versions\/[^/]+$/,
  /^\.rustup\/toolchains\/[^/]+$/,
];

/**
 * Folders of the toolchains on `pathEntries` that a sandboxed shell may read, so a specialist can still run
 * `node`, `git` or `swift`. A `bin` folder brings its installation prefix only when the prefix is a system one
 * (as `/usr` or `/opt/homebrew`) or a version manager's install (as `~/.nvm/versions/node/v22`); any other
 * `bin`, such as a project's added by direnv, is allowed alone. Nothing that holds the home folder or Codex's
 * home is ever allowed.
 */
export function toolchainRoots(pathEntries: readonly string[], home = homedir(), codexHome = codexHomeDirectory(home)): string[] {
  const roots: string[] = [];
  const holdsPrivateData = (folder: string) =>
    folder === dirname(folder) || folder === home || isInside(folder, home) || isInside(folder, codexHome) || isInside(codexHome, folder);
  const knownPrefix = (prefix: string) =>
    isInside(home, prefix) ? HOME_TOOLCHAIN_PREFIXES.some((pattern) => pattern.test(relative(home, prefix).split(sep).join("/"))) : SYSTEM_PREFIX.test(prefix);
  for (const entry of pathEntries) {
    if (!isAbsolute(entry)) continue;
    const bin = resolve(entry);
    const prefix = dirname(bin);
    const candidate = basename(bin) === "bin" && knownPrefix(prefix) ? prefix : bin;
    if (holdsPrivateData(candidate) || roots.includes(candidate)) continue;
    roots.push(candidate);
  }
  return roots;
}

/**
 * The search path of a sandboxed shell: only the folders it may read, in their order, then the system's. A folder the
 * sandbox denies answers EPERM instead of "not found", and a program looked up by name stops there: npm could not
 * start its scripts' `sh` behind ~/.codeium/windsurf/bin (2 October 2026).
 */
export function sandboxSearchPath(entries: readonly string[], readable: readonly string[]): string {
  const kept: string[] = [];
  for (const entry of [...entries, "/usr/bin", "/bin", "/usr/sbin", "/sbin"]) {
    if (!isAbsolute(entry)) continue;
    const folder = resolve(entry);
    const allowed = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"].includes(folder) || readable.some((root) => isInside(root, folder));
    if (allowed && !kept.includes(folder)) kept.push(folder);
  }
  return kept.join(process.platform === "win32" ? ";" : ":");
}

/** Top-level folders of the platform that a sandboxed shell needs; every other one may hold projects or data. */
const SYSTEM_TOP_LEVEL = new Set([
  "bin", "sbin", "usr", "lib", "lib32", "lib64", "libx32", "etc", "dev", "proc", "sys", "run", "tmp", "var", "opt", "nix", "boot",
  "bin.usr-is-merged", "lib.usr-is-merged", "sbin.usr-is-merged", "System", "Library", "Applications", "private", "cores",
]);

/**
 * What a sandbox that works by denial must hide so it matches the readable roots (Claude's command sandbox): the
 * home folder, Codex's home and every top-level folder that is not the platform's, such as `/workspace` or
 * `/Volumes`. The sandbox then allows back the readable roots and the toolchains.
 */
export function deniedReadFolders(home = homedir(), codexHome = codexHomeDirectory(home), topLevel: readonly string[] = listRoot()): string[] {
  const denied = [home, codexHome];
  for (const name of topLevel) {
    const folder = `/${name}`;
    if (!SYSTEM_TOP_LEVEL.has(name) && !denied.some((d) => isInside(d, folder))) denied.push(folder);
  }
  return denied;
}

function listRoot(): string[] {
  try {
    return readdirSync("/");
  } catch {
    return [];
  }
}

/**
 * Paths a shell command names that are private to the person: inside the home folder or Codex's home, but
 * outside every readable root. Used to record reads a sandbox blocked; system folders are not reported.
 * The script text of code interpreters (-c/-e arguments, their heredocs) is not parsed; shell -c arguments are.
 */
export function privatePathsInCommand(command: string, cwd: string, roots: readonly string[], home = homedir(), codexHome = codexHomeDirectory(home)): string[] {
  const cleaned = stripScriptContent(command);
  const found: string[] = [];
  for (const raw of cleaned.split(/[\s;|&()<>`]+/)) {
    const token = raw.replace(/^[^=]*=(?=[~/$])/, "").replace(/^["']+|["']+$/g, "");
    if (!/^(?:~|\$HOME|\$\{HOME\}|\/|\.\.)/.test(token)) continue;
    const expanded = expandHome(token, home);
    const absolute = resolve(cwd, expanded);
    const private_ = isInside(home, absolute) || isInside(codexHome, absolute);
    if (!private_ || roots.some((root) => isInside(root, absolute)) || found.includes(absolute)) continue;
    found.push(absolute);
  }
  return found;
}

const CODE_INTERPRETERS = "python[\\d.]*|nodejs|node|ruby|perl|deno|bun";
const SHELLS = "sh|bash|zsh|dash|ksh";
const COMMAND_START = "(?<![\\w./-])(?:[\\w.~/-]*/)?";
const QUOTED_OR_WORD = `"(?:[^"\\\\]|\\\\.)*"|'[^']*'|[^\\s;|&]+`;
const SHELL_SCRIPT = new RegExp(`${COMMAND_START}(?:${SHELLS})(?:\\s+-[A-Za-z]+)*?\\s+-[A-Za-z]*c[A-Za-z]*\\s+(${QUOTED_OR_WORD})`);
const CODE_SCRIPT = new RegExp(`${COMMAND_START}(?:${CODE_INTERPRETERS})(?:\\s+-[\\w-]+)*?\\s+-[A-Za-z]*[ce]\\s+(?:${QUOTED_OR_WORD})`);
const HEREDOC_OPERATOR = /<<(-?)\s*(['"]?)([A-Za-z_]\w*)\2/g;
const CODE_INTERPRETER_WORD = new RegExp(`${COMMAND_START}(?:${CODE_INTERPRETERS})\\b`);

function unquote(argument: string): string {
  if (argument.startsWith('"')) return argument.slice(1, -1).replace(/\\(["\\$`])/g, "$1");
  if (argument.startsWith("'")) return argument.slice(1, -1);
  return argument;
}

/** The next heredoc that feeds a code interpreter: where its operator starts and ends, and where its body ends. */
function nextCodeHeredoc(text: string): { start: number; operatorEnd: number; bodyEnd: number } | null {
  for (const match of text.matchAll(HEREDOC_OPERATOR)) {
    const start = match.index!;
    const lineStart = Math.max(text.lastIndexOf("\n", start), -1) + 1;
    const segment = text.slice(lineStart, start).split(/[;|&(]/).pop() ?? "";
    if (!CODE_INTERPRETER_WORD.test(segment)) continue;
    const operatorEnd = start + match[0].length;
    const newline = text.indexOf("\n", operatorEnd);
    if (newline < 0) continue;
    const closing = new RegExp(`\\n${match[1] ? "\\t*" : ""}${match[3]}(?=\\n|$)`).exec(text.slice(newline));
    // An heredoc with no closing delimiter is left to the analysis rather than swallowing the rest of the command.
    if (!closing) continue;
    return { start, operatorEnd, bodyEnd: newline + closing.index + closing[0].length };
  }
  return null;
}

/**
 * Remove the script text of code interpreters from a command: the -c/-e argument of python, node, ruby, perl, deno
 * and bun, and the body of a heredoc that feeds one, up to the line that repeats its delimiter. A shell's -c argument
 * is a command, so it is analysed again the same way. Any other heredoc (`cat <<EOF`) stays in the text.
 */
function stripScriptContent(command: string, depth = 0): string {
  if (depth > 5) return command;
  let rest = command;
  let result = "";
  for (;;) {
    const shell = SHELL_SCRIPT.exec(rest);
    const code = CODE_SCRIPT.exec(rest);
    const heredoc = nextCodeHeredoc(rest);
    const starts = [shell?.index ?? Infinity, code?.index ?? Infinity, heredoc?.start ?? Infinity];
    const first = Math.min(...starts);
    if (first === Infinity) return result + rest;
    if (first === starts[0]) {
      result += `${rest.slice(0, first)} ; ${stripScriptContent(unquote(shell![1]!), depth + 1)} ; `;
      rest = rest.slice(first + shell![0].length);
    } else if (first === starts[1]) {
      result += `${rest.slice(0, first)} `;
      rest = rest.slice(first + code![0].length);
    } else {
      const newline = rest.indexOf("\n", heredoc!.operatorEnd);
      result += `${rest.slice(0, heredoc!.start)} ${rest.slice(heredoc!.operatorEnd, newline)}\n`;
      rest = rest.slice(heredoc!.bodyEnd);
    }
  }
}

/** The permission profiles Trama gives each Codex thread: one for read-only turns, one for the worktree. */
export const CODEX_READ_PROFILE = "trama_read";
export const CODEX_WRITE_PROFILE = "trama_write";

/**
 * Codex permission profiles (`permissions.<id>` in the thread config): the platform's minimal folders, the
 * readable roots and nothing else, with no network. The write profile can also write `writableRoot` only.
 */
/**
 * System folders every runtime reads as it starts, beyond Codex's minimal set: OpenSSL's configuration and the
 * certificates. Without them `node` fails before running anything ("OpenSSL configuration error ... fopen
 * /System/Library/OpenSSL/openssl.cnf: Operation not permitted"), so a JavaScript project could not run its checks
 * (2 October 2026). They hold no data of the person.
 */
export const SYSTEM_READ_ROOTS = process.platform === "darwin" ? ["/System/Library/OpenSSL", "/private/etc/ssl", "/etc/ssl"] : ["/etc/ssl", "/usr/lib/ssl"];

/**
 * Where Playwright keeps the browsers it downloaded, when the folder is there. A project's browser tests launch them
 * from there; without reading it Playwright stops before the browser starts (2 October 2026). Binaries, no data.
 */
export function browserCacheRoots(home = homedir(), env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] {
  const folder = env.PLAYWRIGHT_BROWSERS_PATH
    ? env.PLAYWRIGHT_BROWSERS_PATH
    : platform === "darwin"
      ? join(home, "Library", "Caches", "ms-playwright")
      : platform === "win32"
        ? join(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "ms-playwright")
        : join(env.XDG_CACHE_HOME ?? join(home, ".cache"), "ms-playwright");
  return existsSync(folder) ? [folder] : [];
}

/**
 * The developer's own temporary folder for a worktree, outside it so nothing lands in the work's diff. Tools write
 * their scratch files under TMPDIR, which the sandbox otherwise refuses (Playwright, 2 October 2026).
 */
export function agentTempFolder(writableRoot: string, base = tmpdir()): string {
  const folder = join(realpathSync(base), "trama-agents", createHash("sha256").update(resolve(writableRoot)).digest("hex").slice(0, 16));
  mkdirSync(folder, { recursive: true });
  return folder;
}

export function codexPermissionProfiles(
  roots: readonly string[],
  writableRoot: string | null,
  tempRoot: string | null = null,
): Record<string, { filesystem: Record<string, string>; network: { enabled: false } }> {
  const read: Record<string, string> = { ":minimal": "read" };
  for (const root of SYSTEM_READ_ROOTS) read[root] = "read";
  for (const root of roots) read[root] = "read";
  const profiles: Record<string, { filesystem: Record<string, string>; network: { enabled: false } }> = {
    [`permissions.${CODEX_READ_PROFILE}`]: { filesystem: read, network: { enabled: false } },
  };
  if (writableRoot) {
    const write = { ...read };
    for (const root of readableRoots(writableRoot)) write[root] = "write";
    if (tempRoot) write[tempRoot] = "write";
    profiles[`permissions.${CODEX_WRITE_PROFILE}`] = { filesystem: write, network: { enabled: false } };
  }
  return profiles;
}

/** The name and email git would sign a commit with, read outside the sandbox; null when git has none. */
export interface GitIdentity {
  name: string;
  email: string;
}

let hostIdentity: GitIdentity | null | undefined;

/** The person's git identity from their global configuration, read once. */
export function hostGitIdentity(): GitIdentity | null {
  if (hostIdentity !== undefined) return hostIdentity;
  const read = (key: string) => {
    const result = spawnSync("git", ["config", "--global", "--get", key], { encoding: "utf8", timeout: 3_000 });
    return result.status === 0 ? result.stdout.trim() : "";
  };
  const name = read("user.name");
  const email = read("user.email");
  hostIdentity = name && email ? { name, email } : null;
  return hostIdentity;
}

/**
 * Git's environment in a sandboxed shell (issue #391). The sandbox hides the home folder, so git could not read
 * `~/.gitconfig` and each command failed with an access error. There git reads no global file at all; the person's
 * identity, read by Trama outside the sandbox, still signs any commit made there.
 */
export function sandboxGitEnvironment(identity: GitIdentity | null = hostGitIdentity()): Record<string, string> {
  return {
    GIT_CONFIG_GLOBAL: "/dev/null",
    ...(identity
      ? { GIT_AUTHOR_NAME: identity.name, GIT_AUTHOR_EMAIL: identity.email, GIT_COMMITTER_NAME: identity.name, GIT_COMMITTER_EMAIL: identity.email }
      : {}),
  };
}
