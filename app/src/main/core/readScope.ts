/**
 * What an agent session may read (issue #206): its working folder, the project it works on and the folders
 * Trama authorizes, such as the bundled skills. Codex's own home, with its memories, the person's other
 * projects and the rest of the home folder stay out, for every provider.
 */
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
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

/**
 * Folders of the toolchains on `pathEntries` that a sandboxed shell may read, so a specialist can still run
 * `node`, `git` or `swift`. A `bin` folder brings its installation prefix (as `~/.nvm/versions/node/v22`),
 * but never the home folder, one of its direct children (as `~/.local`) or anything holding Codex's home:
 * there only the `bin` folder itself is allowed.
 */
export function toolchainRoots(pathEntries: readonly string[], home = homedir(), codexHome = codexHomeDirectory(home)): string[] {
  const roots: string[] = [];
  const holdsPrivateData = (folder: string) =>
    folder === dirname(folder) || isInside(folder, home) || isInside(folder, codexHome) || isInside(codexHome, folder);
  for (const entry of pathEntries) {
    if (!isAbsolute(entry)) continue;
    const bin = resolve(entry);
    const prefix = basename(bin) === "bin" ? dirname(bin) : bin;
    const candidate = holdsPrivateData(prefix) || dirname(prefix) === home ? bin : prefix;
    if (holdsPrivateData(candidate) || roots.includes(candidate)) continue;
    roots.push(candidate);
  }
  return roots;
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
