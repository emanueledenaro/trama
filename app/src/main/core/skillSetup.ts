import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, lstat, mkdir, readdir, readFile, realpath, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { AIHERO_ATTRIBUTION } from "@shared/skills";

export const SKILL_RELEASE = "v1.2.3";
export const SKILL_COMMIT = "6acc160e4e0cd062dbbbd7a1b26ae92855edf07e";
/** Upstream release plus Trama's packaging revision: `trama.2` is the full bundle with Trama's names (M08). */
export const SKILL_VERSION = `${SKILL_RELEASE}+trama.2 (${SKILL_COMMIT})`;
export const SKILL_SOURCE = "https://github.com/mattpocock/skills";
export const SKILL_ATTRIBUTION = AIHERO_ATTRIBUTION;
const MAXIMUM_PACKAGED_BYTES = 3 * 1_024 * 1_024;

export type SkillCategory = "engineering" | "productivity" | "misc";

/**
 * Every bundled skill, from the upstream `engineering`, `productivity` and `misc` folders of the release.
 * `automatic` skills can be used by Trama's own flow; misc skills are only invoked by the person with "/".
 * `resources/AIHero/bundle.json` is the machine-readable record of the same list and of every substitution.
 */
export const BUNDLED_SKILLS: readonly { name: string; category: SkillCategory; automatic: boolean }[] = [
  ...[
    "ask-trama",
    "code-review",
    "codebase-design",
    "diagnosing-bugs",
    "domain-modeling",
    "grill-with-docs",
    "implement",
    "improve-codebase-architecture",
    "prototype",
    "research",
    "resolving-merge-conflicts",
    "setup-trama",
    "tdd",
    "to-spec",
    "to-tickets",
    "triage",
    "wayfinder",
    "wizard",
  ].map((name) => ({ name, category: "engineering" as const, automatic: true })),
  ...["grill-me", "grilling", "handoff", "teach", "to-questionnaire", "wait-what", "writing-for-agents"].map((name) => ({
    name,
    category: "productivity" as const,
    automatic: true,
  })),
  ...["git-guardrails-claude-code", "migrate-to-shoehorn", "scaffold-exercises", "setup-pre-commit"].map((name) => ({
    name,
    category: "misc" as const,
    automatic: false,
  })),
];
/** Every skill Trama copies into a project, so Codex's catalogue should list all of them. */
export const SELECTED_SKILLS = BUNDLED_SKILLS.map((s) => s.name);
/** Skills Trama's flow may start on its own. */
export const AUTOMATIC_SKILLS = BUNDLED_SKILLS.filter((s) => s.automatic).map((s) => s.name);
/** Skills available only when the person writes "/name". */
export const SLASH_ONLY_SKILLS = BUNDLED_SKILLS.filter((s) => !s.automatic).map((s) => s.name);
/** Upstream names that Trama renamed; projects prepared with the old names migrate on update. */
export const RENAMED_SKILLS: Readonly<Record<string, string>> = { "ask-matt": "ask-trama", "setup-matt-pocock-skills": "setup-trama" };

export interface SetupReport {
  pathsCreated: string[];
  existingPreserved: string[];
  warnings: string[];
  version: string;
}

interface PlannedWrite {
  relativePath: string;
  data: Buffer;
}

const agentsPointer = "# Istruzioni del progetto\n\nLeggere docs/agents/aihero-setup.md prima di usare le skill tecniche incluse.";
const SETUP_DOCUMENT = "docs/agents/aihero-setup.md";

function configurationDocument(repository: string): string {
  const list = (names: string[]) => names.map((s) => `- ${s}`).join("\n");
  const renames = Object.entries(RENAMED_SKILLS)
    .map(([from, to]) => `\`${from}\` è \`${to}\``)
    .join(", ");
  return `# Configurazione AI Hero

Repository selezionato in Trama: ${repository}

Il progetto contiene una copia locale delle skill di Matt Pocock, con i nomi di Trama. La copia non esegue installer e non modifica le impostazioni globali di Codex.

Versione: ${SKILL_VERSION}
Fonte: ${SKILL_SOURCE}
Licenza: MIT, Copyright (c) 2026 Matt Pocock
${SKILL_ATTRIBUTION}.
Nomi cambiati: ${renames}.

Skill del flusso di lavoro:
${list(AUTOMATIC_SKILLS)}

Skill disponibili solo con "/":
${list(SLASH_ONLY_SKILLS)}

Leggere il relativo file \`SKILL.md\` in \`.agents/skills\` prima di usare una skill. Le istruzioni già presenti nel progetto restano prioritarie.`;
}

function issueTrackerDocument(repository: string | null): string {
  if (repository) {
    return `# Issue tracker: GitHub

Repository selezionato in Trama: \`${repository}\`.

Le issue e le specifiche pubblicate per questo progetto usano GitHub. Usare \`gh --repo ${repository}\` per le operazioni remote autorizzate. Questa configurazione non crea issue, etichette o altri oggetti remoti.

Quando una skill chiede di pubblicare un ticket, creare una GitHub Issue nel repository selezionato. Quando chiede un ticket esistente, leggere la relativa issue con commenti ed etichette.`;
  }
  return `# Issue tracker: locale in attesa di GitHub

Trama non ha un repository remoto selezionato. Nessun tracker remoto è stato scelto o configurato.

Fino a quando il progetto non seleziona GitHub, conservare specifiche e ticket locali in \`.scratch/<feature>/\`. Usare \`.scratch/<feature>/spec.md\` per la specifica e \`.scratch/<feature>/issues/<NN>-<slug>.md\` per i ticket. Non creare o sincronizzare issue remote.`;
}

const domainDocument = `# Documentazione di dominio

Prima di esplorare il progetto, leggere \`CONTEXT.md\` alla radice quando esiste e le decisioni pertinenti in \`docs/adr/\`. Se i file non esistono, procedere senza crearli automaticamente.

Usare il vocabolario definito nel contesto del progetto. Se una modifica contraddice una decisione esistente, segnalarlo senza riscrivere la decisione.`;

const triageLabelsDocument = `# Etichette di triage

Questa mappa descrive i ruoli che le skill usano. Non prova che le etichette esistano nel tracker remoto.

| Ruolo skill | Etichetta prevista |
| --- | --- |
| \`needs-triage\` | \`needs-triage\` |
| \`needs-info\` | \`needs-info\` |
| \`ready-for-agent\` | \`ready-for-agent\` |
| \`ready-for-human\` | \`ready-for-human\` |
| \`wontfix\` | \`wontfix\` |`;

const versionDocument = `Skill AI Hero incluse

Repository sorgente: ${SKILL_SOURCE}
Release: ${SKILL_RELEASE}
Commit: ${SKILL_COMMIT}
Pacchetto Trama: ${SKILL_VERSION}
Nomi cambiati: ${Object.entries(RENAMED_SKILLS)
  .map(([from, to]) => `${from} -> ${to}`)
  .join(", ")}
Licenza: MIT, Copyright (c) 2026 Matt Pocock
${SKILL_ATTRIBUTION}.`;

async function walkFiles(directory: string, base: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Il setup non può usare il percorso: ${relative(base, path)}`);
    if (entry.isDirectory()) found.push(...(await walkFiles(path, base)));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

async function bundledFiles(resourcesRoot: string): Promise<PlannedWrite[]> {
  const files: PlannedWrite[] = [];
  let total = 0;
  for (const skill of SELECTED_SKILLS) {
    const directory = join(resourcesRoot, "skills", skill);
    if (!existsSync(join(directory, "SKILL.md"))) throw new Error(`Manca una risorsa AI Hero richiesta: skills/${skill}/SKILL.md`);
    for (const path of await walkFiles(directory, resourcesRoot)) {
      const data = await readFile(path);
      total += data.length;
      if (total > MAXIMUM_PACKAGED_BYTES) throw new Error(`Le risorse AI Hero superano il limite locale di 3 MB: ${total} byte.`);
      files.push({ relativePath: `.agents/skills/${relative(join(resourcesRoot, "skills"), path).split("\\").join("/")}`, data });
    }
  }
  files.push({ relativePath: ".agents/skills/AIHERO-LICENSE", data: await readFile(join(resourcesRoot, "LICENSE")) });
  files.push({ relativePath: ".agents/skills/AIHERO-VERSION.md", data: Buffer.from(versionDocument) });
  return files;
}

/** Hashes of the upstream files, by bundled path, from `bundle.json`; empty when the record is missing. */
async function upstreamHashes(resourcesRoot: string): Promise<Map<string, string>> {
  try {
    const bundle = JSON.parse(await readFile(join(resourcesRoot, "bundle.json"), "utf8")) as { files: { path: string; upstreamSha256: string }[] };
    return new Map(bundle.files.map((f) => [f.path, f.upstreamSha256]));
  } catch {
    return new Map();
  }
}

async function isInside(path: string, root: string): Promise<boolean> {
  let current = root;
  for (const component of relative(root, path).split(/[\\/]/)) {
    if (!component || component === "." || component === "..") return false;
    current = join(current, component);
    if (existsSync(current) && (await lstat(current)).isSymbolicLink()) return false;
  }
  return true;
}

/** Removes empty directories from `path` up to, and excluding, `stop`. */
async function pruneEmpty(path: string, stop: string): Promise<void> {
  let current = path;
  while (current.startsWith(stop) && current !== stop) {
    try {
      await rmdir(current);
    } catch {
      return;
    }
    current = dirname(current);
  }
}

/**
 * Copies Matt Pocock's skills, with Trama's names, into a project. Existing files are never overwritten;
 * nothing is installed and no global Codex setting changes.
 */
export async function prepareSkills(projectRoot: string, resourcesRoot: string, repository: string | null): Promise<SetupReport> {
  const root = await realpath(projectRoot);
  const writes = [
    ...(await bundledFiles(resourcesRoot)),
    { relativePath: SETUP_DOCUMENT, data: Buffer.from(configurationDocument(repository ?? "Non selezionato")) },
    { relativePath: "docs/agents/issue-tracker.md", data: Buffer.from(issueTrackerDocument(repository)) },
    { relativePath: "docs/agents/domain.md", data: Buffer.from(domainDocument) },
    { relativePath: "docs/agents/triage-labels.md", data: Buffer.from(triageLabelsDocument) },
    { relativePath: "AGENTS.md", data: Buffer.from(agentsPointer) },
  ].sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const report: SetupReport = { pathsCreated: [], existingPreserved: [], warnings: [], version: SKILL_VERSION };
  const manifest = await readManifest(root);
  const missing: PlannedWrite[] = [];
  for (const write of writes) {
    const target = join(root, write.relativePath);
    if (!(await isInside(target, root))) throw new Error(`Il setup non può usare il percorso: ${write.relativePath}`);
    if (existsSync(target)) {
      report.existingPreserved.push(write.relativePath);
      if (!(await readFile(target)).equals(write.data)) report.warnings.push(`Conflitto preservato: ${write.relativePath}.`);
    } else {
      missing.push(write);
    }
  }
  const created: string[] = [];
  try {
    for (const write of missing) {
      const target = join(root, write.relativePath);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, write.data, { flag: "wx" });
      created.push(target);
      report.pathsCreated.push(write.relativePath);
    }
  } catch (error) {
    for (const path of created.reverse()) await rm(path, { force: true });
    throw error;
  }
  if (missing.length) {
    for (const write of missing) manifest.files[write.relativePath] = sha(write.data);
    manifest.version = SKILL_VERSION;
    await writeManifest(root, manifest);
  }
  return report;
}

const MANIFEST = ".agents/skills/AIHERO-MANIFEST.json";
const BACKUPS = ".agents/skills/.trama-backup";
const CREATED_RECORD = "AIHERO-CREATED.json";

/** What Trama wrote, by path and content hash: a managed file is one whose content still matches. */
interface Manifest {
  version: string | null;
  files: Record<string, string>;
}

const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");

async function readManifest(root: string): Promise<Manifest> {
  try {
    return JSON.parse(await readFile(join(root, MANIFEST), "utf8")) as Manifest;
  } catch {
    return { version: null, files: {} };
  }
}

async function writeManifest(root: string, manifest: Manifest): Promise<void> {
  await mkdir(join(root, ".agents/skills"), { recursive: true });
  await writeFile(join(root, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** The installed version, from the manifest; null when Trama never prepared the method here. */
export async function installedSkillVersion(projectRoot: string): Promise<string | null> {
  return (await readManifest(await realpath(projectRoot))).version;
}

/**
 * Files under the old names of renamed skills. A file Trama wrote and nobody changed (its hash is in the
 * manifest, or it is the upstream original) retires; a file the person changed stays where it is.
 */
async function renamedSkillFiles(root: string, manifest: Manifest, upstream: Map<string, string>): Promise<{ retired: string[]; kept: string[] }> {
  const retired: string[] = [];
  const kept: string[] = [];
  for (const [oldName, newName] of Object.entries(RENAMED_SKILLS)) {
    const directory = join(root, ".agents/skills", oldName);
    if (!existsSync(directory) || !(await isInside(directory, root))) continue;
    for (const path of await walkFiles(directory, root)) {
      const relativePath = relative(root, path).split("\\").join("/");
      const hash = sha(await readFile(path));
      const original = upstream.get(`${newName}/${relative(directory, path).split("\\").join("/")}`);
      if (manifest.files[relativePath] === hash || original === hash) retired.push(relativePath);
      else kept.push(relativePath);
    }
  }
  return { retired, kept };
}

/**
 * Moves a project to the bundled version (T04, M08). Managed files the person did not touch are backed up
 * and replaced; files the person changed stay and are reported. Skills under their old upstream names move
 * to Trama's names: untouched copies are backed up and removed, customized ones stay. Works offline.
 */
export async function updateSkills(projectRoot: string, resourcesRoot: string, repository: string | null, now = new Date()): Promise<SetupReport> {
  const root = await realpath(projectRoot);
  const manifest = await readManifest(root);
  if (manifest.version === SKILL_VERSION) return prepareSkills(root, resourcesRoot, repository);
  const bundle = [
    ...(await bundledFiles(resourcesRoot)),
    { relativePath: SETUP_DOCUMENT, data: Buffer.from(configurationDocument(repository ?? "Non selezionato")) },
  ];
  const backup = join(root, BACKUPS, now.toISOString().replace(/[:.]/g, "-"));
  const report: SetupReport = { pathsCreated: [], existingPreserved: [], warnings: [], version: SKILL_VERSION };
  const replaced: PlannedWrite[] = [];
  for (const write of bundle) {
    const target = join(root, write.relativePath);
    if (!(await isInside(target, root))) throw new Error(`Il setup non può usare il percorso: ${write.relativePath}`);
    if (!existsSync(target)) continue;
    const current = await readFile(target);
    if (current.equals(write.data)) continue;
    if (manifest.files[write.relativePath] !== sha(current)) {
      report.existingPreserved.push(write.relativePath);
      report.warnings.push(`Modificato da te, non aggiornato: ${write.relativePath}.`);
      continue;
    }
    replaced.push(write);
  }
  const { retired, kept } = await renamedSkillFiles(root, manifest, await upstreamHashes(resourcesRoot));
  for (const path of kept) {
    report.existingPreserved.push(path);
    report.warnings.push(`Modificato da te, conservato con il vecchio nome: ${path}.`);
  }
  for (const relativePath of [...replaced.map((w) => w.relativePath), ...retired]) {
    const saved = join(backup, relativePath);
    await mkdir(join(saved, ".."), { recursive: true });
    await copyFile(join(root, relativePath), saved);
  }
  await mkdir(backup, { recursive: true });
  await writeFile(join(backup, "AIHERO-MANIFEST.json"), JSON.stringify(manifest, null, 2));
  for (const write of replaced) {
    await writeFile(join(root, write.relativePath), write.data);
    manifest.files[write.relativePath] = sha(write.data);
    report.pathsCreated.push(write.relativePath);
  }
  for (const relativePath of retired) {
    await rm(join(root, relativePath), { force: true });
    delete manifest.files[relativePath];
    await pruneEmpty(dirname(join(root, relativePath)), join(root, ".agents/skills"));
  }
  manifest.version = SKILL_VERSION;
  await writeManifest(root, manifest);
  const added = await prepareSkills(root, resourcesRoot, repository);
  await writeFile(join(backup, CREATED_RECORD), JSON.stringify(added.pathsCreated, null, 2));
  report.pathsCreated.push(...added.pathsCreated);
  return report;
}

/**
 * Restores the files and the manifest saved by the last update, and removes the files that update created.
 * A file the person edited after the update is kept and reported instead of being overwritten or removed.
 */
export async function rollbackSkills(projectRoot: string): Promise<{ restored: string[]; preserved: string[] }> {
  const root = await realpath(projectRoot);
  const backups = existsSync(join(root, BACKUPS)) ? (await readdir(join(root, BACKUPS))).sort() : [];
  const latest = backups.at(-1);
  if (!latest) throw new Error("Non c'è un aggiornamento del metodo da annullare.");
  const directory = join(root, BACKUPS, latest);
  const restored: string[] = [];
  const preserved: string[] = [];
  const current = await readManifest(root);
  const unchanged = async (relativePath: string, target: string) => current.files[relativePath] === sha(await readFile(target));
  for (const path of await walkFiles(directory, root)) {
    const relativePath = relative(directory, path).split("\\").join("/");
    if (relativePath === "AIHERO-MANIFEST.json" || relativePath === CREATED_RECORD) continue;
    const target = join(root, relativePath);
    if (!(await isInside(target, root))) continue;
    if (existsSync(target) && !(await unchanged(relativePath, target))) {
      preserved.push(relativePath);
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await copyFile(path, target);
    restored.push(relativePath);
  }
  const createdRecord = join(directory, CREATED_RECORD);
  const created = existsSync(createdRecord) ? (JSON.parse(await readFile(createdRecord, "utf8")) as string[]) : [];
  for (const relativePath of created) {
    const target = join(root, relativePath);
    if (!existsSync(target) || !(await isInside(target, root))) continue;
    if (!(await unchanged(relativePath, target))) {
      preserved.push(relativePath);
      continue;
    }
    await rm(target, { force: true });
    await pruneEmpty(dirname(target), root);
  }
  await copyFile(join(directory, "AIHERO-MANIFEST.json"), join(root, MANIFEST));
  await rm(directory, { recursive: true, force: true });
  return { restored, preserved };
}
