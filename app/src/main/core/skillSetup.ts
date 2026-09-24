import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

export const SKILL_VERSION = "v1.2.3 (6acc160e4e0cd062dbbbd7a1b26ae92855edf07e)";
export const SKILL_SOURCE = "https://github.com/mattpocock/skills";
const MAXIMUM_PACKAGED_BYTES = 3 * 1_024 * 1_024;
export const SELECTED_SKILLS = [
  "ask-matt",
  "setup-matt-pocock-skills",
  "to-spec",
  "to-tickets",
  "implement",
  "tdd",
  "code-review",
  "grilling",
  "grill-with-docs",
  "domain-modeling",
  "codebase-design",
  "writing-for-agents",
];

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

function configurationDocument(repository: string): string {
  return `# Configurazione AI Hero

Repository selezionato in Trama: ${repository}

Il progetto contiene un sottoinsieme locale delle skill di Matt Pocock. La copia non esegue installer e non modifica le impostazioni globali di Codex.

Versione: ${SKILL_VERSION}
Fonte: ${SKILL_SOURCE}
Licenza: MIT, Copyright (c) 2026 Matt Pocock

Skill incluse:
${SELECTED_SKILLS.map((s) => `- ${s}`).join("\n")}

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
Release: v1.2.3
Commit: 6acc160e4e0cd062dbbbd7a1b26ae92855edf07e
Licenza: MIT, Copyright (c) 2026 Matt Pocock`;

async function bundledFiles(resourcesRoot: string): Promise<PlannedWrite[]> {
  const files: PlannedWrite[] = [];
  let total = 0;
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Il setup non può usare il percorso: ${relative(resourcesRoot, path)}`);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const data = await readFile(path);
        total += data.length;
        if (total > MAXIMUM_PACKAGED_BYTES) throw new Error(`Le risorse AI Hero superano il limite locale di 3 MB: ${total} byte.`);
        files.push({ relativePath: `.agents/skills/${relative(join(resourcesRoot, "skills"), path).split("\\").join("/")}`, data });
      }
    }
  };
  for (const skill of SELECTED_SKILLS) {
    const directory = join(resourcesRoot, "skills", skill);
    if (!existsSync(join(directory, "SKILL.md"))) throw new Error(`Manca una risorsa AI Hero richiesta: skills/${skill}/SKILL.md`);
    await walk(directory);
  }
  files.push({ relativePath: ".agents/skills/AIHERO-LICENSE", data: await readFile(join(resourcesRoot, "LICENSE")) });
  files.push({ relativePath: ".agents/skills/AIHERO-VERSION.md", data: Buffer.from(versionDocument) });
  return files;
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

/**
 * Copies a pinned subset of Matt Pocock's skills into a project. Existing files are never overwritten;
 * nothing is installed and no global Codex setting changes.
 */
export async function prepareSkills(projectRoot: string, resourcesRoot: string, repository: string | null): Promise<SetupReport> {
  const root = await realpath(projectRoot);
  const writes = [
    ...(await bundledFiles(resourcesRoot)),
    { relativePath: "docs/agents/aihero-setup.md", data: Buffer.from(configurationDocument(repository ?? "Non selezionato")) },
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
 * Moves a project to the bundled version (T04). Managed files the person did not touch are backed up
 * and replaced; files the person changed stay and are reported. Works offline from the local bundle.
 */
export async function updateSkills(projectRoot: string, resourcesRoot: string, repository: string | null, now = new Date()): Promise<SetupReport> {
  const root = await realpath(projectRoot);
  const manifest = await readManifest(root);
  if (manifest.version === SKILL_VERSION) return prepareSkills(root, resourcesRoot, repository);
  const bundle = await bundledFiles(resourcesRoot);
  const backup = join(root, BACKUPS, now.toISOString().replace(/[:.]/g, "-"));
  const report: SetupReport = { pathsCreated: [], existingPreserved: [], warnings: [], version: SKILL_VERSION };
  const replaced: { relativePath: string; data: Buffer }[] = [];
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
  for (const write of replaced) {
    const saved = join(backup, write.relativePath);
    await mkdir(join(saved, ".."), { recursive: true });
    await copyFile(join(root, write.relativePath), saved);
  }
  await mkdir(backup, { recursive: true });
  await writeFile(join(backup, "AIHERO-MANIFEST.json"), JSON.stringify(manifest, null, 2));
  for (const write of replaced) {
    await writeFile(join(root, write.relativePath), write.data);
    manifest.files[write.relativePath] = sha(write.data);
    report.pathsCreated.push(write.relativePath);
  }
  manifest.version = SKILL_VERSION;
  await writeManifest(root, manifest);
  const added = await prepareSkills(root, resourcesRoot, repository);
  report.pathsCreated.push(...added.pathsCreated);
  return report;
}

/** Restores the files and the manifest saved by the last update. */
export async function rollbackSkills(projectRoot: string): Promise<string[]> {
  const root = await realpath(projectRoot);
  const backups = existsSync(join(root, BACKUPS)) ? (await readdir(join(root, BACKUPS))).sort() : [];
  const latest = backups.at(-1);
  if (!latest) throw new Error("Non c'è un aggiornamento del metodo da annullare.");
  const directory = join(root, BACKUPS, latest);
  const restored: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name !== "AIHERO-MANIFEST.json") {
        const relativePath = relative(directory, path).split("\\").join("/");
        const target = join(root, relativePath);
        if (!(await isInside(target, root))) continue;
        await copyFile(path, target);
        restored.push(relativePath);
      }
    }
  };
  await walk(directory);
  await copyFile(join(directory, "AIHERO-MANIFEST.json"), join(root, MANIFEST));
  await rm(directory, { recursive: true, force: true });
  return restored;
}
