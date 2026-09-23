import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { GitHubState, ProjectDocument, ProjectStudy, StudyPart, StudySection } from "@shared/domain";
import type { RepositorySnapshot } from "@shared/repository";
import { ACTION_LABELS } from "./pact";
import { readRepositoryFile } from "./repositoryScanner";

const TOP_LEVEL_INSTRUCTIONS = ["AGENTS.md", "CLAUDE.md", "README.md", "CONTEXT.md", "CONTRIBUTING.md"];
const MAXIMUM_INSTRUCTION_FILES = 40;
const MAXIMUM_INSTRUCTION_BYTES = 64_000;

const HEADINGS: Record<StudyPart, string> = {
  code: "## Codice",
  instructions: "## File di istruzione",
  github: "## GitHub",
  monitor: "## Monitor dei colleghi",
  pact: "## Patto",
  mandate: "## Mandato",
  history: "## Cronologia",
};

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:ghp_|gho_|ghs_|github_pat_)[A-Za-z0-9_]{16,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY))\s*=\s*\S+/g,
];

/** Removes credentials that may appear in instruction files before they reach the model. */
export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce(
    (current, pattern) =>
      current.replace(pattern, (match, name?: string) =>
        typeof name === "string" && match.includes("=") ? `${name}=[segreto rimosso]` : "[segreto rimosso]",
      ),
    text,
  );
}

function clip(text: string, bytes: number): string {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= bytes) return text;
  return `${buffer.subarray(0, bytes).toString("utf8")}\n[…]`;
}

const fingerprint = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

function codeSection(snapshot: RepositorySnapshot): string {
  const lines = [
    `Repository: ${snapshot.name}. Branch: ${snapshot.branch ?? "non rilevato"}. HEAD: ${snapshot.headSHA ?? "non disponibile"}.`,
    `${snapshot.totalFileCount} file sorgente in ${snapshot.modules.length} moduli. Il raggruppamento segue le cartelle e non prova una responsabilità architetturale.`,
  ];
  for (const module of snapshot.modules) {
    const lineTotal = module.files.reduce((sum, file) => sum + file.lineCount, 0);
    const dependencies = module.dependencies.length ? ` Dipendenze: ${module.dependencies.slice(0, 12).join(", ")}.` : "";
    lines.push(`- ${module.name} (${module.relativePath}, id ${module.id}): ${module.files.length} file, ${lineTotal} righe.${dependencies}`);
  }
  if (snapshot.warnings.length) lines.push(`Avvisi della scansione: ${snapshot.warnings.slice(0, 5).join(" ")}`);
  return lines.join("\n");
}

async function instructionFiles(root: string): Promise<string[]> {
  const files = TOP_LEVEL_INSTRUCTIONS.filter((name) => existsSync(join(root, name)));
  for (const directory of ["docs/adr", "docs"]) {
    try {
      const entries = await readdir(join(root, directory), { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isFile() && entry.name.endsWith(".md")) files.push(`${directory}/${entry.name}`);
      }
    } catch {
      // The directory is optional.
    }
  }
  return files.slice(0, MAXIMUM_INSTRUCTION_FILES);
}

async function instructionsSection(root: string): Promise<string> {
  const parts: string[] = [];
  let total = 0;
  for (const path of await instructionFiles(root)) {
    const limit = TOP_LEVEL_INSTRUCTIONS.includes(path) ? 8_000 : 3_000;
    let text: string;
    try {
      text = redactSecrets(clip(await readRepositoryFile(path, root), limit));
    } catch {
      continue;
    }
    const block = `### ${path}\n${text}`;
    if (total + Buffer.byteLength(block) > MAXIMUM_INSTRUCTION_BYTES) break;
    total += Buffer.byteLength(block);
    parts.push(block);
  }
  return parts.length ? parts.join("\n\n") : "Nessun file di istruzione trovato.";
}

function githubSection(github: GitHubState): string {
  if (!github.repository) return "Nessun repository GitHub collegato a origin.";
  if (github.status !== "ready") return `Repository ${github.repository}. Issue non lette: ${github.message ?? "lettura in corso"}.`;
  const open = github.issues.filter((i) => i.state === "open");
  const lines = [`Repository ${github.repository}. Issue aperte: ${open.length}.`];
  for (const issue of open.slice(0, 30)) lines.push(`- #${issue.number} ${issue.title}`);
  return lines.join("\n");
}

function monitorSection(github: GitHubState, document: ProjectDocument): string {
  if (!github.snapshot) return "Nessuna lettura di branch e pull request dei colleghi.";
  const conflicts = (document.conflicts ?? []).filter((a) => a.classification === "conflict" || a.classification === "overlap");
  const lines = [
    `Branch: ${github.snapshot.branches.length}. Pull request aperte: ${github.snapshot.pullRequests.length}. Lettura del ${github.snapshot.fetchedAt}.`,
    ...github.snapshot.pullRequests.slice(0, 20).map((p) => `- #${p.number} ${p.title} (${p.author ?? "?"}, ${p.headRef} → ${p.baseRef})`),
  ];
  const recent = github.events.slice(-20);
  if (recent.length) lines.push("Novità recenti:", ...recent.map((e) => `- ${e.observedAt}: ${e.title}${e.author ? ` (${e.author})` : ""}`));
  if (conflicts.length) {
    lines.push(
      "Prove di fusione dei candidati con il lavoro remoto:",
      ...conflicts.slice(-10).map((a) => `- ${a.candidateId} con ${a.references.join(", ")}: ${a.classification === "conflict" ? "conflitto" : "stessi file"} (${a.conflictingFiles.join(", ")})`),
    );
  }
  return lines.join("\n");
}

function pactSection(document: ProjectDocument): string {
  if (!document.decisions.length) return "Nessuna decisione registrata nel Patto.";
  return document.decisions
    .map((d) => `- ${d.id} v${d.version}: ${d.value}\n  Esempio accettato: ${d.acceptedExample}\n  Motivazione: ${d.rationale}`)
    .join("\n");
}

function mandateSection(document: ProjectDocument): string {
  const mandate = document.mandate;
  if (!mandate) return "Nessun mandato concesso: il Coordinatore legge e propone, non agisce.";
  if (mandate.status === "revoked") return `Mandato v${mandate.version} revocato. Motivo: ${mandate.revocation?.reason ?? "non indicato"}.`;
  return [
    `Mandato v${mandate.version} concesso il ${mandate.grantedAt}.`,
    `Obiettivi: ${mandate.objectives.join("; ")}`,
    `Priorità: ${mandate.priorities.join("; ") || "nessuna"}`,
    `Perimetro (moduli): ${mandate.scopeModuleIds.join(", ")}`,
    `Azioni autorizzate: ${mandate.authorizedActions.map((a) => ACTION_LABELS[a]).join("; ")}`,
    `Limiti: ${mandate.limits.join("; ") || "nessuno"}`,
  ].join("\n");
}

function historySection(document: ProjectDocument): string {
  const lines: string[] = [];
  for (const event of document.events.slice(-40)) {
    const c = event.content;
    if (c.type === "personMessage") lines.push(`Persona: ${clip(c.text, 600)}`);
    else if (c.type === "coordinatorText") lines.push(`Coordinatore: ${clip(c.text, 600)}`);
    else if (c.type === "card") lines.push(`Scheda ${c.kind}: ${c.title}`);
  }
  return lines.length ? lines.join("\n") : "Nessuna conversazione precedente.";
}

export async function buildStudy(
  snapshot: RepositorySnapshot,
  document: ProjectDocument,
  github: GitHubState,
): Promise<ProjectStudy> {
  const texts: Record<StudyPart, string> = {
    code: codeSection(snapshot),
    instructions: await instructionsSection(snapshot.rootPath),
    github: githubSection(github),
    monitor: monitorSection(github, document),
    pact: pactSection(document),
    mandate: mandateSection(document),
    history: historySection(document),
  };
  const sections: StudySection[] = (Object.keys(HEADINGS) as StudyPart[]).map((part) => ({
    part,
    text: texts[part],
    fingerprint: fingerprint(texts[part]),
  }));
  return { sections, updatedAt: new Date().toISOString() };
}

export function studyText(study: ProjectStudy, parts?: StudyPart[]): string {
  return study.sections
    .filter((s) => !parts || parts.includes(s.part))
    .map((s) => `${HEADINGS[s.part]}\n${s.text}`)
    .join("\n\n");
}

/** Parts the thread has not seen yet. History is never re-sent: the thread already holds it. */
export function partsToInject(study: ProjectStudy, injected: Partial<Record<StudyPart, string>>): StudyPart[] {
  return study.sections.filter((s) => s.part !== "history" && injected[s.part] !== s.fingerprint).map((s) => s.part);
}

export function fingerprints(study: ProjectStudy): Partial<Record<StudyPart, string>> {
  return Object.fromEntries(study.sections.map((s) => [s.part, s.fingerprint]));
}
