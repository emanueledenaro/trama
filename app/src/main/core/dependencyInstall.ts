/**
 * The npm dependencies of a developer's worktree (2 October 2026). A developer works with no network, and Trama lends
 * it the dependencies of the project checkout only when that checkout has them (checks.ts). A project created from
 * nothing has none anywhere, so its first slice could write the site but never build or test it. On the developer's
 * request Trama installs them itself into the worktree, outside the sandbox and without install scripts. node_modules
 * must be ignored by git, so the candidate's diff stays the developer's work.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, readFile, rm } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";
import { nodePackage } from "./checks";
import { searchPath } from "./codexClient";
import type { ToolDefinition } from "./toolServer";

const run = promisify(execFile);

/** The developer's tool, beside ask_coordinator. @model-text */
export const INSTALL_DEPENDENCIES_TOOL: ToolDefinition = {
  name: "install_dependencies",
  description:
    "Install the npm dependencies declared in the worktree's package.json (and package-lock.json, when there is one). Your session has no network, so call this after you add or change dependencies instead of running npm install yourself. Trama installs them outside the sandbox, without install scripts, into the worktree's node_modules (which must be in .gitignore). When npm writes or updates package-lock.json, the result says so: commit it with your work. Then run the build and the tests as usual.",
  properties: {},
  required: [],
  readOnly: false,
};

export type InstallOutcome = { ok: true; packages: number; lockfileChanged: boolean } | { ok: false; reason: string };

/** The npm Trama runs: the first one on the search path, or null. */
export function npmExecutable(paths: readonly string[] = searchPath()): string | null {
  for (const folder of paths) {
    const candidate = join(folder, process.platform === "win32" ? "npm.cmd" : "npm");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const defaultInstall = async (npm: string, args: string[], cwd: string) => {
  await run(npm, args, {
    cwd,
    timeout: 600_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, PATH: [dirname(npm), ...searchPath()].join(delimiter), npm_config_update_notifier: "false" },
  });
};

/** Installs the worktree's npm dependencies in place. `install` runs npm (replaced in tests). @model-text */
export async function installNodeDependencies(
  worktreeRoot: string,
  install: (npm: string, args: string[], cwd: string) => Promise<void> = defaultInstall,
  npm: string | null = npmExecutable(),
): Promise<InstallOutcome> {
  const pkg = nodePackage(worktreeRoot);
  if (!pkg) return { ok: false, reason: "The worktree has no package.json: there is nothing to install." };
  if (!npm) return { ok: false, reason: "npm is not installed on this Mac: Trama cannot install the dependencies." };
  const projectDir = join(worktreeRoot, pkg.dir);
  const ignored = await run("git", ["check-ignore", "-q", join(pkg.dir, "node_modules/")], { cwd: worktreeRoot })
    .then(() => true)
    .catch(() => false);
  if (!ignored) {
    return { ok: false, reason: "node_modules is not in .gitignore: add it there, so the dependencies stay out of your work, then call install_dependencies again." };
  }
  const lockfile = join(projectDir, "package-lock.json");
  const lockBefore = await readFile(lockfile, "utf8").catch(() => null);
  // A node_modules of links lent from the checkout is replaced by a real install.
  const existing = await lstat(join(projectDir, "node_modules")).catch(() => null);
  if (existing) await rm(join(projectDir, "node_modules"), { recursive: true, force: true });
  const flags = ["--ignore-scripts", "--no-audit", "--no-fund"];
  try {
    if (lockBefore === null) await install(npm, ["install", ...flags], projectDir);
    else {
      // npm ci refuses a lockfile the developer's new dependencies left behind: npm install then brings it up to date.
      await install(npm, ["ci", ...flags], projectDir).catch(() => install(npm, ["install", ...flags], projectDir));
    }
  } catch (error) {
    // npm says what went wrong first, then its usage: the first lines carry the reason.
    const output = String((error as { stderr?: string }).stderr || (error as Error).message)
      .trim()
      .split("\n")
      .slice(0, 12)
      .join("\n");
    return { ok: false, reason: `npm install failed:\n${output}` };
  }
  const manifest = JSON.parse(await readFile(join(projectDir, "package.json"), "utf8")) as { dependencies?: object; devDependencies?: object };
  const packages = Object.keys(manifest.dependencies ?? {}).length + Object.keys(manifest.devDependencies ?? {}).length;
  const lockAfter = await readFile(lockfile, "utf8").catch(() => null);
  return { ok: true, packages, lockfileChanged: lockAfter !== null && lockAfter !== lockBefore };
}
