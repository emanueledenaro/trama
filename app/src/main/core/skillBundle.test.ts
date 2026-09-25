import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_SKILLS, RENAMED_SKILLS, SKILL_COMMIT, SKILL_RELEASE } from "./skillSetup";

const resources = join(import.meta.dirname, "../../../resources/AIHero");
/** Optional local checkout of mattpocock/skills at the pinned commit, for a byte-by-byte comparison. */
const upstreamCheckout = process.env.AIHERO_UPSTREAM;

interface Substitution {
  from: string;
  to: string;
}
interface Bundle {
  release: string;
  commit: string;
  license: { path: string; upstreamSha256: string };
  renames: Record<string, string>;
  substitutions: Substitution[];
  skills: { name: string; upstreamName: string; category: string; automatic: boolean }[];
  files: { path: string; upstreamPath: string; upstreamSha256: string; substitutions: (Substitution & { count: number })[] }[];
}

const bundle = JSON.parse(await readFile(join(resources, "bundle.json"), "utf8")) as Bundle;
const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const occurrences = (text: string, part: string) => text.split(part).length - 1;

async function listFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await listFiles(path)));
    else found.push(path);
  }
  return found;
}

/** Undoes the declared substitutions, in reverse order, checking each one appears exactly as declared. */
function toUpstream(text: string, substitutions: (Substitution & { count: number })[]): string {
  let result = text;
  for (const { from, to, count } of [...substitutions].reverse()) {
    expect(occurrences(result, to), `"${to}"`).toBe(count);
    result = result.split(to).join(from);
  }
  return result;
}

describe("AI Hero bundle (M08)", () => {
  it("pins the release and lists every engineering, productivity and misc skill", () => {
    expect(bundle.release).toBe(SKILL_RELEASE);
    expect(bundle.commit).toBe(SKILL_COMMIT);
    expect(bundle.renames).toEqual(RENAMED_SKILLS);
    expect(bundle.skills.map(({ name, category, automatic }) => ({ name, category, automatic }))).toEqual(BUNDLED_SKILLS);
    expect(bundle.skills.filter((s) => s.category === "misc").every((s) => !s.automatic)).toBe(true);
    for (const skill of bundle.skills) expect(skill.name).toBe(RENAMED_SKILLS[skill.upstreamName] ?? skill.upstreamName);
  });

  it("ships exactly the files the record lists", async () => {
    const skills = join(resources, "skills");
    expect((await readdir(skills)).sort()).toEqual(BUNDLED_SKILLS.map((s) => s.name).sort());
    const onDisk = (await listFiles(skills)).map((path) => relative(skills, path).split("\\").join("/")).sort();
    expect(onDisk).toEqual(bundle.files.map((f) => f.path).sort());
  });

  it("matches the upstream source file by file, except the declared substitutions", async () => {
    const declared = new Set(bundle.substitutions.map((s) => JSON.stringify([s.from, s.to])));
    for (const file of bundle.files) {
      for (const s of file.substitutions) expect(declared.has(JSON.stringify([s.from, s.to])), file.path).toBe(true);
      const bundled = await readFile(join(resources, "skills", file.path));
      const original = file.substitutions.length ? Buffer.from(toUpstream(bundled.toString("utf8"), file.substitutions), "utf8") : bundled;
      expect(sha(original), file.path).toBe(file.upstreamSha256);
    }
  });

  it("keeps the upstream MIT license and copyright notice untouched", async () => {
    const license = await readFile(join(resources, bundle.license.path));
    expect(sha(license)).toBe(bundle.license.upstreamSha256);
    expect(license.toString("utf8")).toContain("Copyright (c) 2026 Matt Pocock");
  });

  it("leaves no Matt brand in the skill text", async () => {
    for (const file of bundle.files) {
      const text = await readFile(join(resources, "skills", file.path), "utf8");
      expect(text, file.path).not.toMatch(/\bMatt\b|mattpocock|Pocock|ask-matt|setup-matt/);
    }
    const askTrama = await readFile(join(resources, "skills/ask-trama/SKILL.md"), "utf8");
    expect(askTrama).toMatch(/^---\nname: ask-trama\n/);
    expect(askTrama).toContain("# Ask Trama");
    expect(await readFile(join(resources, "skills/setup-trama/SKILL.md"), "utf8")).toMatch(/^---\nname: setup-trama\n/);
  });

  it.skipIf(!upstreamCheckout)("equals a local upstream checkout byte by byte after the substitutions", async () => {
    const root = upstreamCheckout!;
    expect(sha(await readFile(join(root, "LICENSE")))).toBe(bundle.license.upstreamSha256);
    for (const file of bundle.files) {
      const upstream = join(root, file.upstreamPath);
      expect(existsSync(upstream), file.upstreamPath).toBe(true);
      let text = await readFile(upstream, "utf8");
      for (const { from, to } of bundle.substitutions) text = text.split(from).join(to);
      expect(text, file.path).toBe(await readFile(join(resources, "skills", file.path), "utf8"));
    }
  });
});
