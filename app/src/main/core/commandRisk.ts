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
const PAYMENT_HOSTS = /(api\.stripe\.com|paypal\.com\/v\d|api-m\.paypal\.com|checkout\.(stripe|paypal)\.com|api\.adyen\.com|api\.braintreegateway\.com)/i;
const BODY_OPTIONS = /^(-d|--data|--data-raw|--data-binary|--data-urlencode|-F|--form|-T|--upload-file|--post-data|--post-file|--body-data|--json)(=|$)/;

const program = (word: string) => word.split("/").at(-1) ?? word;

function remote(word: string): boolean {
  return /^[\w.-]+@[\w.-]+:/.test(word) || /^[\w.-]+:[^/]/.test(word) || /^[a-z]+:\/\//i.test(word);
}

function reasonOf(words: string[]): IrreversibleReason | null {
  const name = program(words[0]!);
  const args = words.slice(1);
  const line = words.join(" ");
  if (PAYMENT_PROGRAMS.test(name) || PAYMENT_HOSTS.test(line)) return "payment";
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
