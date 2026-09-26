// Rejects tracked paths that collide on a case-insensitive disk (macOS and Windows by default).
// Two kinds of collision: whole paths that differ only by case, and modules that an import without
// extension cannot tell apart, such as TramaMark.tsx and tramaMark.ts in the same folder.
// Usage: node scripts/check-file-names.mjs
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const MODULE = /\.(tsx?|mts|cts|jsx?|mjs|cjs)$/;

export function caseCollisions(paths) {
  const groups = new Map();
  const add = (key, path) => {
    const lower = key.toLowerCase();
    const group = groups.get(lower) ?? new Map();
    group.set(key, [...(group.get(key) ?? []), path]);
    groups.set(lower, group);
  };
  for (const path of paths) {
    add(path, path);
    if (MODULE.test(path)) add(`module:${path.replace(MODULE, "")}`, path);
  }
  const collisions = [];
  for (const group of groups.values()) {
    if (group.size > 1) collisions.push([...new Set([...group.values()].flat())].sort());
  }
  return collisions;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const paths = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  const collisions = caseCollisions(paths);
  if (collisions.length) {
    console.error("These paths collide on a case-insensitive disk (macOS, Windows):");
    for (const group of collisions) console.error(`  ${group.join("  <->  ")}`);
    process.exit(1);
  }
  console.log(`${paths.length} tracked paths, no case collisions.`);
}
