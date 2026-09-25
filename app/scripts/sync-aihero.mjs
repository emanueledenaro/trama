// Rebuilds resources/AIHero/skills from a checkout of https://github.com/mattpocock/skills at the pinned release,
// applying only the declared brand substitutions, and writes resources/AIHero/bundle.json so tests can compare
// every bundled file with its upstream source.
// Usage: node scripts/sync-aihero.mjs <path-to-upstream-checkout>
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const RELEASE = "v1.2.3";
const COMMIT = "6acc160e4e0cd062dbbbd7a1b26ae92855edf07e";
const TAG_OBJECT = "835450ef244ab7335f75d95b83e7d979eae22a6d";
const SOURCE = "https://github.com/mattpocock/skills";
/** Upstream folders copied flat by skill name; `in-progress` and `deprecated` stay out. */
const CATEGORIES = ["engineering", "productivity", "misc"];
/** Misc skills can be invoked with "/" but are not part of Trama's automatic flow. */
const AUTOMATIC = new Set(["engineering", "productivity"]);
const RENAMES = { "ask-matt": "ask-trama", "setup-matt-pocock-skills": "setup-trama" };
/** Exact text replacements, applied in order to every file. Nothing else in the method text changes. */
const SUBSTITUTIONS = [
  { from: "setup-matt-pocock-skills", to: "setup-trama" },
  { from: "ask-matt", to: "ask-trama" },
  { from: "# Setup Matt Pocock's Skills", to: "# Setup Trama" },
  { from: 'display_name: "Setup Matt Pocock Skills"', to: 'display_name: "Setup Trama"' },
  { from: "# Ask Matt", to: "# Ask Trama" },
  { from: 'display_name: "Ask Matt"', to: 'display_name: "Ask Trama"' },
  // Same width, so the Markdown table stays aligned.
  { from: "| Label in mattpocock/skills |", to: `| ${"Label in Trama".padEnd("Label in mattpocock/skills".length)} |` },
];

const upstream = resolve(process.argv[2] ?? "");
const head = execFileSync("git", ["-C", upstream, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (head !== COMMIT) throw new Error(`Upstream checkout is at ${head}, expected ${COMMIT} (${RELEASE}).`);

const appRoot = resolve(import.meta.dirname, "..");
const target = join(appRoot, "resources/AIHero/skills");
await rm(target, { recursive: true, force: true });

const sha = (data) => createHash("sha256").update(data).digest("hex");
const count = (text, part) => text.split(part).length - 1;
const skills = [];
const files = [];

async function walk(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic link in upstream skills: ${path}`);
    if (entry.isDirectory()) found.push(...(await walk(path)));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

for (const category of CATEGORIES) {
  const root = join(upstream, "skills", category);
  for (const entry of (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const upstreamName = entry.name;
    const name = RENAMES[upstreamName] ?? upstreamName;
    skills.push({ name, upstreamName, category, automatic: AUTOMATIC.has(category) });
    for (const source of (await walk(join(root, upstreamName))).sort()) {
      const original = await readFile(source);
      let text = original.toString("utf8");
      const applied = [];
      for (const { from, to } of SUBSTITUTIONS) {
        const n = count(text, from);
        if (!n) continue;
        text = text.split(from).join(to);
        applied.push({ from, to, count: n });
      }
      const data = applied.length ? Buffer.from(text, "utf8") : original;
      const bundledPath = `${name}/${relative(join(root, upstreamName), source).split("\\").join("/")}`;
      const destination = join(target, bundledPath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, data);
      await chmod(destination, (await stat(source)).mode & 0o777);
      files.push({
        path: bundledPath,
        upstreamPath: relative(upstream, source).split("\\").join("/"),
        upstreamSha256: sha(original),
        substitutions: applied,
      });
    }
  }
}

// The upstream license and copyright notice ship unchanged.
const license = await readFile(join(upstream, "LICENSE"));
await writeFile(join(appRoot, "resources/AIHero/LICENSE"), license);

const manifest = {
  source: SOURCE,
  release: RELEASE,
  commit: COMMIT,
  tagObject: TAG_OBJECT,
  license: { path: "LICENSE", upstreamPath: "LICENSE", upstreamSha256: sha(license) },
  renames: RENAMES,
  substitutions: SUBSTITUTIONS,
  skills,
  files,
};
await writeFile(join(appRoot, "resources/AIHero/bundle.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${skills.length} skills, ${files.length} files, ${files.filter((f) => f.substitutions.length).length} with substitutions.`);
