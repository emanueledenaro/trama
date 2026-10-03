import type { Candidate, CandidateGate, GateFinding, GateRole, ProjectDocument } from "@shared/domain";
import { blockingFindings } from "@shared/gate";
import { workLineage } from "@shared/reviewLoop";
import { findAssignment } from "./team";

/**
 * The rounds of the candidate gate after the first (issue #567). From the second round on, the reviewers of a candidate
 * read what changed since the candidate of the same work that was already reviewed, and block only on that and on the
 * findings left open by the round before. A new blocking finding on code nobody changed becomes a suggestion, Security
 * excepted, and one that is about another slice's files becomes a note for that slice. Trama enforces it on the answers
 * (applyRoundScope), so it does not depend on a reviewer following the instruction. This works inside ADR 0023: a
 * demoted finding is advisory, so it counts toward no blocked round and never reaches settle_review or overrule_finding.
 */

export interface DiffScope {
  /** The hunks of the new diff that the reviewed candidate did not have, with their file headers. */
  delta: string;
  /** Files of the new diff with no new hunk: nobody changed them since the reviewed candidate. */
  unchangedFiles: string[];
  /** Files with at least one new hunk. */
  changedFiles: string[];
  /** For a changed file, the line ranges (new side) of its new hunks. */
  ranges: Record<string, [number, number][]>;
}

export interface ReviewRound {
  previous: Candidate;
  /** The blocking findings the previous round left open (not overruled), with their figure. */
  open: { role: GateRole; finding: GateFinding }[];
  scope: DiffScope;
}

interface Hunk {
  header: string;
  body: string;
  start: number;
  length: number;
}

interface FileDiff {
  header: string;
  hunks: Hunk[];
}

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** A diff split by file and hunk, keyed by the file's path after the change. */
export function splitDiff(diff: string): Map<string, FileDiff> {
  const files = new Map<string, FileDiff>();
  let current: FileDiff | null = null;
  let hunk: Hunk | null = null;
  const headerLines: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const path = / b\/(.+)$/.exec(line)?.[1] ?? line.slice("diff --git ".length);
      current = { header: line, hunks: [] };
      files.set(path, current);
      hunk = null;
      headerLines.length = 0;
      continue;
    }
    if (!current) continue;
    const match = HUNK.exec(line);
    if (match) {
      hunk = { header: line, body: "", start: Number(match[1]), length: match[2] === undefined ? 1 : Number(match[2]) };
      current.hunks.push(hunk);
    } else if (hunk) hunk.body += `${line}\n`;
    else current.header += `\n${line}`;
  }
  return files;
}

/** What `current` changes compared with `previous`: a hunk with the same lines in the same file is not new. */
export function diffScope(previous: string, current: string): DiffScope {
  const before = splitDiff(previous);
  const delta: string[] = [];
  const unchangedFiles: string[] = [];
  const changedFiles: string[] = [];
  const ranges: DiffScope["ranges"] = {};
  for (const [path, file] of splitDiff(current)) {
    const known = new Set((before.get(path)?.hunks ?? []).map((h) => h.body));
    const fresh = file.hunks.filter((h) => !known.has(h.body));
    // A file with no hunk (a rename, a mode change, a binary file) is new when the earlier diff lacks its header.
    const headerNew = !file.hunks.length && before.get(path)?.header !== file.header;
    if (!fresh.length && !headerNew) {
      unchangedFiles.push(path);
      continue;
    }
    changedFiles.push(path);
    delta.push([file.header, ...fresh.map((h) => `${h.header}\n${h.body.replace(/\n$/, "")}`)].join("\n"));
    if (fresh.length) ranges[path] = fresh.map((h) => [h.start, h.start + Math.max(h.length - 1, 0)]);
  }
  return { delta: delta.join("\n"), unchangedFiles, changedFiles, ranges };
}

/** The same figure's finding again: the same file near the same line, or without one the same title; Security's are also told apart by title. */
export function sameFinding(a: { role: GateRole; finding: GateFinding }, b: { role: GateRole; finding: GateFinding }): boolean {
  if (a.role !== b.role) return false;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[.;:!\s]+$/, "").trim();
  const fileA = pathOf(a.finding.file);
  const fileB = pathOf(b.finding.file);
  const sameTitle = norm(a.finding.title) === norm(b.finding.title);
  if (a.role === "security") return sameTitle && (!fileA || !fileB || fileA === fileB);
  if (fileA && fileB) {
    if (fileA !== fileB) return false;
    // Reviewers reword a finding and a fix shifts its lines: the same file and a nearby line is the same finding.
    const lineA = lineOf(a.finding.file);
    const lineB = lineOf(b.finding.file);
    return sameTitle || lineA === null || lineB === null || Math.abs(lineA - lineB) <= NEARBY_LINES;
  }
  return sameTitle;
}

const NEARBY_LINES = 10;

/** A finding's path without its line. */
export const pathOf = (file: string | null): string | null => (file ? file.replace(/:\d+(?:[-:]\d+)*$/, "") : null);

const lineOf = (file: string | null): number | null => {
  const match = file ? /:(\d+)(?:[-:]\d+)*$/.exec(file) : null;
  return match ? Number(match[1]) : null;
};

/**
 * The candidate of the same work the reviewers already read: the latest earlier candidate of the work's lineage whose
 * gate ended blocked or passed. A gate that failed to finish reviewed nothing.
 */
export function reviewedBefore(document: ProjectDocument, candidate: Candidate): { candidate: Candidate; gate: CandidateGate } | null {
  const assignment = findAssignment(document, candidate.assignmentId);
  if (!assignment) return null;
  const lineage = new Set(workLineage(document, assignment).map((a) => a.id));
  const index = document.candidates.findIndex((c) => c.id === candidate.id);
  const earlier = index < 0 ? document.candidates : document.candidates.slice(0, index);
  for (const previous of earlier.filter((c) => lineage.has(c.assignmentId)).reverse()) {
    const gate = (document.gates ?? [])
      .filter((g) => g.candidateId === previous.id && (g.status === "blocked" || g.status === "passed") && g.reviews.some((r) => r.status === "done"))
      .at(-1);
    if (gate) return { candidate: previous, gate };
  }
  return null;
}

/** The round the candidate's gate is in: null for the first one, the scope of the second and later ones otherwise. */
export function reviewRound(document: ProjectDocument, candidate: Candidate): ReviewRound | null {
  const before = reviewedBefore(document, candidate);
  if (!before) return null;
  const open = before.gate.reviews.flatMap((r) => blockingFindings(r).map((finding) => ({ role: r.role, finding })));
  return { previous: before.candidate, open, scope: diffScope(before.candidate.diff, candidate.diff) };
}

/** Files that other work (not this work's lineage) changes in its latest open candidate: the other slices' code. */
function otherWorkFiles(document: ProjectDocument, candidate: Candidate): Map<string, string> {
  const assignment = findAssignment(document, candidate.assignmentId);
  const lineage = new Set(assignment ? workLineage(document, assignment).map((a) => a.id) : [candidate.assignmentId]);
  const own = new Set(candidate.changedFiles);
  const files = new Map<string, string>();
  for (const other of document.candidates) {
    if (lineage.has(other.assignmentId)) continue;
    const latest = document.candidates.filter((c) => c.assignmentId === other.assignmentId).at(-1);
    if (latest?.id !== other.id) continue;
    for (const file of other.changedFiles) if (!own.has(file) && !files.has(file)) files.set(file, other.assignmentId);
  }
  return files;
}

export interface SliceNote {
  assignmentId: string;
  role: GateRole;
  finding: GateFinding;
}

/**
 * Before the gate closes: a new blocking finding that is not about this slice's change stops blocking. On code that
 * nobody changed since the reviewed candidate it becomes a suggestion; on a file only another slice changes it becomes a
 * note for that slice. A finding the previous round left open stays blocking, and so do Security's findings, Trama's own
 * evidence and a finding Trama cannot place in the diff. Returns the notes for the other slices.
 */
export function applyRoundScope(document: ProjectDocument, gate: CandidateGate, candidate: Candidate, round: ReviewRound | null): SliceNote[] {
  const others = otherWorkFiles(document, candidate);
  const notes: SliceNote[] = [];
  let changed = false;
  for (const review of gate.reviews) {
    if (review.role === "regressionGuardian" || review.role === "security") continue;
    for (const finding of blockingFindings(review)) {
      if (round?.open.some((open) => sameFinding(open, { role: review.role, finding }))) continue;
      const path = pathOf(finding.file);
      if (!path) continue;
      const owner = others.get(path);
      if (owner) {
        finding.severity = "advisory";
        finding.scope = { kind: "otherSlice", assignmentId: owner };
        notes.push({ assignmentId: owner, role: review.role, finding });
        changed = true;
        continue;
      }
      if (!round || !candidate.changedFiles.includes(path) || !unchangedCode(round.scope, path, lineOf(finding.file))) continue;
      finding.severity = "advisory";
      finding.scope = { kind: "unchanged" };
      changed = true;
    }
  }
  if (changed) gate.updatedAt = new Date().toISOString();
  return notes;
}

/** Whether the line (or, without one, the whole file) is code the reviewed candidate already had. */
function unchangedCode(scope: DiffScope, path: string, line: number | null): boolean {
  if (scope.unchangedFiles.includes(path)) return true;
  const ranges = scope.ranges[path];
  if (!ranges || line === null) return false;
  return !ranges.some(([start, end]) => line >= start && line <= end);
}
