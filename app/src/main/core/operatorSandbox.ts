import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, normalize } from "node:path";

/**
 * The sandbox of the Operator's commands on macOS (issue #597). The commands run outside the provider's sandbox, with
 * the network and the person's files, but they are Trama's children: macOS gives them Trama's own permissions for
 * Accessibility and Screen Recording. So they run inside a profile of `sandbox-exec` that keeps out what would let a
 * command act in place of the person, whatever the script does and however its words are hidden:
 *
 * - Trama's data (the projects' documents with the consents, the mandate and the approvals, the settings, Electron's
 *   profile) and Trama's installation: never read, written or run;
 * - the system's permissions database: never read or written;
 * - Apple Events (AppleScript, JXA, System Events) and the window server (synthetic clicks and keys, windows): no
 *   command drives another app or the screen; the screen goes through the Operator's own tools, which never touch Trama;
 * - Launch Services (`open`) and the launch agents: no command starts Trama or a job outside the sandbox.
 *
 * The rest of the system stays as it is: the project, the network, the developer tools. A profile that does not start
 * stops the command: nothing runs outside it. Other systems have no such sandbox: there the check on the words
 * (`tramaGuard.ts`) is the line, and the report on the checks says so.
 */

export interface SandboxPlan {
  /** Folders a command never reads, writes or runs. */
  hidden: readonly string[];
  /** Folders a command never writes. */
  readOnly: readonly string[];
  /** The project, open even when it sits inside a hidden folder (Trama keeps the demo project in its data). */
  open?: readonly string[];
}

export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

/** Programs that start work outside the sandbox or drive the Mac by script: a command never runs them, however named. */
const BLOCKED_PROGRAMS = ["/bin/launchctl", "/usr/bin/osascript", "/usr/bin/automator", "/usr/bin/shortcuts", "/usr/bin/tccutil", "/usr/bin/crontab", "/usr/bin/at", "/usr/bin/batch", "/usr/bin/open"];

/** The fixed part of the profile: everything is allowed but what lets a command act for the person. */
const RULES = [
  "(version 1)",
  "(allow default)",
  // No Apple Events: AppleScript and JXA reach no app, System Events included.
  "(deny appleevent-send)",
  // No window server, no Launch Services: no synthetic click or key, no window, no app started outside the sandbox.
  '(deny mach-lookup (global-name "com.apple.windowserver.active") (global-name "com.apple.coreservices.appleevents") (global-name "com.apple.coreservices.launchservicesd"))',
  // The old path for synthetic input.
  '(deny iokit-open (iokit-user-client-class "IOHIDParamUserClient"))',
  `(deny process-exec ${BLOCKED_PROGRAMS.map((path) => `(literal "${path}")`).join(" ")})`,
];

/** The real paths of a folder: as written and as the system resolves it (`/var` is `/private/var` on macOS). */
function realPaths(path: string, realpath: (path: string) => string | null): string[] {
  const written = normalize(path);
  return [...new Set([written, realpath(written) ?? written])];
}

const defaultRealpath = (path: string): string | null => {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
};

/**
 * The profile and its parameters for `sandbox-exec`. The paths travel as parameters (`-D NAME=path`), never written into
 * the profile, so no path can change its rules. Pure but for the lookup of real paths, which is injected.
 */
export function sandboxProfile(plan: SandboxPlan, realpath: (path: string) => string | null = defaultRealpath): { profile: string; params: string[] } {
  const params: string[] = [];
  const rules = [...RULES];
  const add = (prefix: string, paths: readonly string[]): string[] =>
    [...new Set(paths.filter(Boolean).flatMap((path) => realPaths(path, realpath)))].map((path) => {
      const name = `${prefix}_${params.length / 2}`;
      params.push("-D", `${name}=${path}`);
      return `(subpath (param "${name}"))`;
    });
  const hidden = add("HIDDEN", plan.hidden);
  if (hidden.length) rules.push(`(deny file-read* file-write* process-exec ${hidden.join(" ")})`);
  const readOnly = add("READONLY", plan.readOnly);
  if (readOnly.length) rules.push(`(deny file-write* ${readOnly.join(" ")})`);
  // The last rule that matches decides: the project stays open inside a hidden folder, and nothing else does.
  // Only a project inside a hidden folder: one that holds a hidden folder (the home folder) would open it again.
  const open = add("OPEN", (plan.open ?? []).filter((path) => plan.hidden.some((folder) => normalize(path).startsWith(normalize(folder) + "/"))));
  if (open.length && hidden.length) rules.push(`(allow file-read* file-write* process-exec ${open.join(" ")})`);
  return { profile: rules.join("\n"), params };
}

/** The folders of the system the sandbox always keeps: the permissions database and the launch agents. */
export function systemPlaces(home = homedir()): SandboxPlan {
  return {
    hidden: [join(home, "Library/Application Support/com.apple.TCC"), "/Library/Application Support/com.apple.TCC"],
    readOnly: [join(home, "Library/LaunchAgents"), "/Library/LaunchAgents", "/Library/LaunchDaemons"],
  };
}

/**
 * How a command line starts: inside `sandbox-exec` on macOS, as a plain shell elsewhere. The command is the shell's
 * argument as before: the profile wraps it and changes nothing of what it says.
 */
export function sandboxedSpawn(command: string, plan: SandboxPlan | null, platform: NodeJS.Platform = process.platform, realpath?: (path: string) => string | null): { file: string; args: string[] } {
  if (platform !== "darwin" || !plan) return { file: "/bin/sh", args: ["-c", command] };
  const { profile, params } = sandboxProfile(plan, realpath);
  return { file: SANDBOX_EXEC, args: [...params, "-p", profile, "/bin/sh", "-c", command] };
}

/**
 * Whether the profile starts on this Mac: it runs `true` inside it once. A profile that does not start stops every
 * command instead of letting one run outside it.
 */
export function sandboxWorks(plan: SandboxPlan, realpath?: (path: string) => string | null): Promise<string | null> {
  const { file, args } = sandboxedSpawn("/usr/bin/true", plan, "darwin", realpath);
  return new Promise((done) => {
    execFile(file, args, { timeout: 10_000 }, (error, _stdout, stderr) => done(error ? (stderr.trim() || error.message).slice(0, 300) : null));
  });
}
