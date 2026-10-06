import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import { commandBan, commandWords, type FixedBan, isSecretPath } from "@shared/fixedBans";

/**
 * The lock on secrets (ADR 0020, issue #409). A fixed list of the places where the person's secrets live: the
 * Operator's commands never read, copy or list the content of any of them. A command that touches one is stopped
 * before it starts and waits for the person in "Aspetta te" with the place that stopped it.
 *
 * The check reads the command as Trama will run it: the words of every simple command, `~` and `$HOME` opened, relative
 * paths joined to the folder the command runs in (following `cd`), globs matched against the places, and the real
 * path of what exists, so a link that points into a locked place is the place itself. The fixed bans of the mandate
 * (`commandBan`) apply too: the Operator has no exception to them. Pure but for the file system lookups, which are
 * injected so the tests never depend on the machine.
 */

/** Places under the home folder, written relative to it. A path inside one of them is locked. */
export const HOME_PLACES = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".kube",
  ".azure",
  ".config/gh",
  ".config/gcloud",
  ".docker/config.json",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".git-credentials",
  ".pgpass",
  "Library/Keychains",
  "Library/Cookies",
  "Library/Safari",
  "Library/Application Support/Google/Chrome",
  "Library/Application Support/Chromium",
  "Library/Application Support/BraveSoftware",
  "Library/Application Support/Microsoft Edge",
  "Library/Application Support/Arc",
  "Library/Application Support/Firefox",
  "Library/Application Support/com.operasoftware.Opera",
  ".config/google-chrome",
  ".config/chromium",
  ".config/BraveSoftware",
  ".config/microsoft-edge",
  ".mozilla",
];

/** Places outside the home folder. */
export const SYSTEM_PLACES = ["/Library/Keychains", "/etc/shadow", "/etc/master.passwd"];

export type LockKind = "place" | "file" | "environment" | "keychain" | "secret";

/** A place a command may not reach: the label the person reads and the paths it covers. */
interface Place {
  label: string;
  paths: string[];
}

export interface Locked {
  kind: LockKind;
  /** What stopped the command, as the person reads it: the place (`~/.ssh`), `.env`, or the environment. */
  place: string;
}

export interface LockContext {
  /** The folder the command runs in. */
  cwd: string;
  home?: string;
  /** The real path of an existing path, or null when it does not exist. Injected for the tests. */
  realpath?: (path: string) => string | null;
}

const defaultRealpath = (path: string): string | null => {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
};

/** Programs that read the content of whatever folder they are given, below it. */
const DEEP_READERS = new Set(["grep", "egrep", "fgrep", "rg", "ag", "ack", "tar", "zip", "cp", "rsync", "scp", "ditto", "du"]);
const ENVIRONMENT_DUMP = /(^|[;&|(`\s])(printenv|env|export\s+-p|declare\s+-x|set)\s*($|[;&|)`])/;

const GLOB = /[*?[{]/;

function globExpression(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else if (c === "{") out += "(?:";
    else if (c === "}") out += ")";
    else if (c === ",") out += "|";
    else if (c === "[") {
      const end = glob.indexOf("]", i + 1);
      if (end < 0) out += "\\[";
      else {
        out += `[${glob.slice(i + 1, end).replace(/^!/, "^").replace(/\\/g, "\\\\")}]`;
        i = end;
      }
    } else out += c.replace(/[.+^$()|\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

/** Whether a glob can match a segment of a locked path: a leading dot is matched only by a dot in the glob. */
function globReaches(glob: string, target: string): boolean {
  const globParts = glob.split("/");
  const targetParts = target.split("/");
  // The glob reaches the target when it is at least as deep and each segment matches the target's at the same depth.
  if (globParts.length < targetParts.length) return false;
  return targetParts.every((segment, index) => {
    const part = globParts[index]!;
    if (!GLOB.test(part)) return part === segment;
    if (segment.startsWith(".") && !part.startsWith(".") && !part.startsWith("[") && !part.startsWith("{")) return false;
    return globExpression(part).test(segment);
  });
}

export class SecretLock {
  private readonly home: string;
  private readonly realpath: (path: string) => string | null;
  private readonly places: Place[];

  constructor(options: { home?: string; realpath?: (path: string) => string | null } = {}) {
    this.home = normalize(options.home ?? homedir());
    this.realpath = options.realpath ?? defaultRealpath;
    this.places = [
      ...HOME_PLACES.map((place) => ({ label: `~/${place}`, absolute: join(this.home, place) })),
      ...SYSTEM_PLACES.map((place) => ({ label: place, absolute: place })),
    ].map(({ label, absolute }) => ({ label, paths: [...new Set([absolute, this.realpath(absolute) ?? absolute])] }));
  }

  /**
   * What locks a command, or null when it may run. The first thing it meets is the answer: a fixed ban, the
   * environment, a locked place, a secret file.
   */
  check(command: string, context: LockContext): { locked: Locked } | { ban: FixedBan } | null {
    const ban = commandBan(command);
    if (ban && ban !== "secrets") return { ban };
    if (ENVIRONMENT_DUMP.test(command)) return { locked: { kind: "environment", place: "env" } };
    const locked = this.checkLine(command, context.cwd, 0, this.places, true);
    // The ban on secrets reads the words too; the lock names the place when it can, the ban is the safety net.
    return locked ? { locked } : ban ? { ban } : null;
  }

  /**
   * The first of `folders` a command reaches, read the way the secrets are: `~` and `$HOME` opened, `cd` followed,
   * globs and links resolved, a folder above one read in depth. Used for Trama's own folders (issue #597).
   */
  reaches(command: string, context: Pick<LockContext, "cwd">, folders: readonly { label: string; path: string }[]): string | null {
    if (!folders.length) return null;
    const places = folders.map(({ label, path }) => ({ label, paths: [...new Set([normalize(path), this.realpath(path) ?? normalize(path)])] }));
    return this.checkLine(command, context.cwd, 0, places, false)?.place ?? null;
  }

  private checkLine(line: string, startCwd: string, depth: number, places: readonly Place[], secrets: boolean): Locked | null {
    if (depth > 4) return null;
    let cwd = startCwd;
    for (const words of commandWords(line)) {
      const program = words[0]!.split("/").at(-1) ?? words[0]!;
      const args = words.slice(1);
      if (program === "cd" || program === "pushd") {
        const target = args.find((a) => !a.startsWith("-"));
        cwd = target ? this.resolve(target, cwd) : this.home;
        continue;
      }
      if (/^(sh|bash|zsh|dash|ksh)$/.test(program)) {
        const flag = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a));
        const script = flag >= 0 ? args[flag + 1] : undefined;
        if (script) {
          if (secrets && ENVIRONMENT_DUMP.test(script)) return { kind: "environment", place: "env" };
          const inner = this.checkLine(script, cwd, depth + 1, places, secrets);
          if (inner) return inner;
        }
      }
      if (secrets && program === "security" && /^(find|dump|export|delete|add|import|set)-/.test(args[0] ?? "")) return { kind: "keychain", place: "Keychain" };
      const deep = DEEP_READERS.has(program) || args.some((a) => a === "-r" || a === "-R" || a === "--recursive") || (program === "find" && args.some((a) => /^-(exec|execdir|ok|okdir)$/.test(a)));
      // A command that runs inside a locked place reads it, whatever its words say.
      const inside = this.checkPlaces(cwd, false, places);
      if (inside && program !== "pwd") return inside;
      for (const word of words) {
        for (const fragment of [word, ...word.split(/[\s=:,;|&<>()`'"]+/)].filter(Boolean)) {
          const hit = this.checkFragment(fragment, cwd, deep, places, secrets);
          if (hit) return hit;
        }
      }
    }
    return null;
  }

  /** Opens `~` and `$HOME`, and joins a relative path to the folder the command runs in. */
  private resolve(path: string, cwd: string): string {
    const opened = path.replace(/^~(?=\/|$)/, this.home).replace(/^\$\{?HOME\}?(?=\/|$)/, this.home);
    return normalize(isAbsolute(opened) ? opened : join(cwd, opened));
  }

  private checkFragment(fragment: string, cwd: string, deep: boolean, places: readonly Place[], secrets: boolean): Locked | null {
    const looksLikePath = fragment.includes("/") || fragment.startsWith("~") || fragment.startsWith(".") || fragment.startsWith("$");
    // A bare word is no path to look at by name (`grep credentials src`), but it can be a link that points into a place.
    if (looksLikePath && /\$/.test(fragment.replace(/^\$\{?HOME\}?(?=\/|$)/, ""))) {
      // A variable the check cannot open: it still stops on a locked place written after it.
      const tail = fragment.replace(/\\/g, "/");
      if (!secrets) return this.checkHiddenStart(tail, places);
      for (const place of HOME_PLACES) if (tail.endsWith(`/${place}`) || tail.includes(`/${place}/`)) return { kind: "place", place: `~/${place}` };
      return isSecretPath(tail) ? { kind: "file", place: tail.split("/").at(-1) ?? tail } : null;
    }
    const absolute = this.resolve(fragment, cwd);
    if (GLOB.test(absolute)) return looksLikePath ? this.checkGlob(absolute, places, secrets) : null;
    // The path as written, then what it really is: a link into a locked place is that place.
    const candidates = [absolute];
    const real = this.realOf(absolute);
    if (real !== absolute) candidates.push(real);
    for (const candidate of candidates) {
      const hit = this.checkPlaces(candidate, deep, places);
      if (hit) return hit;
    }
    if (secrets && looksLikePath) for (const candidate of candidates) if (isSecretPath(candidate)) return { kind: "file", place: candidate.split(sep).at(-1) ?? candidate };
    return null;
  }

  /** The real path of a path that may not exist yet: the real path of its longest existing parent, then the rest. */
  private realOf(path: string): string {
    let existing = path;
    const rest: string[] = [];
    for (let guard = 0; guard < 64; guard++) {
      const real = this.realpath(existing);
      if (real !== null) return rest.length ? join(real, ...rest.reverse()) : real;
      const parent = dirname(existing);
      if (parent === existing) break;
      rest.push(existing.slice(parent.length).replace(/^[\\/]+/, ""));
      existing = parent;
    }
    return path;
  }

  /**
   * A path that starts with a variable the check cannot open (`$DIR/Library/...`): it reaches a place when what follows
   * the variable is a run of at least two folders of the place's path, written after the home folder.
   */
  private checkHiddenStart(tail: string, places: readonly Place[]): Locked | null {
    const written = tail.replace(/^.*\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/, "").replace(/\/+$/, "");
    if (written.split("/").filter(Boolean).length < 2) return null;
    for (const place of places) {
      for (const locked of place.paths) {
        const known = locked.startsWith(this.home + sep) ? locked.slice(this.home.length) : locked;
        if (known.includes(written) || written.includes(known)) return { kind: "place", place: place.label };
      }
    }
    return null;
  }

  private checkPlaces(path: string, deep: boolean, places: readonly Place[]): Locked | null {
    for (const place of places) {
      for (const locked of place.paths) {
        if (path === locked || path.startsWith(locked + sep)) return { kind: "place", place: place.label };
        // A folder above a locked place, read in depth, reaches it.
        if (deep && locked.startsWith(path.endsWith(sep) ? path : path + sep)) return { kind: "place", place: place.label };
      }
    }
    return null;
  }

  private checkGlob(glob: string, places: readonly Place[], secrets: boolean): Locked | null {
    for (const place of places) {
      for (const locked of place.paths) {
        if (globReaches(glob, locked)) return { kind: "place", place: place.label };
      }
    }
    if (!secrets) return null;
    const last = glob.split("/").at(-1) ?? "";
    // A pattern that starts with a dot reaches the env files; one that does not never matches a name with a leading dot.
    if (GLOB.test(last) && last.startsWith(".") && globExpression(last).test(".env")) return { kind: "file", place: ".env" };
    return isSecretPath(glob) ? { kind: "file", place: last } : null;
  }
}
