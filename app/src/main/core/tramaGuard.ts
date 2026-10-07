import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { commandWords } from "@shared/fixedBans";

/**
 * Trama is off limits to the Operator's commands (issue #597). A consent, the mandate, the ok to a candidate, the yes
 * to a command, a send, a payment or a deletion, and an answer of the Pact count only when the person gives them in
 * Trama's window. A command must never reach that window by other means: it does not drive the keyboard, the mouse or
 * other apps by script, it does not start, stop, debug or reconfigure Trama, and it does not read or write Trama's data
 * (the projects' documents hold the consents, the mandate and the approvals) or its installation. The check reads the
 * words of the command; on macOS the sandbox of the commands (`operatorSandbox.ts`) holds the same line in the system,
 * also for what a script does that the words do not show. Pure.
 */

/** Trama's own places and processes, as the main process knows them. */
export interface TramaPlaces {
  /** Folders with Trama's data: the projects' documents, the settings, Electron's profile. Never read or written. */
  data: readonly string[];
  /** Where Trama is installed or built: its bundle, its code and its modules. Never read or written. */
  install: readonly string[];
  /** The processes of Trama: the app and its helpers. */
  pids: readonly number[];
  /** Whether Trama runs from source, as "Electron": then that name and Electron's bundle id are Trama's too. */
  fromSource?: boolean;
  /** Whether the open project is Trama's own code: its build there is the work, not the installation. */
  projectIsTrama?: boolean;
}

/** Why a command reaches Trama, as one code for Activity. */
export type TramaReach = "input" | "launch" | "debugger" | "settings" | "process" | "permissions" | "persistence";

/** Programs that drive the keyboard, the mouse or other apps by script: they could press a yes in Trama's window. */
const INPUT_PROGRAMS = new Set(["osascript", "cliclick", "xdotool", "ydotool", "wtype", "automator", "shortcuts"]);
/** Programs that start a job outside the command and its sandbox, now or later. */
const PERSISTENCE_PROGRAMS = new Set(["launchctl", "crontab", "at", "batch"]);
/** Programs that change the system's permissions. */
const PERMISSION_PROGRAMS = new Set(["tccutil"]);
const DEBUGGERS = new Set(["lldb", "gdb", "dtrace", "dtruss"]);
const KILLERS = new Set(["kill", "killall", "pkill"]);

/** Words that only a script driving input, an app or a debugging port of Chrome or Electron has. */
const KEYWORDS: [RegExp, TramaReach][] = [
  [/system events/i, "input"],
  [/\b(cgeventpost|cgeventcreate\w*|cgeventtap\w*|axuielement\w*|iohidpostevent)\b/i, "input"],
  [/\b(pyautogui|pynput|robotjs|nut-tree|nutjs)\b/i, "input"],
  [/--remote-debugging-(port|pipe)\b/i, "debugger"],
  [/\b(connectovercdp|chrome-remote-interface)\b|devtools\/(browser|page)\//i, "debugger"],
  [/\belectron_run_as_node\b/i, "launch"],
];

/** Trama's names and bundle id; Electron's too when Trama runs from source, where that is what it is called. */
const TRAMA_WORD = /(^|[^a-z0-9])(trama|dev\.trama\.app)([^a-z0-9]|$)/i;
const ELECTRON_WORD = /(^|[^a-z0-9])(electron|com\.github\.electron)([^a-z0-9]|$)/i;
const USR1 = /^(-usr1|-sigusr1|-10|-30)$/i;

/**
 * Why a command reaches Trama by its words, or null. `pids` are Trama's processes; `fromSource` says Trama runs as
 * "Electron", so that name is Trama's too. A packaged Trama leaves the person's own Electron apps alone. Pure.
 */
export function tramaCommandReach(command: string, pids: readonly number[] = [], fromSource = false): TramaReach | null {
  const named = (word: string) => TRAMA_WORD.test(word) || (fromSource && ELECTRON_WORD.test(word));
  for (const [pattern, reach] of KEYWORDS) if (pattern.test(command)) return reach;
  for (const words of commandWords(command)) {
    const program = (words[0] ?? "").split("/").at(-1)?.toLowerCase() ?? "";
    const args = words.slice(1);
    if (INPUT_PROGRAMS.has(program)) return "input";
    if (PERSISTENCE_PROGRAMS.has(program)) return "persistence";
    if (PERMISSION_PROGRAMS.has(program)) return "permissions";
    // A shell started with a script reads that script as a command line of its own.
    if (/^(sh|bash|zsh|dash|ksh|fish)$/.test(program)) {
      const flag = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a));
      const inner = flag >= 0 ? tramaCommandReach(args[flag + 1] ?? "", pids, fromSource) : null;
      if (inner) return inner;
    }
    const namesTrama = args.some(named);
    const namesPid = args.some((a) => /^\d+$/.test(a) && pids.includes(Number(a)));
    if (program === "open" && namesTrama) return "launch";
    if (program === "defaults" && /^(write|delete|import|rename)$/.test(args[0] ?? "") && named(args[1] ?? "")) return "settings";
    if (KILLERS.has(program)) {
      // SIGUSR1 opens Node's inspector on a process: Trama's main process would answer to a debugger.
      const signal = args.findIndex((a) => a === "-s" || a === "--signal");
      if (args.some((a) => USR1.test(a)) || (signal >= 0 && /^(sig)?usr1$/i.test(args[signal + 1] ?? ""))) return "debugger";
      if (namesTrama || namesPid) return "process";
    }
    if (DEBUGGERS.has(program) && (namesTrama || namesPid)) return "debugger";
  }
  return null;
}

/** Whether `path` is `folder` or inside it. */
const within = (path: string, folder: string): boolean => {
  const rest = relative(folder, path);
  return rest === "" || (!rest.startsWith("..") && !isAbsolute(rest));
};

/**
 * The places of Trama a command may never reach, for the project at `projectRoot`. Trama's installation always counts,
 * also when the project holds it (a project in the home folder). The one exception is a project that is Trama's own
 * code, when the person works on Trama with Trama: the build inside that project is the work. An installation elsewhere
 * still counts then.
 */
export function protectedTramaPaths(places: Pick<TramaPlaces, "data" | "install">, projectRoot: string, projectIsTrama = false): string[] {
  const install = projectIsTrama ? places.install.filter((path) => !within(path, projectRoot)) : places.install;
  return [...new Set([...places.data, ...install].filter(Boolean))];
}

/** A file's text, or null when it cannot be read. */
export function readTextOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Whether a folder holds Trama's own code: its app's package says so (`productName` Trama, `build.appId` dev.trama.app),
 * at the root or in `app/`. `read` returns a file's text or null. Pure but for the reads.
 */
export function holdsTramaCode(root: string, read: (path: string) => string | null): boolean {
  for (const file of [join(root, "package.json"), join(root, "app", "package.json")]) {
    try {
      const pkg = JSON.parse(read(file) ?? "null") as { productName?: unknown; build?: { appId?: unknown } } | null;
      if (pkg?.productName === "Trama" && pkg.build?.appId === "dev.trama.app") return true;
    } catch {
      // Not a package: not Trama's code.
    }
  }
  return false;
}

/** A path as the person reads it: the home folder as `~`. */
export function shownPath(path: string, home = homedir()): string {
  return path === home || path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path;
}

/** The switches that open a debugging port on Trama: whoever holds the port drives the window and the main process. */
const DEBUG_SWITCHES = /^--(remote-debugging-port|remote-debugging-pipe|remote-debugging-address|inspect|inspect-brk|inspect-port|inspect-publish-uid)(=|$)/;

/**
 * Whether Trama was started with a debugging port (issue #597): a packaged Trama never runs that way, since a command
 * that restarted it with one could press any yes. Development and the checks that drive the app keep them. Pure.
 */
export function debuggingRequested(argv: readonly string[], inspectorUrl: string | undefined): boolean {
  return Boolean(inspectorUrl) || argv.some((arg) => DEBUG_SWITCHES.test(arg));
}
