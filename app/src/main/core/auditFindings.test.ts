import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AuditFinding, CandidateEvidence, FindingEvidence, FocusAudit } from "@shared/domain";
import { findingTally } from "@shared/findings";
import { beginAxes, beginLenses, closeAudit, failAudit, type FindingDraft, finishAxis, readAxisAnswer } from "./audit";
import {
  checkForCommand,
  confirmationModel,
  confirmationTurn,
  confirmFinding,
  NO_STRONGER_MODEL,
  readConfirmation,
  recheckEvidence,
  recheckFindings,
} from "./auditFindings";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 27, 10, minute));

async function worktree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "trama-findings-"));
  await mkdir(join(root, "Sources/Orders"), { recursive: true });
  await writeFile(join(root, "Sources/Orders/Cancel.swift"), "struct Cancel {\n  func doIt(o: Order) {}\n}\n");
  await writeFile(join(root, ".env"), "TOKEN=secret\n");
  await symlink(join(root, "Sources/Orders/Cancel.swift"), join(root, "Link.swift"));
  return root;
}

const evidence = (check: string, result: "pass" | "fail", output = ""): CandidateEvidence => ({
  check,
  result,
  command: check === "swift_test" ? "swift test --package-path /w" : `git ${check}`,
  output,
  snapshotId: "snap-1",
  decisionVersions: {},
  recordedAt: at(1).toISOString(),
});

const line = (file: string, n: number, quote = ""): FindingEvidence => ({ kind: "fileLine", file, line: n, quote });

function audit(): FocusAudit {
  const value: FocusAudit = {
    id: "F-1",
    target: { kind: "candidate", candidateId: "C-1", assignmentId: "A-1" },
    fixedPoint: "0a1b2c3d",
    snapshotId: "snap-1",
    changedFiles: ["Sources/Orders/Cancel.swift"],
    status: "checking",
    checks: [evidence("swift_build", "pass"), evidence("swift_test", "fail", "Test Suite 'All tests' failed.\nCancelTests.testUnpaid failed")],
    specSource: null,
    standards: null as never,
    spec: null as never,
    summary: null,
    failure: null,
    startedAt: at(0).toISOString(),
    updatedAt: at(0).toISOString(),
    finishedAt: null,
  };
  beginAxes(value, "Issue #8", "gpt-5.5-mini", at(2));
  return value;
}

const finding = (draft: FindingDraft, basis: string | null = null): AuditFinding => ({
  id: "spec-1",
  ...draft,
  status: "pending",
  basis,
  observed: null,
  confirmation: null,
});

describe("Trama rechecks the proofs it can run (F02)", () => {
  it("rereads a line of the worktree and the text the axis quoted", async () => {
    const root = await worktree();
    const held = await recheckEvidence(line("Sources/Orders/Cancel.swift", 2, "func doIt(o:  Order)"), [], root);
    expect(held).toMatchObject({ outcome: "held", observed: "  func doIt(o: Order) {}" });
    expect(await recheckEvidence(line("./Sources/Orders/Cancel.swift", 1), [], root)).toMatchObject({ outcome: "held", basis: expect.stringContaining("la riga esiste") });
    expect(await recheckEvidence(line("Sources/Orders/Cancel.swift", 2, "func cancel"), [], root)).toMatchObject({ outcome: "contradicted" });
    expect(await recheckEvidence(line("Sources/Orders/Cancel.swift", 40), [], root)).toMatchObject({ outcome: "contradicted", basis: expect.stringContaining("4 righe") });
    expect(await recheckEvidence(line("Sources/Orders/Missing.swift", 1), [], root)).toMatchObject({ outcome: "contradicted", basis: expect.stringContaining("non esiste") });
  });

  it("never reads secrets, symbolic links or paths outside the worktree", async () => {
    const root = await worktree();
    for (const file of [".env", "Link.swift", "../outside.swift", "/etc/hosts"]) {
      expect(await recheckEvidence(line(file, 1), [], root)).toMatchObject({ outcome: "notCheckable", observed: null });
    }
  });

  it("holds a command only when it is one of Trama's checks and it really failed on this candidate", async () => {
    const { checks } = audit();
    expect(checkForCommand("swift test", checks)?.check).toBe("swift_test");
    expect(checkForCommand("$ swift test --filter CancelTests", checks)?.check).toBe("swift_test");
    expect(checkForCommand("swift_build", checks)?.check).toBe("swift_build");
    expect(checkForCommand("rm -rf /", checks)).toBeNull();
    expect(await recheckEvidence({ kind: "command", command: "swift test" }, checks, "/nowhere")).toMatchObject({ outcome: "held", observed: expect.stringContaining("testUnpaid failed") });
    expect(await recheckEvidence({ kind: "command", command: "swift build" }, checks, "/nowhere")).toMatchObject({ outcome: "contradicted" });
    // Trama runs no command a model chose: one outside its checks cannot be rechecked.
    expect(await recheckEvidence({ kind: "command", command: "npm test" }, checks, "/nowhere")).toMatchObject({ outcome: "notCheckable" });
    expect(await recheckEvidence({ kind: "reproduction", steps: "Annullare l'ordine 42" }, checks, "/nowhere")).toMatchObject({ outcome: "notCheckable" });
  });
});

describe("each finding ends verified by Trama, confirmed by a second model, or a hypothesis (F02)", () => {
  it("verifies a proof that held, sends a serious finding Trama cannot recheck to the stronger model, and leaves the rest as hypotheses", async () => {
    const root = await worktree();
    const value = audit();
    finishAxis(
      value,
      "standards",
      {
        report: "Due rilievi.",
        worst: "Possibile Mysterious Name",
        findings: [
          { title: "Possibile Mysterious Name: doIt", severity: "minor", evidence: line("Sources/Orders/Cancel.swift", 2, "func doIt") },
          { title: "Il test dell'ordine non pagato fallisce", severity: "serious", evidence: { kind: "command", command: "swift test" } },
          { title: "Nome generico", severity: "minor", evidence: null },
        ],
      },
      at(3),
    );
    finishAxis(
      value,
      "spec",
      {
        report: "Due rilievi.",
        worst: "Manca il criterio",
        findings: [
          { title: "Manca il criterio sull'ordine non pagato", severity: "serious", evidence: { kind: "reproduction", steps: "Annullare un ordine non pagato" } },
          { title: "Build rotta", severity: "serious", evidence: { kind: "command", command: "swift build" } },
          { title: "Messaggio poco chiaro", severity: "minor", evidence: { kind: "reproduction", steps: "Leggere il messaggio" } },
          { title: "Manca un requisito", severity: "serious", evidence: null },
        ],
      },
      at(3),
    );
    // Before the recheck nothing is verified.
    expect([...value.standards.items!, ...value.spec.items!].every((f) => f.status === "pending")).toBe(true);
    expect(value.standards.findings).toBe(3);

    const serious = await recheckFindings(value, root);
    const [name, failingTest, noProof] = value.standards.items!;
    const [missing, build, message, unproven] = value.spec.items!;
    expect(name).toMatchObject({ status: "verified", observed: "  func doIt(o: Order) {}" });
    expect(failingTest).toMatchObject({ status: "verified", observed: expect.stringContaining("testUnpaid failed") });
    expect(noProof).toMatchObject({ status: "hypothesis", basis: expect.stringContaining("non ha dato una prova") });
    expect(build).toMatchObject({ status: "hypothesis", basis: expect.stringContaining("superata") });
    expect(message).toMatchObject({ status: "hypothesis", basis: expect.stringContaining("non è grave") });
    // A serious finding without a proof is never sent for confirmation: it stays a hypothesis.
    expect(unproven).toMatchObject({ status: "hypothesis" });
    expect(serious).toEqual([{ axis: "spec", finding: missing }]);
    expect(missing!.status).toBe("pending");

    confirmFinding(missing!, { model: "gpt-5.5", confirmed: true, reason: "Nessun test copre l'ordine non pagato." }, at(4));
    expect(missing).toMatchObject({ status: "confirmed", confirmation: { model: "gpt-5.5", confirmed: true, at: at(4).toISOString() }, basis: expect.stringContaining("Confermato da gpt-5.5") });
    closeAudit(value, at(5));
    expect(findingTally(value)).toBe("2 verificati da Trama, 1 confermato da un secondo modello, 4 ipotesi");
    // No finding is verified without a proof that Trama rechecked.
    for (const f of [...value.standards.items!, ...value.spec.items!]) if (f.status === "verified") expect(f.evidence).not.toBeNull();
  });

  it("keeps a serious finding a hypothesis when the second model rejects it, fails, or does not exist", () => {
    const serious = (): AuditFinding => finding({ title: "Manca il criterio", severity: "serious", evidence: { kind: "reproduction", steps: "Annullare" } }, "Trama non esegue le riproduzioni.");
    const rejected = serious();
    confirmFinding(rejected, { model: "gpt-5.5", confirmed: false, reason: "Il test c'è in `CancelTests`." });
    expect(rejected).toMatchObject({ status: "hypothesis", confirmation: { confirmed: false }, basis: expect.stringContaining("non lo conferma") });
    const failed = serious();
    confirmFinding(failed, { failure: "La conferma di gpt-5.5 non è riuscita: timeout." });
    expect(failed).toMatchObject({ status: "hypothesis", confirmation: null, basis: expect.stringContaining("timeout") });
    const alone = serious();
    confirmFinding(alone, { failure: NO_STRONGER_MODEL });
    expect(alone.status).toBe("hypothesis");
    expect(confirmationModel("gpt-5.5-mini", "gpt-5.5")).toBe("gpt-5.5");
    expect(confirmationModel("gpt-5.5", "gpt-5.5")).toBeNull();
    expect(confirmationModel("gpt-5.5", null)).toBeNull();
  });

  it("reads the second model's answer only with an outcome and a reason", () => {
    expect(readConfirmation('{"confirmed":true,"reason":" Manca il test. "}')).toEqual({ confirmed: true, reason: "Manca il test." });
    expect(() => readConfirmation('{"confirmed":true,"reason":""}')).toThrow("senza esito");
    expect(() => readConfirmation('{"reason":"ok"}')).toThrow("senza esito");
    expect(() => readConfirmation("no")).toThrow("leggibile");
  });

  it("gives the second model the finding and its proof as data, read-only", () => {
    const value = audit();
    const turn = confirmationTurn(
      { projectName: "ordini", audit: value, candidateId: "C-1" },
      "spec",
      finding({ title: "Manca il criterio", severity: "serious", evidence: { kind: "reproduction", steps: "Annullare l'ordine 42" } }, "Trama non esegue le riproduzioni scritte da un modello."),
    );
    expect(turn.instructions).toContain("read-only");
    expect(turn.prompt).toContain("Rilievo grave dell'asse Spec");
    expect(turn.prompt).toContain("riproduzione:\nAnnullare l'ordine 42");
    expect(turn.outputSchema.required).toEqual(["confirmed", "reason"]);
    expect(turn.instructions).toContain("one or two sentences in Italian");
    const english = confirmationTurn({ projectName: "ordini", audit: value, candidateId: "C-1", language: "en" }, "spec", finding({ title: "x", severity: "serious", evidence: { kind: "command", command: "npm test" } }, "y"));
    expect(english.instructions).toContain("one or two sentences in English");
  });

  it("turns a finding still pending when the examination stops into a hypothesis", () => {
    const value = audit();
    finishAxis(value, "standards", { report: "Un rilievo.", worst: null, findings: [{ title: "Nome", severity: "minor", evidence: line("a.swift", 1) }] }, at(3));
    failAudit(value, "Trama si è chiusa.", at(4));
    expect(value.standards.items![0]).toMatchObject({ status: "hypothesis", basis: expect.stringContaining("interrotta") });
  });

  it("reads each finding's proof from the axis answer, and a proof that names nothing is no proof", () => {
    const empty = { file: "", line: 0, quote: "", command: "", steps: "" };
    const answer = readAxisAnswer(
      JSON.stringify({
        report: "Rapporto.",
        worst: "Nome",
        findings: [
          { title: " Nome ", severity: "serious", evidence: { ...empty, kind: "fileLine", file: "a.swift", line: 3, quote: " x " } },
          { title: "Test", severity: "minor", evidence: { ...empty, kind: "command", command: " swift test " } },
          { title: "Riga zero", severity: "minor", evidence: { ...empty, kind: "fileLine", file: "a.swift" } },
          { title: "Senza prova", severity: "strano", evidence: { ...empty, kind: "none" } },
          { title: " ", severity: "minor", evidence: { ...empty, kind: "none" } },
        ],
      }),
    );
    expect(answer.findings).toEqual([
      { title: "Nome", severity: "serious", evidence: { kind: "fileLine", file: "a.swift", line: 3, quote: "x" } },
      { title: "Test", severity: "minor", evidence: { kind: "command", command: "swift test" } },
      { title: "Riga zero", severity: "minor", evidence: null },
      { title: "Senza prova", severity: "minor", evidence: null },
    ]);
  });
});

describe("Trama's lenses go through the same verification as the axes (F05)", () => {
  it("verifies, sends to the stronger model or leaves as hypotheses the lenses' findings, as it does for the axes", async () => {
    const root = await worktree();
    const value = audit();
    beginLenses(value, "gpt-5.5-mini", at(2));
    finishAxis(value, "standards", { report: "Ok.", worst: null, findings: [] }, at(3));
    finishAxis(value, "spec", { report: "Ok.", worst: null, findings: [] }, at(3));
    finishAxis(value, "security", { report: "R.", worst: null, findings: [{ title: "Parametro senza controllo", severity: "serious", evidence: line("Sources/Orders/Cancel.swift", 2, "func doIt") }] }, at(3));
    finishAxis(value, "tests", { report: "R.", worst: null, findings: [{ title: "Manca il test", severity: "serious", evidence: { kind: "reproduction", steps: "Annullare due volte" } }] }, at(3));
    finishAxis(value, "docs", { report: "R.", worst: null, findings: [{ title: "Il README è vecchio", severity: "serious", evidence: null }, { title: "Riga inventata", severity: "minor", evidence: line("Sources/Orders/Cancel.swift", 99) }] }, at(3));
    const serious = await recheckFindings(value, root);
    expect(serious.map(({ axis, finding }) => [axis, finding.id])).toEqual([["tests", "tests-1"]]);
    expect(value.lenses!.security.items![0]).toMatchObject({ status: "verified", observed: "  func doIt(o: Order) {}" });
    // No proof, or a proof that does not hold, is a hypothesis for a lens too: never verified.
    expect(value.lenses!.docs.items!.map((f) => f.status)).toEqual(["hypothesis", "hypothesis"]);
    confirmFinding(serious[0]!.finding, { model: "gpt-5.5", confirmed: true, reason: "Nel diff non c'è il test." }, at(4));
    closeAudit(value, at(5));
    expect(findingTally(value)).toBe("1 verificato da Trama, 1 confermato da un secondo modello, 2 ipotesi");
  });

  it("tells the second model that the serious finding comes from one of Trama's lenses", () => {
    const value = audit();
    beginLenses(value, "gpt-5.5-mini", at(2));
    const turn = confirmationTurn(
      { projectName: "ordini", audit: value, candidateId: "C-1" },
      "security",
      finding({ title: "Token nei log", severity: "serious", evidence: { kind: "reproduction", steps: "Leggere il log" } }),
    );
    expect(turn.prompt).toContain("Rilievo grave della lente di Trama Sicurezza");
  });
});
