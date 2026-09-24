import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Practice, PracticeEvidence, ProjectDocument } from "@shared/domain";
import { shortId } from "@shared/ids";
import { writeAtomically } from "./storage";

export class PracticeError extends Error {
  constructor(
    readonly code: "invalid_arguments" | "evidence_insufficient" | "private_content" | "unknown_practice" | "not_adopted",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Evidence of a problem in this project that a practice answers (C15): a failed check, a review that
 * asked for changes, a failed assignment or a reproduced conflict. The absence of problems is not evidence.
 */
export function problemEvidence(document: ProjectDocument, reference: string): PracticeEvidence | null {
  for (const candidate of document.candidates) {
    if (candidate.technicalReview?.verdict === "changesRequested" && reference === candidate.technicalReview.id) {
      return { kind: "review", reference, summary: "Revisione tecnica con modifiche richieste" };
    }
    for (const evidence of Object.values(candidate.evidence)) {
      if (evidence.result === "fail" && reference === `${candidate.id}:${evidence.check}`) {
        return { kind: "regression", reference, summary: `Verifica ${evidence.check} non superata` };
      }
    }
  }
  for (const specialist of document.team.specialists) {
    for (const assignment of specialist.assignments) {
      if (assignment.id === reference && assignment.status === "failed") {
        return { kind: "failure", reference, summary: "Incarico non riuscito" };
      }
      if (assignment.id === reference && assignment.waitingForProvider) {
        return { kind: "wait", reference, summary: "Incarico in attesa di un provider bloccato" };
      }
    }
  }
  const conflict = document.conflicts?.find((c) => c.id === reference && c.classification === "conflict");
  if (conflict) return { kind: "conflict", reference, summary: "Conflitto riprodotto con il lavoro di un collega" };
  return null;
}

/**
 * A practice travels between projects, so it holds only a general method: no file paths, module ids,
 * decision ids or issue numbers of the project it came from.
 */
export function privateContent(text: string, document: ProjectDocument, knownPaths: string[]): string[] {
  const found: string[] = [];
  for (const path of knownPaths) if (path.length > 3 && text.includes(path)) found.push(path);
  for (const decision of document.decisions) if (text.includes(decision.id)) found.push(decision.id);
  for (const match of text.matchAll(/(^|\s)#\d+\b/g)) found.push(match[0].trim());
  return [...new Set(found)];
}

export interface PracticeFile {
  practices: Practice[];
}

/** Practices live outside project documents, in Trama's own folder, so other projects can adopt them. */
export class PracticeStore {
  constructor(private readonly root: string) {}

  private get path(): string {
    return join(this.root, "Practices", "practices.json");
  }

  async load(): Promise<Practice[]> {
    if (!existsSync(this.path)) return [];
    try {
      return (JSON.parse(await readFile(this.path, "utf8")) as PracticeFile).practices ?? [];
    } catch {
      return [];
    }
  }

  async save(practices: Practice[]): Promise<void> {
    await writeAtomically(this.path, JSON.stringify({ practices } satisfies PracticeFile, null, 2));
  }
}

export function proposePractice(
  practices: Practice[],
  input: { projectId: string; title: string; method: string; rationale: string; evidence: PracticeEvidence[] },
  now = new Date(),
): Practice {
  const title = input.title.trim();
  const method = input.method.trim();
  const rationale = input.rationale.trim();
  if (!title || !method || !rationale) throw new PracticeError("invalid_arguments", "title, method and rationale are required.");
  if (!input.evidence.length) throw new PracticeError("evidence_insufficient", "A practice needs evidence of a problem it answers.");
  const practice: Practice = {
    id: shortId("PR", randomUUID()),
    title,
    status: "proposed",
    sourceProjectHash: projectHash(input.projectId),
    versions: [{ version: 1, method, rationale, evidence: input.evidence, createdAt: now.toISOString() }],
    adoptions: [],
    createdAt: now.toISOString(),
  };
  practices.push(practice);
  return practice;
}

/** The source project is kept as a one-way hash: provenance without naming it to other projects. */
export const projectHash = (projectId: string) => createHash("sha256").update(projectId).digest("hex").slice(0, 12);

export const currentVersion = (practice: Practice) => practice.versions.at(-1)!;

export function revisePractice(practices: Practice[], id: string, input: { method: string; rationale: string; evidence: PracticeEvidence[] }, now = new Date()) {
  const practice = find(practices, id);
  if (!input.evidence.length) throw new PracticeError("evidence_insufficient", "A revision needs evidence too.");
  practice.versions.push({
    version: currentVersion(practice).version + 1,
    method: input.method.trim(),
    rationale: input.rationale.trim(),
    evidence: input.evidence,
    createdAt: now.toISOString(),
  });
  return practice;
}

/** Only the person adopts a practice in a project, at its current version. */
export function adoptPractice(practices: Practice[], id: string, projectId: string, now = new Date()): Practice {
  const practice = find(practices, id);
  const active = practice.adoptions.find((a) => a.projectId === projectId && !a.retiredAt);
  if (active) active.version = currentVersion(practice).version;
  else practice.adoptions.push({ projectId, version: currentVersion(practice).version, adoptedAt: now.toISOString(), retiredAt: null, retiredReason: null });
  practice.status = "adopted";
  return practice;
}

/** Retiring keeps the history; the practice stops reaching the Coordinator of that project. */
export function retirePractice(practices: Practice[], id: string, projectId: string, reason: string, now = new Date()): Practice {
  const practice = find(practices, id);
  const active = practice.adoptions.find((a) => a.projectId === projectId && !a.retiredAt);
  if (!active) throw new PracticeError("not_adopted", `Practice ${id} is not adopted in this project.`);
  active.retiredAt = now.toISOString();
  active.retiredReason = reason.trim() || "Ritirata dalla persona";
  if (!practice.adoptions.some((a) => !a.retiredAt)) practice.status = "retired";
  return practice;
}

/** Goes back to the previous version in this project; the later version stays in the history. */
export function rollbackPractice(practices: Practice[], id: string, projectId: string): Practice {
  const practice = find(practices, id);
  const active = practice.adoptions.find((a) => a.projectId === projectId && !a.retiredAt);
  if (!active) throw new PracticeError("not_adopted", `Practice ${id} is not adopted in this project.`);
  if (active.version <= 1) throw new PracticeError("invalid_arguments", "There is no previous version.");
  active.version -= 1;
  return practice;
}

/** The general methods adopted in a project, at the version each adoption uses. */
export function adoptedPractices(practices: Practice[], projectId: string): { id: string; title: string; version: number; method: string }[] {
  return practices.flatMap((p) => {
    const adoption = p.adoptions.find((a) => a.projectId === projectId && !a.retiredAt);
    if (!adoption) return [];
    const version = p.versions.find((v) => v.version === adoption.version) ?? currentVersion(p);
    return [{ id: p.id, title: p.title, version: version.version, method: version.method }];
  });
}

export function practicesText(practices: Practice[], projectId: string): string | null {
  const adopted = adoptedPractices(practices, projectId);
  if (!adopted.length) return null;
  return ["## Pratiche adottate dalla persona per questo progetto", ...adopted.map((p) => `- ${p.title} (v${p.version}): ${p.method}`)].join("\n");
}

function find(practices: Practice[], id: string): Practice {
  const practice = practices.find((p) => p.id === id);
  if (!practice) throw new PracticeError("unknown_practice", `Unknown practice: ${id}.`);
  return practice;
}
