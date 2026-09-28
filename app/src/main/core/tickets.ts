import { createHash } from "node:crypto";
import type { CandidateReport } from "@shared/domain";
import type { Translate } from "@shared/i18n";

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
  /** The cited commit SHAs that exist in the project's repository, as written in the evidence. */
  commits: Set<string>;
}

/**
 * A criterion counts as met only with evidence Trama can see: a candidate that is verified or decided,
 * a published pull request, or a commit that exists in the repository. The end of an agent's turn, code on disk
 * or a SHA that names nothing is not evidence.
 */
const COMMIT = /^[0-9a-f]{7,40}$/i;

export const isCommitReference = (reference: string) => COMMIT.test(reference);

/** The references of the evidence written as commit SHAs, for the caller to look up in the repository. */
export function citedCommits(criteria: CriterionReport[]): string[] {
  return [...new Set(criteria.flatMap((c) => c.evidence.filter((reference) => COMMIT.test(reference))))];
}

export function evidenceProblems(criterion: CriterionReport, context: EvidenceContext): string[] {
  if (criterion.outcome !== "met") return [];
  if (!criterion.evidence.length) return [`Criterion ${criterion.index + 1} is marked met without evidence.`];
  const problems: string[] = [];
  for (const reference of criterion.evidence) {
    const candidate = context.candidates.get(reference);
    if (candidate) {
      if (candidate.report.state === "superseded") problems.push(`Candidate ${reference} was replaced by newer work.`);
      else if (candidate.report.state === "building") {
        problems.push(`Candidate ${reference} is not verified: ${candidate.report.blockers.map((b) => b.code).join(", ") || "building"}.`);
      }
      continue;
    }
    const pull = /^#(\d+)$/.exec(reference);
    if (pull) {
      if (!context.pullRequests.has(Number(pull[1]))) problems.push(`Pull request ${reference} was not published by Trama for this project.`);
      continue;
    }
    if (!COMMIT.test(reference)) problems.push(`Evidence ${reference} is not a candidate, a pull request or a commit.`);
    else if (!context.commits.has(reference)) problems.push(`Commit ${reference} is not in the project's repository.`);
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

/**
 * The comment of a report on GitHub. `describe` names each piece of evidence for whoever reads the issue: a candidate
 * by its author and slice instead of its id; pull requests and commits stay as GitHub links them.
 */
export function progressComment(
  key: string,
  items: ChecklistItem[],
  criteria: CriterionReport[],
  summary: string,
  openParts: string[],
  describe: (reference: string) => string = (reference) => reference,
): string {
  const lines = [progressMarker(key), "", "**Avanzamento registrato da Trama**", "", summary.trim(), ""];
  for (const criterion of criteria) {
    const item = items[criterion.index];
    lines.push(`- ${item ? item.text : `Criterio ${criterion.index + 1}`}: ${OUTCOME_LABEL[criterion.outcome]}`);
    if (criterion.evidence.length) lines.push(`  - Prove: ${criterion.evidence.map(describe).join(", ")}`);
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

export type CloseBlocker =
  | { kind: "noChecklist" }
  | { kind: "criterionOpen"; text: string }
  | { kind: "notMerged" }
  | { kind: "checksNotGreen"; number: number; checks: PullRequestStatus["checks"] };

/** What still prevents closing the ticket: every criterion ticked, a merged pull request with green checks. */
export function closeBlockers(items: ChecklistItem[], pulls: PullRequestStatus[]): CloseBlocker[] {
  const blockers: CloseBlocker[] = [];
  if (!items.length) blockers.push({ kind: "noChecklist" });
  for (const item of items.filter((i) => !i.checked)) blockers.push({ kind: "criterionOpen", text: item.text });
  const merged = pulls.filter((p) => p.state === "MERGED");
  if (!merged.length) blockers.push({ kind: "notMerged" });
  for (const pull of merged) {
    if (pull.checks !== "success") blockers.push({ kind: "checksNotGreen", number: pull.number, checks: pull.checks });
  }
  return blockers;
}

/** A blocker for the Coordinator, in the tool's language. */
export function blockerMessage(blocker: CloseBlocker): string {
  switch (blocker.kind) {
    case "noChecklist":
      return "The issue has no checklist to verify.";
    case "criterionOpen":
      return `Criterion not met: ${blocker.text}`;
    case "notMerged":
      return "No pull request of this work is merged.";
    case "checksNotGreen":
      return `CI of #${blocker.number} is ${blocker.checks}, not green.`;
  }
}

/** A blocker for the person, in the person's language. */
export function blockerText(blocker: CloseBlocker, t: Translate): string {
  switch (blocker.kind) {
    case "noChecklist":
      return t("ticket.blocker.noChecklist");
    case "criterionOpen":
      return t("ticket.blocker.criterionOpen", { text: blocker.text });
    case "notMerged":
      return t("ticket.blocker.notMerged");
    case "checksNotGreen":
      return t(`ticket.blocker.checks.${blocker.checks}`, { number: String(blocker.number) });
  }
}
