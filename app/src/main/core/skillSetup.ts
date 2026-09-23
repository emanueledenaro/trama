import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

export const SKILL_VERSION = "v1.2.3 (6acc160e4e0cd062dbbbd7a1b26ae92855edf07e)";
export const SKILL_SOURCE = "https://github.com/mattpocock/skills";
const MAXIMUM_PACKAGED_BYTES = 3 * 1_024 * 1_024;
const SELECTED_SKILLS = [
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
  return report;
}
