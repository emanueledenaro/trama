import { createHash } from "node:crypto";
import type { CandidateReport } from "@shared/domain";

/** One `- [ ]` or `- [x]` line of an issue body. */
export interface ChecklistItem {
  index: number;
  text: string;
  checked: boolean;
}

const CHECKLIST_LINE = /^(\s*[-*]\s+)\[( |x|X)\](\s+)(.*)$/;

export function parseChecklist(body: string): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  for (const line of body.split("\n")) {
    const match = CHECKLIST_LINE.exec(line);
    if (match) items.push({ index: items.length, text: match[4]!.trim(), checked: match[2] !== " " });
  }
  return items;
}

/** Ticks the items at `indexes`; other items and the rest of the body stay as they are. */
export function checkItems(body: string, indexes: number[]): string {
  let index = -1;
  return body
    .split("\n")
    .map((line) => {
      const match = CHECKLIST_LINE.exec(line);
      if (!match) return line;
      index += 1;
      return indexes.includes(index) ? `${match[1]}[x]${match[3]}${match[4]}` : line;
    })
    .join("\n");
}

export type CriterionOutcome = "met" | "partial" | "notMet";

export interface CriterionReport {
  index: number;
  outcome: CriterionOutcome;
  /** Candidate ids, pull request numbers (#12) or commit SHAs that prove the outcome. */
  evidence: string[];
  limits: string | null;
}

export interface EvidenceContext {
  candidates: Map<string, { report: CandidateReport; pullRequestNumber: number | null }>;
  pullRequests: Set<number>;
}

/**
 * A criterion counts as met only with evidence Trama can see: a candidate that is verified or decided,
 * a published pull request, or a commit SHA. The end of an agent's turn or code on disk is not evidence.
 */
export function evidenceProblems(criterion: CriterionReport, context: EvidenceContext): string[] {
  if (criterion.outcome !== "met") return [];
  if (!criterion.evidence.length) return [`Criterion ${criterion.index + 1} is marked met without evidence.`];
  const problems: string[] = [];
  for (const reference of criterion.evidence) {
    const candidate = context.candidates.get(reference);
    if (candidate) {
      if (candidate.report.state === "building") {
        problems.push(`Candidate ${reference} is not verified: ${candidate.report.blockers.map((b) => b.code).join(", ") || "building"}.`);
      }
      continue;
    }
    const pull = /^#(\d+)$/.exec(reference);
    if (pull) {
      if (!context.pullRequests.has(Number(pull[1]))) problems.push(`Pull request ${reference} was not published by Trama for this project.`);
      continue;
    }
    if (!/^[0-9a-f]{7,40}$/i.test(reference)) problems.push(`Evidence ${reference} is not a candidate, a pull request or a commit.`);
  }
  return problems;
}

/** Stable key of a progress report: the same report retried after a timeout posts nothing new. */
export function progressKey(issueNumber: number, criteria: CriterionReport[], summary: string): string {
  const payload = JSON.stringify({ issueNumber, criteria, summary: summary.trim() });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export const progressMarker = (key: string) => `<!-- trama-progress:${key} -->`;

const OUTCOME_LABEL: Record<CriterionOutcome, string> = { met: "soddisfatto", partial: "parziale", notMet: "non soddisfatto" };

export function progressComment(key: string, items: ChecklistItem[], criteria: CriterionReport[], summary: string, openParts: string[]): string {
  const lines = [progressMarker(key), "", "**Avanzamento registrato da Trama**", "", summary.trim(), ""];
  for (const criterion of criteria) {
    const item = items[criterion.index];
    lines.push(`- ${item ? item.text : `Criterio ${criterion.index + 1}`}: ${OUTCOME_LABEL[criterion.outcome]}`);
    if (criterion.evidence.length) lines.push(`  - Prove: ${criterion.evidence.join(", ")}`);
    if (criterion.limits) lines.push(`  - Limiti: ${criterion.limits}`);
  }
  if (openParts.length) {
    lines.push("", "Resta aperto:");
    for (const part of openParts) lines.push(`- ${part}`);
  }
  return lines.join("\n");
}

export interface PullRequestStatus {
  number: number;
  state: "OPEN" | "CLOSED" | "MERGED";
  mergedAt: string | null;
  checks: "success" | "failure" | "pending" | "none";
}

/** What still prevents closing the ticket: every criterion ticked, a merged pull request with green checks. */
export function closeBlockers(items: ChecklistItem[], pulls: PullRequestStatus[]): string[] {
  const blockers: string[] = [];
  const open = items.filter((i) => !i.checked);
  if (!items.length) blockers.push("The issue has no checklist to verify.");
  for (const item of open) blockers.push(`Criterion not met: ${item.text}`);
  const merged = pulls.filter((p) => p.state === "MERGED");
  if (!merged.length) blockers.push("No pull request of this work is merged.");
  for (const pull of merged) {
    if (pull.checks !== "success") blockers.push(`CI of #${pull.number} is ${pull.checks}, not green.`);
  }
  return blockers;
}
