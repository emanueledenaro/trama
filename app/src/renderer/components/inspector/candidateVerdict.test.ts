import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { AppState, Candidate, CandidateReport, FocusAudit } from "@shared/domain";
import { translator } from "@shared/i18n";
import { useUi } from "@/lib/store";
import { Verdict } from "../focus/FocusModeView";
import { ApproveCandidateButton } from "./ApproveCandidateButton";
import { CandidateActions } from "./CandidateActions";
import { approveBlockedReason, candidateVerdict, verdictText } from "./candidateVerdict";

const it_ = translator("it");
const en = translator("en");

const candidate = (extra: Partial<Candidate> = {}) => ({ id: "C-1", requiredChecks: [], evidence: {}, ...extra }) as unknown as Candidate;
const report = (blockers: CandidateReport["blockers"], extra: Partial<CandidateReport> = {}) =>
  ({ state: blockers.length ? "blocked" : "ready", blockers, mergeRoute: "person", ...extra }) as unknown as CandidateReport;

const failed = { code: "CHECK_FAILED", detail: "node_test" };
const stale = { code: "EVIDENCE_STALE", detail: "node_typecheck" };

describe("candidateVerdict", () => {
  it("is ready to approve when nothing is missing", () => {
    const verdict = candidateVerdict(it_, candidate(), report([]));
    expect(verdict).toMatchObject({ outcome: "ready", count: 0, first: null, toApprove: true });
    expect(verdictText(it_, verdict)).toBe("Pronto da approvare");
    expect(verdictText(en, verdict)).toBe("Ready to approve");
  });

  it("is not ready and names the count and the first condition", () => {
    const verdict = candidateVerdict(it_, candidate(), report([failed, stale]));
    expect(verdict).toMatchObject({ outcome: "missing", count: 2 });
    expect(verdictText(it_, verdict)).toBe("Non pronto: mancano 2 condizioni. Da sistemare per prima: Verifica non superata: Test Node");
    expect(verdictText(en, candidateVerdict(en, candidate(), report([failed, stale])))).toMatch(/^Not ready: 2 conditions are missing\. Fix first: /);
  });

  it("uses the singular for one condition", () => {
    const verdict = candidateVerdict(it_, candidate(), report([stale]));
    expect(verdictText(it_, verdict)).toBe("Non pronto: manca 1 condizione. Da sistemare: Verifica da ripetere: Controllo dei tipi");
  });

  it("keeps a candidate the Coordinator merges, an approved one, a merged one and a superseded one out of 'to approve'", () => {
    expect(candidateVerdict(it_, candidate(), report([], { mergeRoute: "coordinator" })).toApprove).toBe(false);
    expect(candidateVerdict(it_, candidate({ humanApproval: { at: "2026-10-07T10:00:00.000Z" } as Candidate["humanApproval"] }), report([])).toApprove).toBe(false);
    expect(candidateVerdict(it_, candidate({ pullRequest: { mergedAt: "2026-10-07T10:00:00.000Z" } as Candidate["pullRequest"] }), report([failed])).outcome).toBe("merged");
    expect(candidateVerdict(it_, candidate(), report([failed], { state: "superseded" })).outcome).toBe("superseded");
  });

  it("explains why approving is off, and has no reason when nothing is missing", () => {
    expect(approveBlockedReason(it_, report([failed]))).toBe("Non si può ancora approvare. Da sistemare per prima: Verifica non superata: Test Node");
    expect(approveBlockedReason(it_, report([]))).toBeNull();
  });
});

// Rendered on the server, the components read the store's initial state: the language is the only part they need here.
const initial = { ...useUi.getInitialState() };
afterEach(() => Object.assign(useUi.getInitialState(), initial));
const inItalian = () => Object.assign(useUi.getInitialState(), { app: { language: "it", project: null } as unknown as AppState });
// The class list has "disabled:" variants: only the attribute counts.
const isDisabled = (tag: string) => /\sdisabled(?:=""|\s|>)/.test(tag);
const approveTag = (html: string) => html.match(/<button[^>]*>(?=Approva questo candidato)/)?.[0] ?? "";

describe("the approval button", () => {
  it("is off while a condition is missing, with the reason on its wrapper", () => {
    inItalian();
    const html = renderToStaticMarkup(createElement(ApproveCandidateButton, { candidateId: "C-1", report: report([failed]) }));
    expect(isDisabled(approveTag(html))).toBe(true);
    expect(html).toContain('data-testid="candidate-approve-blocked"');
  });

  it("is on when nothing is missing", () => {
    inItalian();
    const html = renderToStaticMarkup(createElement(ApproveCandidateButton, { candidateId: "C-1", report: report([]) }));
    expect(approveTag(html)).not.toBe("");
    expect(isDisabled(approveTag(html))).toBe(false);
    expect(html).not.toContain("candidate-approve-blocked");
  });

  it("shows in the candidate's actions as off for a candidate with conditions missing", () => {
    inItalian();
    const html = renderToStaticMarkup(createElement(CandidateActions, { candidate: candidate(), report: report([failed]), repository: null, publishable: true }));
    expect(isDisabled(approveTag(html))).toBe(true);
  });

  it("is not offered for a superseded or an already approved candidate", () => {
    inItalian();
    const superseded = renderToStaticMarkup(createElement(CandidateActions, { candidate: candidate(), report: report([failed], { state: "superseded" }), repository: null, publishable: true }));
    expect(superseded).not.toContain("Approva questo candidato");
    const approved = candidate({ humanApproval: { at: "2026-10-07T10:00:00.000Z" } as Candidate["humanApproval"] });
    expect(renderToStaticMarkup(createElement(CandidateActions, { candidate: approved, report: report([]), repository: null, publishable: true }))).not.toContain("Approva questo candidato");
  });
});

describe("the verdict of focus mode", () => {
  const audit = (checks: [string, "pass" | "fail"][], extra: Partial<FocusAudit> = {}) =>
    ({
      status: "done",
      checks: checks.map(([check, result]) => ({ check, result })),
      standards: { items: [] },
      spec: { items: [] },
      summary: "Standards: 1 rilievo, il più grave: Possibile Feature Envy. Spec: nessun rilievo.",
      failure: null,
      finishedAt: null,
      ...extra,
    }) as unknown as FocusAudit;
  const render = (value: FocusAudit) => renderToStaticMarkup(createElement(Verdict, { audit: value, running: false }));

  it("says first that the build fails, before the status and the findings", () => {
    inItalian();
    const html = render(audit([["node_typecheck", "fail"]]));
    expect(html).toContain("Non pronto: la build fallisce");
    expect(html.indexOf("Non pronto: la build fallisce")).toBeLessThan(html.indexOf('data-testid="focus-audit-status"'));
    expect(html.indexOf("Non pronto: la build fallisce")).toBeLessThan(html.indexOf('data-testid="focus-audit-summary"'));
  });

  it("names the tests, or both", () => {
    inItalian();
    expect(render(audit([["node_test", "fail"]]))).toContain("Non pronto: i test falliscono");
    expect(render(audit([["swift_build", "fail"], ["swift_test", "fail"]]))).toContain("Non pronto: la build e i test falliscono");
  });

  it("claims nothing when the build and the tests pass", () => {
    inItalian();
    expect(render(audit([["node_typecheck", "pass"], ["node_test", "pass"]]))).not.toContain("Non pronto");
  });

  it("lists the summary of the findings, one entry per axis", () => {
    inItalian();
    const html = render(audit([]));
    expect(html).toMatch(/<ul[^>]*data-testid="focus-audit-summary"[^>]*><li>Standards: 1 rilievo[^<]*<\/li><li>Spec: nessun rilievo\.<\/li><\/ul>/);
  });
});
