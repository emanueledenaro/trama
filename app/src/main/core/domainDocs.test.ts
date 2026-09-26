import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MandateAction, ProjectDocument } from "@shared/domain";
import { adrMarkdown, glossaryEntry } from "@shared/domainDocs";
import { dutyTriggerText } from "@shared/duties";
import { COORDINATOR_SKILLS, DOMAIN_MODELING_BINDING, GRILL_WITH_DOCS_BINDING, GRILLING_BINDING } from "./coordinatorTools";
import { emptyDocument } from "./document";
import { DomainProposalError, domainProposalText, proposeDomainDocs, type DomainProposalInput } from "./domainDocs";
import { concludeDuty, nextDuty, startDomainWriting, withinMandate } from "./duties";
import { deliverNativeSkills, loadNativeSkill } from "./nativeSkills";
import { decide, grantMandate } from "./pact";
import { beginTurn, endTurn } from "./team";

const skillsDirectory = join(import.meta.dirname, "../../../resources/AIHero/skills");
const runner = { provider: "codex" as const, model: "gpt-5.6-luna", modelReason: "Il modello più leggero del catalogo." };

function project(): { document: ProjectDocument; decisionId: string } {
  const document = emptyDocument("p");
  const decision = decide(document, { id: null, value: "Un ordine pagato e annullato va in revisione", acceptedExample: "Ordine 42: stato review", rationale: "Niente rimborsi sbagliati" });
  return { document, decisionId: decision.id };
}

const mandate = (document: ProjectDocument, scope: string[], actions: MandateAction[] = ["executeInWorktree"]) =>
  grantMandate(document, { objectives: ["Glossario"], priorities: [], scopeModuleIds: scope, authorizedActions: actions, limits: [] });

const input = (decisionId: string, overrides: Partial<DomainProposalInput> = {}): DomainProposalInput => ({
  requestId: "R-1",
  decisionIds: [decisionId],
  contextPath: undefined,
  terms: [{ term: "Ordine in revisione", definition: "Un ordine pagato e annullato che aspetta una persona.", avoid: ["Ordine sospeso", "Rimborso in attesa"] }],
  adrs: [{ title: "Gli ordini pagati annullati vanno in revisione", body: "Non rimborsiamo subito un ordine pagato e annullato. Lo mandiamo in revisione per evitare rimborsi sbagliati.", consideredOptions: ["Rimborso automatico"] }],
  projectModuleIds: ["root", "Sources/Orders"],
  ...overrides,
});

describe("glossary and ADR proposals from the grilling decisions (M03)", () => {
  it("writes each term and ADR in the shape of the skill's reference files", async () => {
    const { document, decisionId } = project();
    const proposal = proposeDomainDocs(document, input(decisionId));
    expect(proposal).toMatchObject({ decisionIds: [decisionId], contextPath: "CONTEXT.md", adrDirectory: "docs/adr", assignmentId: null, moduleIds: ["root", "docs"], scopeModuleIds: ["root"] });
    expect(document.domainProposals).toEqual([proposal]);

    // CONTEXT-FORMAT.md: "**Order**:" then the definition, then "_Avoid_: Purchase, transaction".
    const contextFormat = await readFile(join(skillsDirectory, "domain-modeling/CONTEXT-FORMAT.md"), "utf8");
    expect(contextFormat).toContain("**Order**:\n{A one or two sentence description of the term}\n_Avoid_: Purchase, transaction");
    expect(glossaryEntry(proposal.terms[0]!)).toBe("**Ordine in revisione**:\nUn ordine pagato e annullato che aspetta una persona.\n_Avoid_: Ordine sospeso, Rimborso in attesa");
    expect(glossaryEntry({ term: "Cliente", definition: "Chi fa un ordine.", avoid: [] })).toBe("**Cliente**:\nChi fa un ordine.");

    // ADR-FORMAT.md: a title and one paragraph; optional sections only with content.
    const adrFormat = await readFile(join(skillsDirectory, "domain-modeling/ADR-FORMAT.md"), "utf8");
    expect(adrFormat).toContain("# {Short title of the decision}\n\n{1-3 sentences: what's the context, what did we decide, and why.}");
    expect(adrMarkdown(proposal.adrs[0]!)).toBe(
      "# Gli ordini pagati annullati vanno in revisione\n\nNon rimborsiamo subito un ordine pagato e annullato. Lo mandiamo in revisione per evitare rimborsi sbagliati.\n\n## Considered Options\n\n- Rimborso automatico",
    );
    expect(adrMarkdown({ title: "Monorepo", body: "Un solo repository.", consideredOptions: [], consequences: null })).toBe("# Monorepo\n\nUn solo repository.");

    const text = domainProposalText(proposal);
    expect(text).toContain("`CONTEXT.md`, sotto `## Language`");
    expect(text).toContain("ADR `docs/adr/NNNN-gli-ordini-pagati-annullati-vanno-in-revisione.md`");
  });

  it("refuses a proposal outside the skill's formats or without the person's decisions", () => {
    const { document, decisionId } = project();
    const refuse = (overrides: Partial<DomainProposalInput>, message: RegExp) => expect(() => proposeDomainDocs(document, input(decisionId, overrides))).toThrow(message);
    refuse({ decisionIds: [] }, /decisionIDs/);
    refuse({ decisionIds: ["D-NOTREAL"] }, /Unknown Pact decisions: D-NOTREAL/);
    refuse({ terms: [], adrs: [] }, /at least one term/);
    refuse({ terms: [{ term: "Ordine", definition: "Uno. Due. Tre." }] }, /more than two sentences/);
    refuse({ terms: [{ term: "**Ordine**", definition: "Uno." }] }, /without Markdown/);
    refuse({ terms: [{ term: "Ordine", definition: "Uno." }, { term: "ordine", definition: "Due." }] }, /appears twice/);
    refuse({ adrs: [{ title: "T", body: "Uno. Due. Tre. Quattro." }] }, /more than three sentences/);
    refuse({ adrs: [{ title: "T\nX", body: "Uno." }] }, /one line/);
    refuse({ contextPath: "../CONTEXT.md" }, /contextPath/);
    refuse({ contextPath: "docs/GLOSSARY.md" }, /contextPath/);
    expect(() => proposeDomainDocs(document, input(decisionId, { decisionIds: [] }))).toThrow(DomainProposalError);
    expect(document.domainProposals ?? []).toEqual([]);

    const nested = proposeDomainDocs(document, input(decisionId, { contextPath: "src/ordering/CONTEXT.md", terms: [] }));
    expect(nested).toMatchObject({ adrDirectory: "src/ordering/docs/adr", moduleIds: ["src/ordering"], scopeModuleIds: [] });
  });

  it("writes the files only within the mandate, in a worktree of the documentation and domain role", () => {
    const { document, decisionId } = project();
    const proposal = proposeDomainDocs(document, input(decisionId));
    expect(startDomainWriting(document, proposal, runner)).toBeNull();
    expect(proposal.waiting).toMatch(/aspetta il mandato/);
    mandate(document, ["Sources/Orders"]);
    expect(startDomainWriting(document, proposal, runner)).toBeNull();
    expect(proposal.waiting).toMatch(/su root/);
    mandate(document, ["root"], ["plan"]);
    expect(startDomainWriting(document, proposal, runner)).toBeNull();
    expect(proposal.waiting).toMatch(/worktree/);
    expect(document.team.specialists.flatMap((s) => s.assignments)).toEqual([]);

    mandate(document, ["root"]);
    expect(startDomainWriting(document, proposal, null)).toBeNull();
    const writing = startDomainWriting(document, proposal, runner)!;
    expect(document.team.specialists.find((s) => s.id === writing.specialistId)!.role).toBe("documentation");
    expect(writing).toMatchObject({
      tools: ["commands", "edits"],
      moduleIds: ["root", "docs"],
      workspace: null,
      status: "preparing",
      decisionVersions: { [decisionId]: 1 },
      duty: { skill: "domain-modeling", trigger: { kind: "domainProposal", proposalId: proposal.id }, outcome: null },
    });
    expect(writing.instructions).toContain("**Ordine in revisione**:");
    expect(proposal).toMatchObject({ assignmentId: writing.id, waiting: null });
    expect(dutyTriggerText(document, writing.duty!)).toBe(`Proposta di glossario e ADR ${proposal.id} dalle decisioni ${decisionId}`);
    // Once written it is never written again, and a revoked mandate stops it.
    expect(startDomainWriting(document, proposal, runner)).toBeNull();
    expect(withinMandate(document, writing)).toBe(true);
    document.mandate!.status = "revoked";
    expect(withinMandate(document, writing)).toBe(false);
  });

  it("starts a waiting proposal by itself once the mandate covers it, and keeps the report in prose", () => {
    const { document, decisionId } = project();
    const proposal = proposeDomainDocs(document, input(decisionId, { adrs: [] }));
    const duties = { issues: null, headSHA: null, coordinatorBusy: true, moduleIds: ["root"], runner };
    expect(nextDuty(document, duties)).toBeNull();
    mandate(document, ["root"]);
    const writing = nextDuty(document, duties)!;
    expect(writing.duty?.skill).toBe("domain-modeling");
    expect(nextDuty(document, duties)).toBeNull();
    beginTurn(document, writing.id, "t1", "m");
    endTurn(document, writing.id, "t1", { kind: "completed", text: "Ho scritto CONTEXT.md." });
    concludeDuty(document, writing.id, "Ho scritto CONTEXT.md.");
    expect(writing).toMatchObject({ status: "completed", result: "Ho scritto CONTEXT.md.", duty: { outcome: null } });
    expect(writing.duty?.unreadable).toBeUndefined();
  });
});

describe("the Coordinator's grill-with-docs, grilling and domain-modeling skills (M03)", () => {
  it("delivers the Coordinator's skills byte for byte, each followed by its binding", async () => {
    expect(COORDINATOR_SKILLS.map((s) => s.name)).toEqual(["grill-with-docs", "grilling", "domain-modeling", "ask-trama"]);
    const parts = await Promise.all(COORDINATOR_SKILLS.map(async ({ name, binding }) => ({ skill: await loadNativeSkill(skillsDirectory, name), binding })));
    const { text, skills } = deliverNativeSkills(parts, false);
    expect(skills).toEqual([]);
    const delivered = Buffer.from(text, "utf8");
    for (const file of [
      "grill-with-docs/SKILL.md",
      "grilling/SKILL.md",
      "domain-modeling/SKILL.md",
      "domain-modeling/CONTEXT-FORMAT.md",
      "domain-modeling/ADR-FORMAT.md",
      "ask-trama/SKILL.md",
      "ask-trama/PHASE-BOUNDARIES.md",
    ]) {
      expect(delivered.includes(await readFile(join(skillsDirectory, file))), file).toBe(true);
    }
    for (const { name, binding } of COORDINATOR_SKILLS) expect(text).toContain(`## Trama binding for the ${name} skill\n${binding}`);

    const codex = deliverNativeSkills(parts, true);
    expect(codex.skills.map((s) => s.name)).toEqual(["grill-with-docs", "grilling", "domain-modeling", "ask-trama"]);
    expect(codex.skills.map((s) => s.path)).toEqual(COORDINATOR_SKILLS.map(({ name }) => join(skillsDirectory, name, "SKILL.md")));
    expect(codex.text).toContain(await readFile(join(skillsDirectory, "domain-modeling/CONTEXT-FORMAT.md"), "utf8"));
    expect(codex.text).not.toContain(await readFile(join(skillsDirectory, "domain-modeling/SKILL.md"), "utf8"));
  });

  it("binds domain-modeling and grill-with-docs to Trama tools without restating their method", async () => {
    expect(COORDINATOR_SKILLS.find((s) => s.name === "grilling")!.binding).toBe(GRILLING_BINDING);
    for (const [name, binding] of [
      ["domain-modeling", DOMAIN_MODELING_BINDING],
      ["grill-with-docs", GRILL_WITH_DOCS_BINDING],
    ] as const) {
      const original = await readFile(join(skillsDirectory, name, "SKILL.md"), "utf8");
      for (const sentence of original.split(/(?<=[.:!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 40)) {
        expect(binding, `${name}: ${sentence}`).not.toContain(sentence);
      }
      expect(binding).toMatch(/grants no permission/);
      expect(binding).not.toMatch(/[–—]/);
    }
    for (const tool of ["propose_domain_docs", "request_decision", "grillingRound", "declare_candidate"]) expect(DOMAIN_MODELING_BINDING).toContain(tool);
    expect(DOMAIN_MODELING_BINDING).toMatch(/writes no file/);
    // The three ADR criteria and the glossary rules live only in the skill's own text.
    expect(DOMAIN_MODELING_BINDING).not.toMatch(/hard to reverse|surprising|trade-off|devoid/i);
  });
});
