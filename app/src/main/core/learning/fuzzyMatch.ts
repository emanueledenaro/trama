/**
 * Fuzzy find-and-replace for edits an agent writes, ported from Hermes Agent `tools/fuzzy_match.py`
 * (revision 58c896e, MIT, Copyright (c) 2025 Nous Research). An ordered chain of increasingly
 * permissive strategies lets whitespace, indentation, escaping and Unicode drift still land on the
 * intended region; the two similarity strategies never apply to more than one match.
 */
import { SequenceMatcher, similarity } from "./sequenceMatcher";

type Span = [number, number];

export const IDENTICAL_STRINGS_ERROR =
  "No edit was applied because old_string and new_string are identical. Provide the existing text to replace in old_string and the changed replacement text in new_string.";

const UNICODE_MAP: Record<string, string> = {
  "“": '"',
  "”": '"',
  "‘": "'",
  "’": "'",
  "—": "--",
  "–": "-",
  "…": "...",
  " ": " ",
  "−": "-",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  "　": " ",
};

const unicodeNormalize = (text: string) => text.replace(/[“”‘’—–… − -   　]/g, (c) => UNICODE_MAP[c]!);

const strip = (s: string) => s.replace(/^\s+|\s+$/g, "");
const lstrip = (s: string) => s.replace(/^\s+/, "");

function linePositions(lines: string[], start: number, end: number, length: number): Span {
  let startPos = 0;
  for (let i = 0; i < start; i += 1) startPos += lines[i]!.length + 1;
  let endPos = -1;
  for (let i = 0; i < end; i += 1) endPos += lines[i]!.length + 1;
  return [startPos, Math.min(length, endPos)];
}

function windowSpans(content: string, lines: string[], n: number, accept: (i: number) => boolean): Span[] {
  const spans: Span[] = [];
  for (let i = 0; i < lines.length - n + 1; i += 1) if (accept(i)) spans.push(linePositions(lines, i, i + n, content.length));
  return spans;
}

function matchTransformedLines(content: string, pattern: string, transform: (lines: string[]) => string[]): Span[] {
  const lines = content.split("\n");
  const normalized = transform(pattern.split("\n"));
  const n = normalized.length;
  return windowSpans(content, lines, n, (i) => {
    const block = transform(lines.slice(i, i + n));
    return block.length === n && block.every((line, k) => line === normalized[k]);
  });
}

function stripBoundary(lines: string[]): string[] {
  const out = [...lines];
  out[0] = strip(out[0]!);
  if (out.length > 1) out[out.length - 1] = strip(out.at(-1)!);
  return out;
}

function origToNormMap(original: string): number[] {
  const result: number[] = [];
  let position = 0;
  for (const char of original.split("")) {
    result.push(position);
    const replacement = UNICODE_MAP[char];
    position += replacement !== undefined ? replacement.length : 1;
  }
  result.push(position);
  return result;
}

function invertNormMap(map: number[]): Map<number, number> {
  const inverted = new Map<number, number>();
  map.slice(0, -1).forEach((norm, orig) => {
    if (!inverted.has(norm)) inverted.set(norm, orig);
  });
  return inverted;
}

function normEndToOrig(map: number[], origStart: number, normEnd: number): number {
  const length = map.length - 1;
  let end = origStart;
  while (end < length && map[end]! < normEnd) end += 1;
  return end;
}

function mapNormToOrig(map: number[], matches: Span[]): Span[] {
  const starts = invertNormMap(map);
  const result: Span[] = [];
  for (const [normStart, normEnd] of matches) {
    const origStart = starts.get(normStart);
    if (origStart !== undefined) result.push([origStart, normEndToOrig(map, origStart, normEnd)]);
  }
  return result;
}

function mapWhitespacePositions(original: string, normalized: string, matches: Span[]): Span[] {
  const map: number[] = [];
  let o = 0;
  let n = 0;
  while (o < original.length && n < normalized.length) {
    if (original[o] === normalized[n]) {
      map.push(n);
      o += 1;
      n += 1;
    } else if ((original[o] === " " || original[o] === "\t") && normalized[n] === " ") {
      map.push(n);
      o += 1;
      if (o < original.length && original[o] !== " " && original[o] !== "\t") n += 1;
    } else {
      map.push(n);
      o += 1;
    }
  }
  while (map.length < original.length) map.push(normalized.length);
  const starts = new Map<number, number>();
  const ends = new Map<number, number>();
  map.forEach((norm, orig) => {
    if (!starts.has(norm)) starts.set(norm, orig);
    ends.set(norm, orig);
  });
  return matches.map(([normStart, normEnd]) => {
    const origStart = starts.get(normStart) ?? map.findIndex((v) => v >= normStart);
    let origEnd = ends.has(normEnd - 1) ? ends.get(normEnd - 1)! + 1 : origStart + (normEnd - normStart);
    if (normEnd < normalized.length && normalized[normEnd - 1] === " ") {
      while (origEnd < original.length && (original[origEnd] === " " || original[origEnd] === "\t")) origEnd += 1;
    }
    return [origStart, Math.min(origEnd, original.length)] as Span;
  });
}

function exact(content: string, pattern: string): Span[] {
  const spans: Span[] = [];
  let from = 0;
  while (pattern.length) {
    const at = content.indexOf(pattern, from);
    if (at < 0) break;
    spans.push([at, at + pattern.length]);
    from = at + pattern.length;
  }
  return spans;
}

const lineTrimmed = (content: string, pattern: string) => matchTransformedLines(content, pattern, (ls) => ls.map(strip));

function whitespaceNormalized(content: string, pattern: string): Span[] {
  const normalize = (s: string) => s.replace(/[ \t]+/g, " ");
  const normalizedContent = normalize(content);
  const found = exact(normalizedContent, normalize(pattern));
  return found.length ? mapWhitespacePositions(content, normalizedContent, found) : [];
}

const indentationFlexible = (content: string, pattern: string) => matchTransformedLines(content, pattern, (ls) => ls.map(lstrip));

function escapeNormalized(content: string, pattern: string): Span[] {
  const unescaped = pattern.replaceAll("\\n", "\n").replaceAll("\\t", "\t").replaceAll("\\r", "\r");
  return unescaped === pattern ? [] : exact(content, unescaped);
}

const trimmedBoundary = (content: string, pattern: string) => matchTransformedLines(content, pattern, stripBoundary);

function unicodeNormalized(content: string, pattern: string): Span[] {
  const normPattern = unicodeNormalize(pattern);
  const normContent = unicodeNormalize(content);
  if (normContent === content && normPattern === pattern) return [];
  let found = exact(normContent, normPattern);
  if (!found.length) found = lineTrimmed(normContent, normPattern);
  return found.length ? mapNormToOrig(origToNormMap(content), found) : [];
}

function blockAnchor(content: string, pattern: string): Span[] {
  const patternLines = unicodeNormalize(pattern).split("\n");
  if (patternLines.length < 2) return [];
  const first = strip(patternLines[0]!);
  const last = strip(patternLines.at(-1)!);
  const n = patternLines.length;
  const normLines = unicodeNormalize(content).split("\n");
  const candidates = new Set<number>();
  for (let i = 0; i < normLines.length - n + 1; i += 1) {
    if (strip(normLines[i]!) === first && strip(normLines[i + n - 1]!) === last) candidates.add(i);
  }
  const threshold = candidates.size === 1 ? 0.5 : 0.7;
  const middle = patternLines.slice(1, -1).join("\n");
  return windowSpans(content, content.split("\n"), n, (i) => {
    if (!candidates.has(i)) return false;
    if (n <= 2) return true;
    return similarity(normLines.slice(i + 1, i + n - 1).join("\n"), middle) >= threshold;
  });
}

function contextAware(content: string, pattern: string): Span[] {
  const patternLines = pattern.split("\n");
  const lines = content.split("\n");
  const n = patternLines.length;
  if (n > lines.length) return [];
  const first = strip(patternLines[0]!);
  const last = strip(patternLines.at(-1)!);
  const sim = (a: string, b: string) => (a === b ? 1 : similarity(a, b));
  return windowSpans(content, lines, n, (i) => {
    const block = lines.slice(i, i + n);
    if (sim(first, strip(block[0]!)) < 0.8) return false;
    if (sim(last, strip(block.at(-1)!)) < 0.8) return false;
    return patternLines.every((line, k) => !strip(line) || sim(strip(line), strip(block[k]!)) >= 0.8);
  });
}

const STRATEGIES: [string, (content: string, pattern: string) => Span[]][] = [
  ["exact", exact],
  ["line_trimmed", lineTrimmed],
  ["whitespace_normalized", whitespaceNormalized],
  ["indentation_flexible", indentationFlexible],
  ["escape_normalized", escapeNormalized],
  ["trimmed_boundary", trimmedBoundary],
  ["unicode_normalized", unicodeNormalized],
  ["block_anchor", blockAnchor],
  ["context_aware", contextAware],
];

const SIMILARITY_STRATEGIES = new Set(["block_anchor", "context_aware"]);

const matchedRegions = (content: string, matches: Span[]) => matches.map(([s, e]) => content.slice(s, e)).join("");

function formatMatchLocations(content: string, matches: Span[], cap = 5): string {
  const rows = matches.slice(0, cap).map(([start]) => {
    const lineNumber = content.slice(0, start).split("\n").length;
    const lineStart = content.lastIndexOf("\n", start - 1) + 1;
    let lineEnd = content.indexOf("\n", lineStart);
    if (lineEnd === -1) lineEnd = content.length;
    let snippet = strip(content.slice(lineStart, lineEnd));
    if (snippet.length > 80) snippet = `${snippet.slice(0, 77)}...`;
    return `  L${lineNumber}: ${snippet}`;
  });
  if (matches.length > cap) rows.push(`  ... and ${matches.length - cap} more`);
  return rows.join("\n");
}

const backslashRuns = (s: string) => (s.match(/\\+/g) ?? []).map((run) => run.length);

function detectEscapeDrift(content: string, matches: Span[], oldString: string, newString: string): string | null {
  const quoteSuspects = newString.includes("\\'") || newString.includes('\\"');
  if (!quoteSuspects && !oldString.includes("\\")) return null;
  const regions = matchedRegions(content, matches);
  if (quoteSuspects) {
    for (const suspect of ["\\'", '\\"']) {
      if (newString.includes(suspect) && oldString.includes(suspect) && !regions.includes(suspect)) {
        const plain = suspect[1]!;
        const repr = (s: string) => (s.includes("'") && !s.includes('"') ? `"${s.replace(/\\/g, "\\\\")}"` : `'${s.replace(/\\/g, "\\\\")}'`);
        return `Escape-drift detected: old_string and new_string contain the literal sequence ${repr(suspect)} but the matched region of the file does not. This is almost always a tool-call serialization artifact where an apostrophe or quote got prefixed with a spurious backslash. Re-read the file with read_file and pass old_string/new_string without backslash-escaping ${repr(plain)} characters.`;
      }
    }
  }
  const oldRuns = backslashRuns(oldString);
  const fileRuns = backslashRuns(regions);
  const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  if (
    !oldRuns.length ||
    !fileRuns.length ||
    oldRuns.length !== fileRuns.length ||
    same(oldRuns, fileRuns) ||
    oldRuns.some((o, i) => o !== fileRuns[i]! * 2) ||
    !(fileRuns.some((f) => f >= 2) || fileRuns.length >= 2) ||
    same(backslashRuns(newString), fileRuns)
  ) {
    return null;
  }
  return "Escape-drift detected: every backslash run in old_string is exactly twice as long as in the matched region of the file (e.g. the file has `\\\\` where old_string has `\\\\\\\\`). The tool-call arguments were JSON-escaped one extra time; applying new_string verbatim would double every backslash in the file. Re-read the file with read_file and resend old_string/new_string with the backslash counts exactly as they appear in the file.";
}

function maybeUnescapeNewString(newString: string, content: string, matches: Span[]): string {
  if (!newString.includes("\\t") && !newString.includes("\\r")) return newString;
  const regions = matchedRegions(content, matches);
  let result = newString;
  for (const [literal, control] of [
    ["\\t", "\t"],
    ["\\r", "\r"],
  ] as const) {
    if (result.includes(literal) && regions.includes(control)) result = result.replaceAll(literal, control);
  }
  return result;
}

const leadingWhitespace = (line: string) => line.slice(0, line.length - line.replace(/^[ \t]+/, "").length);
const firstMeaningfulLine = (text: string) => text.split("\n").find((line) => strip(line)) ?? null;

function reindentReplacement(fileRegion: string, oldString: string, newString: string): string {
  if (!newString) return newString;
  const oldFirst = firstMeaningfulLine(oldString);
  const fileFirst = firstMeaningfulLine(fileRegion);
  if (oldFirst === null || fileFirst === null) return newString;
  const oldIndent = leadingWhitespace(oldFirst);
  const fileIndent = leadingWhitespace(fileFirst);
  if (oldIndent === fileIndent) return newString;
  return newString
    .split("\n")
    .map((line) => {
      if (!strip(line)) return line;
      if (leadingWhitespace(line).startsWith(oldIndent)) return fileIndent + line.slice(oldIndent.length);
      return fileIndent + line.replace(/^[ \t]+/, "");
    })
    .join("\n");
}

function preserveUnicodeInReplacement(content: string, matches: Span[], oldString: string, newString: string): string {
  const fileRegion = matchedRegions(content, matches);
  const normOld = unicodeNormalize(oldString);
  if (normOld !== unicodeNormalize(fileRegion)) return newString;
  const map = origToNormMap(fileRegion);
  const inverted = invertNormMap(map);
  const parts: string[] = [];
  for (const [tag, i1, i2, j1, j2] of new SequenceMatcher(normOld, newString).getOpcodes()) {
    if (tag === "equal") {
      const origStart = inverted.get(i1) ?? 0;
      parts.push(fileRegion.slice(origStart, normEndToOrig(map, origStart, i2)));
    } else if (tag !== "delete") {
      parts.push(newString.slice(j1, j2));
    }
  }
  return parts.join("");
}

function applyReplacements(content: string, matches: Span[], newString: string, oldString: string | null): string {
  let result = content;
  for (const [start, end] of [...matches].sort((a, b) => b[0] - a[0])) {
    const adjusted = oldString !== null ? reindentReplacement(content.slice(start, end), oldString, newString) : newString;
    result = result.slice(0, start) + adjusted + result.slice(end);
  }
  return result;
}

export interface FuzzyResult {
  content: string;
  count: number;
  strategy: string | null;
  error: string | null;
}

export function fuzzyFindAndReplace(content: string, oldString: string, newString: string, replaceAll = false): FuzzyResult {
  const fail = (error: string): FuzzyResult => ({ content, count: 0, strategy: null, error });
  if (!oldString) {
    return fail(
      "old_string is empty — nothing to match. Set old_string to the exact existing text the replacement should replace (read the file first if unsure). To create a new file or fully rewrite one, use write_file instead. Do not re-send this call unchanged.",
    );
  }
  if (!strip(oldString)) {
    return fail(
      "old_string is only whitespace — provide non-blank text to match. Set it to the exact existing text the replacement should replace (read the file first if unsure). Do not re-send this call unchanged.",
    );
  }
  if (oldString === newString) return fail(IDENTICAL_STRINGS_ERROR);
  for (const [name, strategy] of STRATEGIES) {
    const matches = strategy(content, oldString);
    if (!matches.length) continue;
    if (matches.length > 1 && !replaceAll) {
      return fail(`Found ${matches.length} matches for old_string. Provide more context to make it unique, or use replace_all=True. Matches:\n${formatMatchLocations(content, matches)}`);
    }
    if (replaceAll && matches.length > 1 && SIMILARITY_STRATEGIES.has(name)) {
      return fail(
        `Found ${matches.length} approximate matches via the '${name}' strategy; replace_all only applies to exact matches. Provide the precise text (whitespace included) so an exact/line-trimmed match can be made.`,
      );
    }
    if (name !== "exact") {
      const drift = detectEscapeDrift(content, matches, oldString, newString);
      if (drift) return fail(drift);
    }
    let effective = maybeUnescapeNewString(newString, content, matches);
    if (name === "unicode_normalized") effective = preserveUnicodeInReplacement(content, matches, oldString, effective);
    return { content: applyReplacements(content, matches, effective, name !== "exact" ? oldString : null), count: matches.length, strategy: name, error: null };
  }
  return fail("Could not find a match for old_string in the file");
}

const visualizeWhitespace = (line: string) => {
  const stripped = line.replace(/^[ \t]+/, "");
  return line.slice(0, line.length - stripped.length).replaceAll("\t", "→").replaceAll(" ", "·") + stripped;
};

const splitLines = (text: string) => text.split(/\r\n|\r|\n/).filter((_, i, all) => !(i === all.length - 1 && all[i] === ""));

function closestLines(oldString: string, content: string, contextLines = 2, maxResults = 3): string {
  if (!oldString || !content) return "";
  const oldLines = splitLines(oldString);
  const lines = splitLines(content);
  if (!oldLines.length || !lines.length) return "";
  const anchor = strip(oldLines[0]!) || oldLines.map(strip).find(Boolean) || "";
  if (!anchor) return "";
  const scored = lines
    .map((line, i) => ({ score: strip(line) ? similarity(anchor, strip(line)) : -1, i }))
    .filter((s) => s.score >= 0)
    .sort((a, b) => b.score - a.score);
  const top = scored.filter((s) => s.score > 0.3).slice(0, maxResults);
  if (!top.length) return "";
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const { i } of top) {
    const start = Math.max(0, i - contextLines);
    const end = Math.min(lines.length, i + oldLines.length + contextLines);
    if (seen.has(`${start}:${end}`)) continue;
    seen.add(`${start}:${end}`);
    parts.push(lines.slice(start, end).map((line, j) => `${String(start + j + 1).padStart(4)}| ${line}`).join("\n"));
  }
  let result = parts.join("\n---\n");
  const best = lines[top[0]!.i]!;
  if (strip(best) === anchor && best !== oldLines[0]) {
    result += `\n\nWhitespace difference detected (→ = tab, · = space):\n  file has: ${visualizeWhitespace(best)}\n  you sent: ${visualizeWhitespace(oldLines[0]!)}\nUse the exact whitespace shown in 'file has'.`;
  }
  return result;
}

/** "Did you mean" snippets, only for a plain no-match error. */
export function formatNoMatchHint(error: string | null, count: number, oldString: string, content: string): string {
  if (count !== 0 || !error || !error.startsWith("Could not find")) return "";
  const hint = closestLines(oldString, content);
  return hint ? `\n\nDid you mean one of these sections?\n${hint}` : "";
}
