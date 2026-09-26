import type { AdrProposal, DomainProposal, GlossaryTerm, ProjectDocument } from "./domain";

/**
 * Glossary terms and ADRs drawn from the person's decisions (M03), written in the shapes of AI Hero's domain-modeling
 * reference files: CONTEXT-FORMAT.md for the glossary and ADR-FORMAT.md for the ADRs. Main and renderer share them.
 */

/** A glossary entry as CONTEXT-FORMAT.md writes it under `## Language`. */
export function glossaryEntry(term: GlossaryTerm): string {
  return [`**${term.term}**:`, term.definition, ...(term.avoid.length ? [`_Avoid_: ${term.avoid.join(", ")}`] : [])].join("\n");
}

/** The ADR's file name without its number, which the writer takes from docs/adr/ as ADR-FORMAT.md says. */
export function adrSlug(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, 60).replace(/-+$/, "") || "decision";
}

/** An ADR as ADR-FORMAT.md writes it: the title and one paragraph, then only the optional sections that have content. */
export function adrMarkdown(adr: AdrProposal): string {
  return [
    `# ${adr.title}`,
    adr.body,
    ...(adr.consideredOptions.length ? [`## Considered Options\n\n${adr.consideredOptions.map((option) => `- ${option}`).join("\n")}`] : []),
    ...(adr.consequences ? [`## Consequences\n\n${adr.consequences}`] : []),
  ].join("\n\n");
}

/** Where the ADR goes: `NNNN` stands for the next number in the directory. */
export const adrPath = (proposal: DomainProposal, adr: AdrProposal) => `${proposal.adrDirectory}/NNNN-${adrSlug(adr.title)}.md`;

export function findDomainProposal(document: ProjectDocument, id: string): DomainProposal | null {
  return document.domainProposals?.find((p) => p.id === id) ?? null;
}
