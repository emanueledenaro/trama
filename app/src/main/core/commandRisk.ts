import { commandWords } from "@shared/fixedBans";

/**
 * The commands that cannot be undone (ADR 0020, decision 9, issue #409): a deletion, a send of data and a payment ask
 * for the person's yes every time. Read from the words of each simple command, so a quoted `rm` in an `echo` does not
 * count and a wrapper (`sudo rm`) does.
 */

export type IrreversibleReason = "delete" | "send" | "payment";

const DELETERS = new Set(["rm", "rmdir", "unlink", "shred", "srm", "trash", "mkfs", "wipefs"]);
const SENDERS = new Set(["scp", "sftp", "ftp", "sendmail", "mail", "mailx", "mutt", "msmtp", "rclone", "aws", "gsutil", "az", "wrangler", "vercel", "netlify", "npm", "pnpm", "yarn"]);
const SEND_ARGS: Record<string, RegExp> = {
  aws: /^(s3|ses|sns)$/,
  az: /^(storage|email)$/,
  gsutil: /^(cp|rsync|mv)$/,
  rclone: /^(copy|sync|move|copyto|moveto)$/,
  npm: /^publish$/,
  pnpm: /^publish$/,
  yarn: /^(publish|npm)$/,
  wrangler: /^(deploy|publish|pages)$/,
  vercel: /^(deploy|--prod|publish)$/,
  netlify: /^deploy$/,
};
const PAYMENT_PROGRAMS = /^(stripe|paypal|payoneer|braintree|adyen)$/;
/** Payment hosts: matched by exact name or subdomain. `pathPrefix` limits a host to the paths that move money. */
const PAYMENT_HOSTS: { host: string; pathPrefix?: RegExp }[] = [
  { host: "api.stripe.com" },
  { host: "checkout.stripe.com" },
  { host: "checkout.paypal.com" },
  { host: "api-m.paypal.com" },
  { host: "api.paypal.com" },
  { host: "paypal.com", pathPrefix: /^\/v\d/i },
  { host: "api.adyen.com" },
  { host: "api.braintreegateway.com" },
];
const BODY_OPTIONS = /^(-d|--data|--data-raw|--data-binary|--data-urlencode|-F|--form|-T|--upload-file|--post-data|--post-file|--body-data|--json)(=|$)/;

/** Host name and path of a word that looks like a URL or a host[:port][/path], or null. */
function hostAndPath(token: string): { host: string; path: string } | null {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(token)) {
    try {
      const url = new URL(token);
      return { host: url.hostname.toLowerCase().replace(/\.$/, ""), path: url.pathname };
    } catch {
      // fall through to the plain host reading
    }
  }
  const bare = token.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^[^/@]*@/, "");
  const match = /^([a-z0-9-]+(?:\.[a-z0-9-]+)+)\.?(?::\d+)?(\/.*)?$/i.exec(bare);
  return match ? { host: match[1]!.toLowerCase(), path: match[2] ?? "" } : null;
}

/** True when a word names a payment host, as the host itself or one of its subdomains (never as a substring). */
export function mentionsPaymentHost(word: string): boolean {
  const pieces = word.split(/\s+/).map((piece) => piece.replace(/^-{1,2}[\w-]+=/, "").replace(/^["']|["']$/g, ""));
  return pieces.some((token) => {
    const found = token ? hostAndPath(token) : null;
    if (!found) return false;
    return PAYMENT_HOSTS.some(({ host, pathPrefix }) => (found.host === host || found.host.endsWith(`.${host}`)) && (!pathPrefix || pathPrefix.test(found.path)));
  });
}

const program = (word: string) => word.split("/").at(-1) ?? word;

function remote(word: string): boolean {
  return /^[\w.-]+@[\w.-]+:/.test(word) || /^[\w.-]+:[^/]/.test(word) || /^[a-z]+:\/\//i.test(word);
}

function reasonOf(words: string[]): IrreversibleReason | null {
  const name = program(words[0]!);
  const args = words.slice(1);
  const line = words.join(" ");
  if (PAYMENT_PROGRAMS.test(name) || words.some(mentionsPaymentHost)) return "payment";
  if (DELETERS.has(name)) return "delete";
  if (name === "dd" && args.some((a) => a.startsWith("of="))) return "delete";
  if (name === "diskutil" && /^(erase|secureErase|zeroDisk|randomDisk|reformat|partitionDisk|apfs)/i.test(args[0] ?? "")) return "delete";
  if (name === "find" && args.some((a) => a === "-delete")) return "delete";
  if (name === "git" && (args[0] === "clean" || (args[0] === "branch" && args.some((a) => /^-D$/.test(a))) || (args[0] === "stash" && ["drop", "clear"].includes(args[1] ?? "")) || (args[0] === "reset" && args.includes("--hard")))) return "delete";
  if (name === "truncate") return "delete";
  if (name === "mv" && args.at(-1) === "/dev/null") return "delete";
  if (name === "curl" || name === "wget" || name === "http" || name === "https") {
    const method = args.findIndex((a) => /^(-X|--request|--method)$/.test(a));
    const verb = (method >= 0 ? args[method + 1] : args.find((a) => /^--(request|method)=/.test(a))?.split("=")[1])?.toUpperCase();
    if (verb && verb !== "GET" && verb !== "HEAD") return verb === "DELETE" ? "delete" : "send";
    if (args.some((a) => BODY_OPTIONS.test(a)) || (name !== "curl" && name !== "wget" && args.some((a) => /^(POST|PUT|PATCH|DELETE)$/.test(a)))) return "send";
  }
  if (name === "rsync" && args.some(remote)) return "send";
  if (name === "scp" || name === "sftp") return "send";
  if (SENDERS.has(name) && SEND_ARGS[name]?.test(args.find((a) => !a.startsWith("-")) ?? "")) return "send";
  if (["sendmail", "mail", "mailx", "mutt", "msmtp"].includes(name)) return "send";
  if (name === "osascript" && /(send|mail|message)/i.test(line)) return "send";
  if (name === "gh" && ["pr", "issue", "release", "gist", "repo"].includes(args[0] ?? "") && /^(create|comment|merge|delete|edit|close|upload)$/.test(args[1] ?? "")) {
    return args[1] === "delete" ? "delete" : "send";
  }
  return null;
}

/** Why a command line needs the person's yes, or null when it can be undone or only reads. */
export function irreversibleReason(command: string): IrreversibleReason | null {
  for (const words of commandWords(command)) {
    if (/^(sh|bash|zsh|dash|ksh)$/.test(program(words[0]!))) {
      const flag = words.findIndex((a, i) => i > 0 && /^-[a-z]*c[a-z]*$/.test(a));
      const inner = flag >= 0 && words[flag + 1] ? irreversibleReason(words[flag + 1]!) : null;
      if (inner) return inner;
      continue;
    }
    const reason = reasonOf(words);
    if (reason) return reason;
  }
  return null;
}

const READERS = new Set([
  "cat", "head", "tail", "less", "more", "ls", "find", "rg", "grep", "egrep", "fgrep", "sed", "awk", "wc", "sort", "uniq", "cut", "tr", "pwd", "echo", "printf",
  "stat", "file", "du", "df", "which", "whoami", "date", "diff", "cmp", "tree", "basename", "dirname", "realpath", "readlink", "jq", "nl", "column", "xxd",
  "hexdump", "strings", "test", "[", "true", "uname", "id", "hostname", "ps", "lsof",
]);
const READING_GIT = new Set(["status", "log", "diff", "show", "ls-files", "rev-parse", "blame", "grep", "describe", "shortlog", "ls-tree", "cat-file"]);
const FIND_WRITERS = /^-(delete|exec|execdir|ok|okdir|fprint0?|fprintf|fls)$/;
const SED_WRITES = /(^|[;\n{}])\s*[0-9,$]*\s*[we]\b|\/[a-zA-Z0-9]*[we][a-zA-Z0-9]*\s*(;|$)/;

function wordsRead(words: string[]): boolean {
  const name = program(words[0]!);
  const args = words.slice(1);
  // A redirection writes a file, whatever the program is; a quoted `>` over-counts, which only adds a line to the chat.
  if (words.some((word) => word.includes(">"))) return false;
  if (name === "git") return READING_GIT.has(args.find((a) => !a.startsWith("-")) ?? "") && !args.some((a) => /^--(output|ext-diff|open-files-in-pager)(=|$)/.test(a));
  if (!READERS.has(name)) return false;
  if (name === "find") return !args.some((a) => FIND_WRITERS.test(a));
  if (name === "sed") return !args.some((a) => /^-[a-z]*i/.test(a) || a === "--in-place" || a.startsWith("--in-place=") || SED_WRITES.test(a));
  if (name === "awk") return !args.some((a) => /system\s*\(|\|&|getline/.test(a));
  if (name === "sort") return !args.some((a) => /^(-[a-z]*o|--output)/.test(a));
  return true;
}

/**
 * True when every simple command of the line only reads: it cannot change a file, a setting or the outside world.
 * Such a line stays in Activity and does not get a line in the chat (issue #583). Unknown programs count as changing
 * something, so the chat keeps showing them.
 */
export function onlyReads(command: string): boolean {
  const lines = commandWords(command);
  if (!lines.length) return false;
  return lines.every((words) => {
    if (/^(sh|bash|zsh|dash|ksh)$/.test(program(words[0]!))) {
      const flag = words.findIndex((a, i) => i > 0 && /^-[a-z]*c[a-z]*$/.test(a));
      return flag >= 0 && !!words[flag + 1] && onlyReads(words[flag + 1]!);
    }
    return wordsRead(words);
  });
}
