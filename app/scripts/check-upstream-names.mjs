// Keeps the names of the upstream projects Trama ports code from inside the legal attribution files.
// The names are listed in docs/legal/upstream-names.txt, one per line, so this script and its test
// never spell them. A tracked file fails when its path or its text contains one of them, ignoring
// case, unless it is THIRD_PARTY_NOTICES.md or sits under docs/legal/. Binary files and symbolic
// links are read by path only.
// Usage: node scripts/check-upstream-names.mjs
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const NAMES_FILE = "docs/legal/upstream-names.txt";

export function isLegalPath(path) {
  return path === "THIRD_PARTY_NOTICES.md" || path.startsWith("docs/legal/");
}

export function parseNames(text) {
  return text
    .split("\n")
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line && !line.startsWith("#"));
}

/** Returns one finding per offending file: the path and the lines (1-based) that name a project. */
export function findUpstreamNames(files, names) {
  const findings = [];
  for (const { path, text } of files) {
    if (isLegalPath(path)) continue;
    const inPath = names.some((name) => path.toLowerCase().includes(name));
    const lines = [];
    if (text !== null) {
      text.split("\n").forEach((line, index) => {
        const lower = line.toLowerCase();
        if (names.some((name) => lower.includes(name))) lines.push(index + 1);
      });
    }
    if (inPath || lines.length) findings.push({ path, inPath, lines });
  }
  return findings;
}

function readTracked(root, path) {
  const full = join(root, path);
  if (lstatSync(full).isSymbolicLink()) return null;
  const buffer = readFileSync(full);
  return buffer.includes(0) ? null : buffer.toString("utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const names = parseNames(readFileSync(join(root, NAMES_FILE), "utf8"));
  if (!names.length) {
    console.error(`${NAMES_FILE} lists no names.`);
    process.exit(1);
  }
  const paths = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  const files = paths.map((path) => ({ path, text: readTracked(root, path) }));
  const findings = findUpstreamNames(files, names);
  if (findings.length) {
    console.error("Upstream project names found outside THIRD_PARTY_NOTICES.md and docs/legal/:");
    for (const { path, inPath, lines } of findings) {
      const where = [inPath ? "path" : "", lines.length ? `lines ${lines.join(", ")}` : ""].filter(Boolean).join("; ");
      console.error(`  ${path} (${where})`);
    }
    process.exit(1);
  }
  console.log(`${paths.length} tracked paths, upstream names only in the legal attribution files.`);
}
