/**
 * Fixed bans (issue #244, ADR 0017): the actions no mandate grants. Trama applies them as rules, not as instructions to
 * the model: an action they cover is refused before it starts, whatever the mandate says, and waits for the person in
 * "Aspetta te" with its reason. They are not settings: the list is fixed here and every mandate, old or new, gets it.
 * Pure: the providers and Trama's own push path call it before anything runs.
 */

export type FixedBan = "forcePush" | "pushMainBranch" | "deleteRemoteRef" | "tagOrRelease" | "secrets" | "repositorySettings";

export interface FixedBanInfo {
  id: FixedBan;
  /** What is banned, as the mandate card lists it. */
  label: string;
  /** Why Trama stopped the action, in the person's words. */
  reason: string;
}

export const FIXED_BANS: FixedBanInfo[] = [
  { id: "forcePush", label: "Force push", reason: "Un force push riscrive la storia del remoto." },
  { id: "pushMainBranch", label: "Push diretto sul branch principale", reason: "Sul branch principale il lavoro arriva solo da una pull request." },
  { id: "deleteRemoteRef", label: "Cancellazione di branch o tag remoti", reason: "Cancellare un branch o un tag remoto toglie lavoro ad altri." },
  { id: "tagOrRelease", label: "Creazione di tag e rilasci", reason: "Tag e rilasci pubblicano una versione: li decide la persona." },
  { id: "secrets", label: "Letture o scritture di segreti e credenziali", reason: "Segreti e credenziali restano alla persona." },
  { id: "repositorySettings", label: "Modifiche alle impostazioni del repository", reason: "Le impostazioni del repository le cambia la persona." },
];

export const fixedBanInfo = (ban: FixedBan): FixedBanInfo => FIXED_BANS.find((b) => b.id === ban)!;

/** The branch names Trama treats as the main branch when it does not know the project's default one. */
export const MAIN_BRANCHES = ["main", "master"];

/** What the agent reads when Trama stops one of its actions: the rule, and that the person handles it. */
export function fixedBanMessage(ban: FixedBan): string {
  return `Trama blocks this action with a fixed ban (${fixedBanInfo(ban).label}): no mandate grants it. Do not retry it or look for another way; the person sees it in Aspetta te and handles it.`;
}

// MARK: Paths

const SECRET_NAMES = new Set([
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".git-credentials",
  ".pgpass",
  "credentials",
  "credentials.json",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
]);
const SECRET_EXTENSIONS = [".pem", ".key", ".p12", ".pfx", ".keystore", ".jks"];
const SECRET_DIRECTORIES = [".ssh", ".aws", ".gnupg", ".docker", ".kube"];
/** Example files hold no secret: they document which variables a project needs. */
const ENV_EXAMPLES = /^\.env\.(example|sample|template|dist)$/;

/** Whether a path names a secret or a credential file: an env file, a private key, a credential store. */
export function isSecretPath(path: string): boolean {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  const name = parts.at(-1)?.toLowerCase() ?? "";
  if (!name) return false;
  if ((name === ".env" || name.startsWith(".env.")) && !ENV_EXAMPLES.test(name)) return true;
  if (SECRET_NAMES.has(name)) return true;
  if (SECRET_EXTENSIONS.some((extension) => name.endsWith(extension))) return true;
  const directories = parts.slice(0, -1).map((p) => p.toLowerCase());
  if (directories.some((d) => SECRET_DIRECTORIES.includes(d))) return !name.endsWith(".pub");
  // The GitHub CLI keeps its token in hosts.yml.
  return name === "hosts.yml" && directories.at(-1) === "gh";
}

/** The ban on reading or writing a file, or null. */
export const pathBan = (path: string): FixedBan | null => (isSecretPath(path) ? "secrets" : null);

// MARK: Commands

/**
 * Splits a shell line into simple commands, each a list of words with quotes removed. Separators (`&&`, `||`, `;`,
 * `|`, `&`, newlines, backticks, `$(`, parentheses) count only outside quotes, so `grep "a && b"` stays one command.
 */
function simpleCommands(line: string): string[][] {
  const commands: string[][] = [];
  let current: string[] = [];
  let word: string | null = null;
  let quote: '"' | "'" | null = null;
  const endWord = () => {
    if (word !== null) current.push(word);
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (current.length) commands.push(current);
    current = [];
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < line.length) word = (word ?? "") + line[++i];
      else word = (word ?? "") + c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      word ??= "";
    } else if (c === "\\" && i + 1 < line.length) word = (word ?? "") + line[++i];
    else if (/\s/.test(c) && c !== "\n") endWord();
    else if ("\n;|&`()".includes(c) || (c === "$" && line[i + 1] === "(")) endCommand();
    else word = (word ?? "") + c;
  }
  endCommand();
  return commands.map(unwrap).filter((words) => words.length > 0);
}

/** Leading environment assignments and wrappers (`sudo`, `env`, `timeout 10`) are not the command. */
function unwrap(words: string[]): string[] {
  let start = 0;
  while (start < words.length) {
    const word = words[start]!;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || ["sudo", "env", "command", "exec", "time", "nohup", "nice", "xargs"].includes(word)) start++;
    else if (word === "timeout" && /^\d/.test(words[start + 1] ?? "")) start += 2;
    else break;
  }
  return words.slice(start);
}

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);

const program = (word: string) => word.split("/").at(-1) ?? word;

/** Git's global options before the subcommand, the ones that take a value as the next word. */
const GIT_OPTIONS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);

function gitSubcommand(args: string[]): { name: string; rest: string[] } | null {
  let i = 0;
  while (i < args.length && args[i]!.startsWith("-")) {
    i += GIT_OPTIONS_WITH_VALUE.has(args[i]!) ? 2 : 1;
  }
  return i < args.length ? { name: args[i]!, rest: args.slice(i + 1) } : null;
}

/** The destination branch of a refspec: `src:dst`, `dst` alone, without `refs/heads/`. */
const destination = (refspec: string) => {
  const target = refspec.includes(":") ? refspec.slice(refspec.indexOf(":") + 1) : refspec;
  return target.replace(/^\+/, "").replace(/^refs\/heads\//, "");
};

function gitPushBan(args: string[], mainBranches: string[]): FixedBan | null {
  const options = args.filter((a) => a.startsWith("-"));
  // The first word that is not an option is the remote; the rest are refspecs.
  const refspecs = args.filter((a) => !a.startsWith("-")).slice(1);
  const has = (...names: string[]) => options.some((o) => names.some((n) => o === n || o.startsWith(`${n}=`)));
  if (has("--force", "--force-with-lease", "--force-if-includes", "--mirror") || options.some((o) => /^-[a-zA-Z]*f/.test(o) && !o.startsWith("--"))) {
    return "forcePush";
  }
  if (refspecs.some((r) => r.startsWith("+"))) return "forcePush";
  if (has("--delete", "--prune") || options.some((o) => /^-[a-zA-Z]*d/.test(o) && !o.startsWith("--")) || refspecs.some((r) => r.startsWith(":"))) {
    return "deleteRemoteRef";
  }
  if (has("--tags", "--follow-tags") || refspecs.some((r) => r === "tag" || r.includes("refs/tags/"))) return "tagOrRelease";
  if (has("--all")) return "pushMainBranch";
  if (refspecs.some((r) => mainBranches.includes(destination(r)))) return "pushMainBranch";
  return null;
}

/** `git tag` lists with no argument or with a listing option; anything else creates, moves or deletes a tag. */
function gitTagBan(args: string[]): FixedBan | null {
  if (args.length === 0) return null;
  if (args.some((a) => a === "-d" || a === "--delete")) return "deleteRemoteRef";
  const listing = ["-l", "--list", "-v", "--verify", "-n", "--contains", "--no-contains", "--merged", "--no-merged", "--points-at", "--column", "--sort"];
  if (args.some((a) => listing.some((l) => a === l || a.startsWith(`${l}=`) || (l === "-n" && /^-n\d+$/.test(a))))) return null;
  return "tagOrRelease";
}

function gitBan(args: string[], mainBranches: string[]): FixedBan | null {
  const sub = gitSubcommand(args);
  if (!sub) return null;
  switch (sub.name) {
    case "push":
      return gitPushBan(sub.rest, mainBranches);
    case "tag":
      return gitTagBan(sub.rest);
    case "credential":
    case "credential-store":
    case "credential-cache":
    case "credential-osxkeychain":
      return "secrets";
    case "config":
      return sub.rest.some((a) => /^credential\./i.test(a)) ? "secrets" : null;
    default:
      return null;
  }
}

/** Repository endpoints of the GitHub API that change the repository's settings. */
const SETTINGS_ENDPOINT = /\/(branches\/[^/]+\/protection|rulesets|collaborators|invitations|hooks|keys|environments|pages|topics|transfer|actions\/permissions|vulnerability-alerts|automated-security-fixes|private-vulnerability-reporting|properties\/values)(\/|$)/;
const SECRETS_ENDPOINT = /\/(actions|dependabot|codespaces|agents)\/secrets(\/|$)|\/environments\/[^/]+\/secrets(\/|$)/;

function ghApiBan(args: string[], mainBranches: string[]): FixedBan | null {
  let method: string | null = null;
  let path: string | null = null;
  let fields = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "-X" || arg === "--method") method = (args[++i] ?? "").toUpperCase();
    else if (arg.startsWith("--method=")) method = arg.slice(9).toUpperCase();
    else if (/^-X[A-Za-z]+$/.test(arg)) method = arg.slice(2).toUpperCase();
    else if (["-f", "-F", "--field", "--raw-field", "--input"].includes(arg)) {
      fields = true;
      i++;
    } else if (["-H", "--header", "-q", "--jq", "-t", "--template", "--hostname", "--cache"].includes(arg)) i++;
    else if (!arg.startsWith("-") && path === null) path = arg;
  }
  if (!path) return null;
  const route = `/${path.replace(/^https?:\/\/[^/]+\//, "").replace(/^\/+/, "").split("?")[0]}`;
  const verb = method ?? (fields ? "POST" : "GET");
  // Reading a secret's metadata is still a read of secrets: any method.
  if (SECRETS_ENDPOINT.test(route)) return "secrets";
  if (verb === "GET" || verb === "HEAD") return null;
  const repository = /^\/repos\/[^/]+\/[^/]+/.exec(route);
  if (!repository) return null;
  const rest = route.slice(repository[0].length);
  if (rest === "" || rest === "/") return "repositorySettings";
  if (/^\/git\/refs\/(heads|tags)\//.test(rest) && verb === "DELETE") return "deleteRemoteRef";
  if (/^\/git\/refs\/tags\//.test(rest) || /^\/git\/tags(\/|$)/.test(rest) || /^\/releases(\/|$)/.test(rest)) return "tagOrRelease";
  if (/^\/git\/refs\/?$/.test(rest) && args.some((a) => a.includes("refs/tags/"))) return "tagOrRelease";
  const head = /^\/git\/refs\/heads\/(.+)$/.exec(rest);
  if (head && mainBranches.includes(head[1]!)) return "pushMainBranch";
  if (SETTINGS_ENDPOINT.test(rest)) return "repositorySettings";
  return null;
}

function ghBan(args: string[], mainBranches: string[]): FixedBan | null {
  const [group, action] = args;
  switch (group) {
    case "release":
      return ["list", "view", "download", "verify", "verify-asset"].includes(action ?? "") ? null : "tagOrRelease";
    case "secret":
    case "variable":
      return group === "secret" || action === "set" || action === "delete" ? "secrets" : null;
    case "auth":
      if (action === "token") return "secrets";
      return action === "status" && args.some((a) => a === "-t" || a === "--show-token") ? "secrets" : null;
    case "ssh-key":
    case "gpg-key":
      return action === "list" ? null : "secrets";
    case "repo":
      return ["edit", "delete", "rename", "archive", "unarchive", "deploy-key"].includes(action ?? "") ? "repositorySettings" : null;
    case "ruleset":
      return ["list", "view", "check"].includes(action ?? "") ? null : "repositorySettings";
    case "api":
      return ghApiBan(args.slice(1), mainBranches);
    default:
      return null;
  }
}

/** Readers of the macOS keychain and of the environment's secrets. */
function secretReaderBan(name: string, args: string[]): FixedBan | null {
  if (name === "security" && /^(find|dump|export)-/.test(args[0] ?? "")) return "secrets";
  return null;
}

/**
 * The fixed ban a shell command runs into, or null. It looks at every simple command of the line (`a && b`, pipes,
 * subshells), however git or gh are invoked, and at every word that names a secret file.
 */
export function commandBan(command: string, mainBranches: string[] = MAIN_BRANCHES): FixedBan | null {
  const branches = [...new Set([...mainBranches, ...MAIN_BRANCHES])];
  for (const cmd of simpleCommands(command)) {
    const name = program(cmd[0]!);
    const args = cmd.slice(1);
    // `bash -lc "git push --force"`: the script is a command line of its own.
    if (SHELLS.has(name)) {
      const flag = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a));
      const script = flag >= 0 ? args[flag + 1] : undefined;
      const inner = script ? commandBan(script, branches) : null;
      if (inner) return inner;
      continue;
    }
    const ban =
      name === "git" ? gitBan(args, branches) : name === "gh" ? ghBan(args, branches) : secretReaderBan(name, args);
    if (ban) return ban;
    if (cmd.some((word) => !word.startsWith("-") && isSecretPath(word.replace(/^[<>]+/, "")))) return "secrets";
  }
  return null;
}

/** The ban on Trama pushing `branch` itself: the main branch never receives a direct push. */
export function pushBan(branch: string, mainBranches: string[] = MAIN_BRANCHES): FixedBan | null {
  const name = branch.replace(/^refs\/heads\//, "");
  return [...mainBranches, ...MAIN_BRANCHES].includes(name) ? "pushMainBranch" : null;
}
