/**
 * Full-text search over past conversation messages, ported from Hermes Agent's session search
 * (https://github.com/NousResearch/hermes-agent, revision 58c896e, MIT, Copyright (c) 2025 Nous
 * Research; `hermes_state_search.py`). Hermes runs SQLite FTS5 with the `unicode61` tokenizer and
 * `bm25()`; Trama has no SQLite, so this module reproduces the same query sanitizer, query grammar,
 * BM25 ranking, snippet markers and OR-relaxed retry in memory. See docs/hermes-attribution.md.
 */

export interface SearchDocument {
  /** Message id: unique and increasing over the whole store. */
  id: number;
  sessionId: string;
  role: string;
  /** Indexed columns; the first is the message text. */
  columns: string[];
  timestamp: number;
}

export interface SearchHit {
  id: number;
  sessionId: string;
  role: string;
  snippet: string;
  timestamp: number;
  rank: number;
}

export interface SearchOptions {
  /** Applied before the limit, like the SQL WHERE clause. */
  filter?: (document: SearchDocument) => boolean;
  roles?: string[] | null;
  sort?: "newest" | "oldest" | null;
  limit?: number;
}

export const MAX_QUERY_CHARS = 2048;
const SPECIAL_CHARS = /[+{}():"^@/#&|~[\]<>,;!?$=\\']/g;
const QUOTED_PHRASE = /"[^"]*"/g;
const LIKE_TOKEN = /"[^"]+"|\S+/g;
const TOKEN = /[\p{L}\p{N}\p{Co}]+/gu;
const CJK = /[\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]|[\u{20000}-\u{2A6DF}]/u;

export const containsCjk = (text: string) => CJK.test(text);

/** unicode61 folding: lower case without diacritics, so `perché` and `perche` are the same token. */
export function fold(token: string): string {
  return token.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

interface Token {
  text: string;
  start: number;
  end: number;
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(TOKEN)) tokens.push({ text: fold(match[0]), start: match.index!, end: match.index! + match[0].length });
  return tokens;
}

/**
 * Hermes' `_sanitize_fts5_query`: keeps balanced quoted phrases, removes characters FTS5 treats as
 * syntax, drops a leading `*`, a dangling leading or trailing operator, and quotes dotted, hyphenated
 * or underscored terms so `my-app.config.ts` matches as a phrase.
 */
export function sanitizeQuery(query: string): string {
  const held: string[] = [];
  let text = [...query].slice(0, MAX_QUERY_CHARS).join("");
  text = text.replace(QUOTED_PHRASE, (phrase) => {
    held.push(phrase);
    return `\u0000Q${held.length - 1}\u0000`;
  });
  text = text.replace(/"/g, " ").replace(SPECIAL_CHARS, " ");
  if (text.includes("%") && !containsCjk(text)) text = text.replace(/%/g, " ");
  text = text.replace(/\*+/g, "*").replace(/(^|\s)\*/g, "$1");
  text = text.trim().replace(/^(AND|OR|NOT)\b\s*/i, "");
  text = text.trim().replace(/\s+(AND|OR|NOT)\s*$/i, "");
  text = text.replace(/(?<![\p{L}\p{N}_])([\p{L}\p{N}_]+(?:[._-][\p{L}\p{N}_]+)+)(?![\p{L}\p{N}_])/gu, '"$1"');
  held.forEach((phrase, index) => {
    text = text.replace(`\u0000Q${index}\u0000`, phrase);
  });
  return text.trim();
}

/** `a b c` becomes `a OR b OR c`; null for a single unit or when the query already says OR or NOT. */
export function orRelaxedQuery(query: string): string | null {
  const units: string[] = [];
  for (const token of query.match(LIKE_TOKEN) ?? []) {
    const upper = token.toUpperCase();
    if (upper === "OR" || upper === "NOT") return null;
    if (upper !== "AND") units.push(token);
  }
  return units.length >= 2 ? units.join(" OR ") : null;
}

// Query grammar: the FTS5 subset reachable after sanitization. NOT binds tightest, then AND
// (explicit or implicit), then OR; operators are upper case only.

interface Phrase {
  kind: "phrase";
  tokens: string[];
  prefix: boolean;
}

type Expression = Phrase | { kind: "and" | "or" | "not"; left: Expression; right: Expression };

const BAREWORD = /^[\p{L}\p{N}_\u001A]+\*?$/u;

function lex(query: string): string[] | null {
  const parts: string[] = [];
  const pattern = /"([^"]*)"(\*)?|(\S+)/g;
  for (const match of query.matchAll(pattern)) {
    if (match[3] !== undefined) {
      const word = match[3];
      if (word === "AND" || word === "OR" || word === "NOT") parts.push(word);
      else if (BAREWORD.test(word) || /^[^\x00-\x7F]+\*?$/.test(word)) parts.push(`w:${word}`);
      else return null;
    } else {
      parts.push(`p:${match[1]}${match[2] ?? ""}`);
    }
  }
  return parts;
}

function phraseOf(part: string): Phrase {
  const body = part.slice(2);
  const prefix = body.endsWith("*");
  const text = prefix ? body.slice(0, -1) : body;
  return { kind: "phrase", tokens: tokenize(text).map((t) => t.text), prefix };
}

export function parseQuery(query: string): Expression | null {
  const parts = lex(query);
  if (!parts || parts.length === 0) return null;
  let position = 0;
  const peek = () => parts[position];
  const primary = (): Expression | null => {
    const part = peek();
    if (!part || part === "AND" || part === "OR" || part === "NOT") return null;
    position += 1;
    return phraseOf(part);
  };
  const negation = (): Expression | null => {
    let left = primary();
    while (left && peek() === "NOT") {
      position += 1;
      const right = primary();
      if (!right) return null;
      left = { kind: "not", left, right };
    }
    return left;
  };
  const conjunction = (): Expression | null => {
    let left = negation();
    while (left && peek() !== undefined && peek() !== "OR") {
      if (peek() === "AND") position += 1;
      const right = negation();
      if (!right) return null;
      left = { kind: "and", left, right };
    }
    return left;
  };
  const disjunction = (): Expression | null => {
    let left = conjunction();
    while (left && peek() === "OR") {
      position += 1;
      const right = conjunction();
      if (!right) return null;
      left = { kind: "or", left, right };
    }
    return left;
  };
  const expression = disjunction();
  return expression && position === parts.length ? expression : null;
}

function phrases(expression: Expression): Phrase[] {
  return expression.kind === "phrase" ? [expression] : [...phrases(expression.left), ...phrases(expression.right)];
}

interface IndexedDocument {
  document: SearchDocument;
  columns: Token[][];
  length: number;
}

/** Positions (column, first token index) where the phrase occurs. */
function occurrences(phrase: Phrase, indexed: IndexedDocument): { column: number; index: number }[] {
  const found: { column: number; index: number }[] = [];
  if (phrase.tokens.length === 0) return found;
  indexed.columns.forEach((tokens, column) => {
    for (let index = 0; index + phrase.tokens.length <= tokens.length; index += 1) {
      let matches = true;
      for (let offset = 0; offset < phrase.tokens.length; offset += 1) {
        const token = tokens[index + offset]!.text;
        const wanted = phrase.tokens[offset]!;
        const last = offset === phrase.tokens.length - 1;
        if (last && phrase.prefix ? !token.startsWith(wanted) : token !== wanted) {
          matches = false;
          break;
        }
      }
      if (matches) found.push({ column, index });
    }
  });
  return found;
}

function matches(expression: Expression, indexed: IndexedDocument, cache: Map<Phrase, number>): boolean {
  switch (expression.kind) {
    case "phrase": {
      if (!cache.has(expression)) cache.set(expression, occurrences(expression, indexed).length);
      return cache.get(expression)! > 0;
    }
    case "and":
      return matches(expression.left, indexed, cache) && matches(expression.right, indexed, cache);
    case "or":
      return matches(expression.left, indexed, cache) || matches(expression.right, indexed, cache);
    case "not":
      return matches(expression.left, indexed, cache) && !matches(expression.right, indexed, cache);
  }
}

const K1 = 1.2;
const B = 0.75;

/**
 * Snippet in the shape of FTS5 `snippet(table, -1, '>>>', '<<<', '...', 40)`: the 40-token window
 * of the best column with the most distinct query phrases, matched tokens wrapped in markers.
 */
function snippet(indexed: IndexedDocument, query: Phrase[]): string {
  const WINDOW = 40;
  let best = { column: 0, start: 0, score: -1 };
  const hits = new Map<number, Set<number>>();
  indexed.columns.forEach((tokens, column) => {
    const matched = new Set<number>();
    const phraseStarts = query.map((phrase) => occurrences(phrase, indexed).filter((o) => o.column === column));
    query.forEach((phrase, p) => {
      for (const o of phraseStarts[p]!) for (let i = 0; i < Math.max(1, phrase.tokens.length); i += 1) matched.add(o.index + i);
    });
    hits.set(column, matched);
    const starts = new Set<number>([0, ...phraseStarts.flat().map((o) => Math.max(0, o.index - 5))]);
    for (const start of starts) {
      let score = 0;
      phraseStarts.forEach((list) => {
        const inside = list.filter((o) => o.index >= start && o.index < start + WINDOW).length;
        if (inside) score += 1000 + inside - 1;
      });
      if (start === 0) score += 1;
      if (score > best.score) best = { column, start, score };
    }
  });
  const text = indexed.document.columns[best.column] ?? "";
  const tokens = indexed.columns[best.column] ?? [];
  if (tokens.length === 0) return text.slice(0, 200);
  const from = tokens.length <= WINDOW ? 0 : Math.min(best.start, tokens.length - WINDOW);
  const to = Math.min(tokens.length, from + WINDOW);
  const matched = hits.get(best.column)!;
  let out = from > 0 ? "..." : "";
  let cursor = from > 0 ? tokens[from]!.start : 0;
  for (let i = from; i < to; i += 1) {
    const token = tokens[i]!;
    out += text.slice(cursor, token.start);
    const original = text.slice(token.start, token.end);
    out += matched.has(i) ? `>>>${original}<<<` : original;
    cursor = token.end;
  }
  out += to < tokens.length ? "..." : text.slice(cursor);
  return out;
}

function rankAndSort(hits: SearchHit[], sort: SearchOptions["sort"]): SearchHit[] {
  return hits.sort((a, b) => {
    if (sort === "newest" && a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
    if (sort === "oldest" && a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return a.rank - b.rank || a.id - b.id;
  });
}

/**
 * Evaluates a sanitized query over the documents: BM25 with the statistics of the whole store (as
 * FTS5 does), filters before the limit, ranking or time order. A query outside the grammar finds
 * nothing, like an FTS5 syntax error.
 */
function evaluate(query: string, indexed: IndexedDocument[], options: SearchOptions): SearchHit[] {
  const expression = parseQuery(query);
  if (!expression) return [];
  const queryPhrases = phrases(expression);
  const total = indexed.length;
  if (total === 0) return [];
  const averageLength = indexed.reduce((sum, d) => sum + d.length, 0) / total || 1;
  const frequencies = indexed.map((d) => queryPhrases.map((p) => occurrences(p, d).length));
  const idf = queryPhrases.map((_, p) => {
    const containing = frequencies.filter((f) => f[p]! > 0).length;
    const value = Math.log((total - containing + 0.5) / (containing + 0.5));
    return value <= 0 ? 1e-6 : value;
  });
  const roles = options.roles?.length ? new Set(options.roles) : null;
  const hits: SearchHit[] = [];
  indexed.forEach((d, row) => {
    if (roles && !roles.has(d.document.role)) return;
    if (options.filter && !options.filter(d.document)) return;
    const cache = new Map<Phrase, number>();
    queryPhrases.forEach((p, i) => cache.set(p, frequencies[row]![i]!));
    if (!matches(expression, d, cache)) return;
    let score = 0;
    queryPhrases.forEach((_, p) => {
      const f = frequencies[row]![p]!;
      score += (idf[p]! * f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.length) / averageLength));
    });
    hits.push({ id: d.document.id, sessionId: d.document.sessionId, role: d.document.role, snippet: snippet(d, queryPhrases), timestamp: d.document.timestamp, rank: -score });
  });
  return rankAndSort(hits, options.sort).slice(0, options.limit ?? 20);
}

/**
 * Substring search, Hermes' LIKE fallback used when tool output is searched: the boolean subset
 * compiled to case-insensitive substring tests, newest first (oldest first with sort oldest).
 */
function substringSearch(query: string, documents: SearchDocument[], options: SearchOptions): SearchHit[] {
  const groups: { term: string; negated: boolean }[][] = [[]];
  let negateNext = false;
  for (const token of query.match(LIKE_TOKEN) ?? []) {
    const upper = token.toUpperCase();
    if (upper === "OR") {
      if (groups.at(-1)!.length) groups.push([]);
      negateNext = false;
      continue;
    }
    if (upper === "AND" || upper === "NEAR") continue;
    if (upper === "NOT") {
      negateNext = true;
      continue;
    }
    const term = token.replace(/^"+|"+$/g, "").replace(/^\*+|\*+$/g, "").trim();
    if (term) groups.at(-1)!.push({ term: term.toLowerCase(), negated: negateNext });
    negateNext = false;
  }
  const usable = groups.filter((g) => g.some((t) => !t.negated));
  const snippetTerm = usable.flat().find((t) => !t.negated)?.term;
  if (!usable.length || !snippetTerm) return [];
  const roles = options.roles?.length ? new Set(options.roles) : null;
  const hits = documents
    .filter((d) => (!roles || roles.has(d.role)) && (!options.filter || options.filter(d)))
    .filter((d) => {
      const haystack = d.columns.join("\n").toLowerCase();
      return usable.some((group) => group.every((t) => haystack.includes(t.term) !== t.negated));
    })
    .map((d) => {
      const content = d.columns[0] ?? "";
      const at = content.toLowerCase().indexOf(snippetTerm);
      return { id: d.id, sessionId: d.sessionId, role: d.role, snippet: content.slice(Math.max(0, at - 40), Math.max(0, at - 40) + 120), timestamp: d.timestamp, rank: 0 };
    });
  const direction = options.sort === "oldest" ? 1 : -1;
  return hits.sort((a, b) => direction * (a.timestamp - b.timestamp || a.id - b.id)).slice(0, options.limit ?? 20);
}

/**
 * Hermes' `search_messages` route: sanitize, search tool output by substring, otherwise rank with
 * BM25 and, when nothing matches, retry once with the terms joined by OR.
 */
export function searchMessages(query: string, documents: SearchDocument[], options: SearchOptions = {}): SearchHit[] {
  if (!query.trim()) return [];
  const sanitized = sanitizeQuery(query);
  if (!sanitized) return [];
  if (options.roles?.includes("tool")) return substringSearch(sanitized, documents, options);
  const indexed = documents.map((document) => {
    const columns = document.columns.map((c) => tokenize(c));
    return { document, columns, length: columns.reduce((sum, c) => sum + c.length, 0) };
  });
  if (parseQuery(sanitized) === null) return [];
  const hits = evaluate(sanitized, indexed, options);
  if (hits.length || containsCjk(sanitized)) return hits;
  const relaxed = orRelaxedQuery(sanitized);
  return relaxed ? evaluate(relaxed, indexed, options) : [];
}
