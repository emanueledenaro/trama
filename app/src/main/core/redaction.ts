/**
 * What Trama removes before it publishes text on GitHub (issue #391): issues, pull requests, comments and the
 * messages of the commits it writes. The project's files may hold personal and business data (VAT numbers, fiscal
 * and SDI codes, email and PEC addresses, street addresses, the shop's domain, tokens); a finding that quotes them
 * must not copy them into a public page. Each value becomes a placeholder that names what was there and, when the
 * repository holds it, the file and line where it lives, so the reader can still find it.
 */
import { git } from "./process";

export type SensitiveKind = "token" | "iban" | "pec" | "email" | "fiscalCode" | "vatNumber" | "sdiCode" | "shopDomain" | "address";

/** The placeholder's words for each kind, in the language of the text Trama publishes. */
const PLACEHOLDER: Record<SensitiveKind, string> = {
  token: "token rimosso",
  iban: "IBAN rimosso",
  pec: "PEC rimossa",
  email: "email rimossa",
  fiscalCode: "codice fiscale rimosso",
  vatNumber: "partita IVA rimossa",
  sdiCode: "codice SDI rimosso",
  shopDomain: "dominio del negozio rimosso",
  address: "indirizzo rimosso",
};

/** Where a value lives in the repository, as `path:line`, or null when no tracked file holds it. */
export type SensitiveLocator = (value: string) => Promise<string | null>;

interface Found {
  start: number;
  end: number;
  kind: SensitiveKind;
  /** The value itself, without the label around it, as the repository would hold it. */
  value: string;
}

interface Rule {
  kind: SensitiveKind | ((value: string) => SensitiveKind);
  pattern: RegExp;
  /** The capture group that holds the value; the whole match when absent. */
  group?: number;
  accept?: (value: string) => boolean;
}

/** The check digit of an Italian VAT number: a random eleven-digit number passes one time in ten. */
export function isItalianVatNumber(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^0+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let digit = Number(digits[i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[10]);
}

/** Addresses that are not anyone's: automated senders, documentation domains and git's own user. */
function isPublicEmail(address: string): boolean {
  const [local = "", domain = ""] = address.toLowerCase().split("@");
  return (
    /^(?:no-?reply|do-?not-?reply)$/.test(local) ||
    /(?:^|\.)noreply\.github\.com$/.test(domain) ||
    /(?:^|\.)example\.(?:com|org|net|it)$/.test(domain) ||
    (local === "git" && domain === "github.com")
  );
}

/** Street types that open an Italian address, written as they are or with a capital letter. */
const STREET = ["via", "viale", "v\\.le", "piazza", "p\\.za", "piazzale", "corso", "c\\.so", "largo", "vicolo", "strada", "contrada", "località", "loc\\.", "borgo", "lungomare"]
  .map((word) => `[${word[0]!.toUpperCase()}${word[0]}]${word.slice(1)}`)
  .join("|");
const NAME_WORD = "(?:[A-ZÀ-Ý0-9][\\p{L}\\d'.]*|di|del|della|dei|degli|delle|de|d'|san|santa)";
const CITY_WORD = "[A-ZÀ-Ý][\\p{L}'-]*";

const RULES: Rule[] = [
  // Tokens first: they may hold anything else, an email or a run of digits, inside them.
  {
    kind: "token",
    pattern:
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|shp(?:at|ss|ca|pa)_[A-Fa-f0-9]{16,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|[sr]k_live_[A-Za-z0-9]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35})/g,
  },
  { kind: "token", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: "token", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { kind: "token", pattern: /\bBearer\s+([A-Za-z0-9._~+/=-]{16,})/g, group: 1 },
  {
    kind: "token",
    pattern: /(?<![A-Za-z0-9])(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret|password|passwd|token)["']?\s*[:=]\s*["']?([A-Za-z0-9_\-./+=]{12,})/gi,
    group: 1,
    // Also as the end of a variable name such as `SHOPIFY_API_KEY`. A value, not a name in code such as
    // `token = readToken`: it holds letters and digits.
    accept: (value) => /\d/.test(value) && /[A-Za-z]/.test(value),
  },
  { kind: "iban", pattern: /\bIT\d{2}(?: ?[A-Z0-9]){23}\b/g, accept: (value) => /^IT\d{2}[A-Z]\d{10}[A-Z0-9]{12}$/.test(value.replace(/ /g, "")) },
  {
    kind: (value) => (/@(?:[^@]*\.)?(?:pec|legalmail|postacert|postecert|cert)\./i.test(value) ? "pec" : "email"),
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g,
    accept: (value) => !isPublicEmail(value),
  },
  { kind: "fiscalCode", pattern: /\b[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]\b/g },
  { kind: "vatNumber", pattern: /\b(?:IT ?)?(\d{11})\b/g, group: 1, accept: isItalianVatNumber },
  {
    kind: "sdiCode",
    pattern: /\b(?:codice\s+(?:SDI|destinatario|univoco)|SDI)["']?\s*[:=]?\s*["']?([A-Za-z0-9]{7})\b/gi,
    group: 1,
    accept: (value) => value === value.toUpperCase() && /\d/.test(value),
  },
  { kind: "shopDomain", pattern: /\b(?:[a-z0-9][a-z0-9-]*\.myshopify\.com|admin\.shopify\.com\/store\/[a-z0-9-]+)\b/gi },
  {
    kind: "address",
    pattern: new RegExp(
      `\\b(?:${STREET})\\s+${NAME_WORD}(?:\\s+${NAME_WORD})*,?\\s+\\d{1,4}(?:[A-Za-z]\\b|\\b)(?:\\/\\d+)?(?:,?\\s*\\d{5}(?:\\s+${CITY_WORD}(?:\\s+${CITY_WORD})*)?(?:\\s*\\([A-Z]{2}\\))?)?`,
      "gu",
    ),
  },
];

/** Every sensitive value in `text`, left to right, without overlaps: an earlier rule wins a tie. */
export function findSensitiveData(text: string): Found[] {
  const candidates: (Found & { rank: number })[] = [];
  RULES.forEach((rule, rank) => {
    for (const match of text.matchAll(rule.pattern)) {
      const value = rule.group ? match[rule.group] : match[0];
      if (!value || (rule.accept && !rule.accept(value))) continue;
      // A labelled value is replaced alone, so the label keeps telling the reader what was there.
      const start = rule.group ? match.index! + match[0].lastIndexOf(value) : match.index!;
      const kind = typeof rule.kind === "function" ? rule.kind(value) : rule.kind;
      candidates.push({ start, end: start + value.length, kind, value, rank });
    }
  });
  candidates.sort((a, b) => a.start - b.start || a.rank - b.rank || b.end - a.end);
  const found: Found[] = [];
  for (const { rank: _rank, ...candidate } of candidates) {
    const last = found.at(-1);
    if (last && candidate.start < last.end) continue;
    found.push(candidate);
  }
  return found;
}

/**
 * `text` with each sensitive value replaced by its placeholder, as `[partita IVA rimossa, vedi config/negozio.json:3]`
 * when `locate` finds it in the repository and `[partita IVA rimossa]` otherwise. The rest of the text is unchanged.
 */
export async function redactSensitiveData(text: string, locate?: SensitiveLocator): Promise<string> {
  const found = findSensitiveData(text);
  if (!found.length) return text;
  let result = "";
  let cursor = 0;
  for (const item of found) {
    const where = locate ? await locate(item.value).catch(() => null) : null;
    result += `${text.slice(cursor, item.start)}[${PLACEHOLDER[item.kind]}${where ? `, vedi ${where}` : ""}]`;
    cursor = item.end;
  }
  return result + text.slice(cursor);
}

/**
 * Looks values up in the tracked files of the repository at `root` and answers the first `path:line`. Each value is
 * looked up once; a failed search leaves the placeholder without a reference.
 */
export function repositoryLocator(root: string): SensitiveLocator {
  const seen = new Map<string, Promise<string | null>>();
  return (value) => {
    let where = seen.get(value);
    if (!where) {
      where = git(["grep", "--no-color", "-I", "-n", "-z", "--fixed-strings", "-e", value], root, true, 10_000)
        .then((output) => {
          const [path, line] = (output.split("\n")[0] ?? "").split("\0");
          return path && line && /^\d+$/.test(line) ? `${path}:${line}` : null;
        })
        .catch(() => null);
      seen.set(value, where);
    }
    return where;
  };
}
