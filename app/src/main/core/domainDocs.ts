import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import type { AdrProposal, DomainProposal, GlossaryTerm, ProjectDocument } from "@shared/domain";
import { adrMarkdown, adrPath, glossaryEntry } from "@shared/domainDocs";
import { shortId } from "@shared/ids";
import { moduleLocation } from "./repositoryScanner";

/**
 * Proposals of glossary terms and ADRs drawn from the person's decisions (M03). The Coordinator runs domain-modeling
 * read-only, so it proposes; Trama checks the proposal against the shapes of the skill's reference files and the
 * documentation and domain role writes it in a worktree, within the mandate (duties.ts).
 */

export class DomainProposalError extends Error {}

const MAXIMUM_TERMS = 20;
const MAXIMUM_ADRS = 5;

/** Sentences in a line of prose: a trailing piece without a full stop counts as one. */
function sentences(text: string): number {
  const ends = text.match(/[.!?](?=\s|$)/g)?.length ?? 0;
  return ends + (/[.!?]\s*$/.test(text) ? 0 : 1);
}

function line(value: unknown, field: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new DomainProposalError(`${field} is required.`);
  if (/\n/.test(text)) throw new DomainProposalError(`${field} must be one line.`);
  return text;
}

const lines = (value: unknown, field: string): string[] => (Array.isArray(value) ? value : []).map((item, index) => line(item, `${field}[${index}]`));

function term(raw: unknown, index: number): GlossaryTerm {
  const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = line(item.term, `terms[${index}].term`);
  if (/[*_`]/.test(name)) throw new DomainProposalError(`terms[${index}].term is a plain word, without Markdown.`);
  const definition = line(item.definition, `terms[${index}].definition`);
  // CONTEXT-FORMAT.md: "Keep definitions tight. One or two sentences max."
  if (sentences(definition) > 2) throw new DomainProposalError(`terms[${index}].definition has more than two sentences: CONTEXT-FORMAT.md keeps a definition to one or two.`);
  return { term: name, definition, avoid: lines(item.avoid, `terms[${index}].avoid`) };
}

function adr(raw: unknown, index: number): AdrProposal {
  const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const title = line(item.title, `adrs[${index}].title`);
  const body = line(item.body, `adrs[${index}].body`);
  // ADR-FORMAT.md: "1-3 sentences: what's the context, what did we decide, and why."
  if (sentences(body) > 3) throw new DomainProposalError(`adrs[${index}].body has more than three sentences: ADR-FORMAT.md keeps it to one to three.`);
  const consequences = typeof item.consequences === "string" && item.consequences.trim() ? item.consequences.trim() : null;
  return { title, body, consideredOptions: lines(item.consideredOptions, `adrs[${index}].consideredOptions`), consequences };
}

/** The glossary path: a CONTEXT.md relative to the project root, never outside it. */
function contextPath(value: unknown): string {
  const raw = typeof value === "string" && value.trim() ? value.trim() : "CONTEXT.md";
  const normalized = posix.normalize(raw);
  if (raw.startsWith("/") || normalized.startsWith("..") || normalized !== raw || posix.basename(normalized) !== "CONTEXT.md") {
    throw new DomainProposalError("contextPath is the glossary's CONTEXT.md, relative to the project root, for example CONTEXT.md or src/ordering/CONTEXT.md.");
  }
  return normalized;
}

export interface DomainProposalInput {
  requestId: string | null;
  decisionIds: unknown;
  contextPath: unknown;
  terms: unknown;
  adrs: unknown;
  /** Module ids of the project, to tell which of the files' modules the mandate has to cover. */
  projectModuleIds: string[];
}

/** Records a proposal the Coordinator drew from Pact decisions; refuses one outside the skill's formats. */
export function proposeDomainDocs(document: ProjectDocument, input: DomainProposalInput, now = new Date()): DomainProposal {
  const decisionIds = [...new Set(lines(input.decisionIds, "decisionIDs"))];
  if (decisionIds.length === 0) throw new DomainProposalError("decisionIDs names the Pact decisions the terms and ADRs come from.");
  const unknown = decisionIds.filter((id) => !document.decisions.some((d) => d.id === id));
  if (unknown.length) throw new DomainProposalError(`Unknown Pact decisions: ${unknown.join(", ")}. Only the person's decisions feed the glossary and the ADRs.`);
  const terms = (Array.isArray(input.terms) ? input.terms : []).map(term);
  const adrs = (Array.isArray(input.adrs) ? input.adrs : []).map(adr);
  if (terms.length === 0 && adrs.length === 0) throw new DomainProposalError("Give at least one term or one ADR.");
  if (terms.length > MAXIMUM_TERMS) throw new DomainProposalError(`At most ${MAXIMUM_TERMS} terms in one proposal.`);
  if (adrs.length > MAXIMUM_ADRS) throw new DomainProposalError(`At most ${MAXIMUM_ADRS} ADRs in one proposal.`);
  const repeated = terms.map((t) => t.term.toLowerCase()).filter((name, index, all) => all.indexOf(name) !== index);
  if (repeated.length) throw new DomainProposalError(`A term appears twice: ${repeated.join(", ")}.`);
  const glossary = contextPath(input.contextPath);
  const folder = posix.dirname(glossary);
  const adrDirectory = folder === "." ? "docs/adr" : `${folder}/docs/adr`;
  const moduleIds = [
    ...new Set([...(terms.length ? [moduleLocation(glossary).id] : []), ...(adrs.length ? [moduleLocation(`${adrDirectory}/0001-decision.md`).id] : [])]),
  ];
  const proposal: DomainProposal = {
    id: shortId("DM", randomUUID()),
    requestId: input.requestId,
    decisionIds,
    contextPath: glossary,
    adrDirectory,
    terms,
    adrs,
    moduleIds,
    scopeModuleIds: moduleIds.filter((id) => input.projectModuleIds.includes(id)),
    createdAt: now.toISOString(),
    assignmentId: null,
    waiting: null,
  };
  (document.domainProposals ??= []).push(proposal);
  return proposal;
}

/** The proposal in the skill's formats, for the documentation and domain role that writes it. */
export function domainProposalText(proposal: DomainProposal): string {
  return [
    `Proposta ${proposal.id}, dalle decisioni del Patto ${proposal.decisionIds.join(", ")}.`,
    ...(proposal.terms.length
      ? [`Termini per \`${proposal.contextPath}\`, sotto \`## Language\`:\n\n\`\`\`md\n${proposal.terms.map(glossaryEntry).join("\n\n")}\n\`\`\``]
      : []),
    ...proposal.adrs.map((item) => `ADR \`${adrPath(proposal, item)}\`:\n\n\`\`\`md\n${adrMarkdown(item)}\n\`\`\``),
  ].join("\n\n");
}
