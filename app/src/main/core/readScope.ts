/**
 * What an agent session may read (issue #206): its working folder, the project it works on and the folders
 * Trama authorizes, such as the bundled skills. Codex's own home, with its memories, the person's other
 * projects and the rest of the home folder stay out, for every provider.
 */
import { readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
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
 */
export function privatePathsInCommand(command: string, cwd: string, roots: readonly string[], home = homedir(), codexHome = codexHomeDirectory(home)): string[] {
  const found: string[] = [];
  for (const raw of command.split(/[\s;|&()<>`]+/)) {
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

/** The permission profiles Trama gives each Codex thread: one for read-only turns, one for the worktree. */
export const CODEX_READ_PROFILE = "trama_read";
export const CODEX_WRITE_PROFILE = "trama_write";

/**
 * Codex permission profiles (`permissions.<id>` in the thread config): the platform's minimal folders, the
 * readable roots and nothing else, with no network. The write profile can also write `writableRoot` only.
 */
export function codexPermissionProfiles(roots: readonly string[], writableRoot: string | null): Record<string, { filesystem: Record<string, string>; network: { enabled: false } }> {
  const read: Record<string, string> = { ":minimal": "read" };
  for (const root of roots) read[root] = "read";
  const profiles: Record<string, { filesystem: Record<string, string>; network: { enabled: false } }> = {
    [`permissions.${CODEX_READ_PROFILE}`]: { filesystem: read, network: { enabled: false } },
  };
  if (writableRoot) {
    const write = { ...read };
    for (const root of readableRoots(writableRoot)) write[root] = "write";
    profiles[`permissions.${CODEX_WRITE_PROFILE}`] = { filesystem: write, network: { enabled: false } };
  }
  return profiles;
}
