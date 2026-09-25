import { describe, expect, it } from "vitest";
import type { AssignmentDuty, ProjectDocument, SpecialistAssignment } from "./domain";
import { dutyOutcomeText, dutyTriggerText, issueTriage } from "./duties";

const document = {
  duties: {
    issueBaseline: 3,
    checkoutChecks: {},
    failures: [
      { id: "F-1", check: "node_test", title: "test Node", command: "npm test", target: "checkout", candidateId: null, assignmentId: null, version: "abcdef1234", regression: true, output: "", at: "", diagnosisId: "A-2" },
      { id: "F-2", check: "swift_test", title: "swift test", command: "swift test", target: "candidate", candidateId: "C-1", assignmentId: "A-0", version: "s", regression: false, output: "", at: "", diagnosisId: null },
    ],
  },
  team: { proposals: [], confirmedAt: null, specialists: [] },
} as unknown as ProjectDocument;

const duty = (trigger: AssignmentDuty["trigger"], outcome: AssignmentDuty["outcome"] = null): AssignmentDuty => ({ skill: "triage", trigger, outcome });

describe("automatic work in the person's words (W11)", () => {
  it("says what started the work", () => {
    expect(dutyTriggerText(document, duty({ kind: "newIssue", issueNumber: 4, title: "Salva non va" }))).toBe("Nuova issue #4: Salva non va");
    expect(dutyTriggerText(document, duty({ kind: "failedCheck", failureId: "F-1" }))).toBe("Regressione: test Node sul checkout al commit abcdef1");
    expect(dutyTriggerText(document, duty({ kind: "failedCheck", failureId: "F-2" }))).toBe("Verifica non superata: swift test sul candidato C-1");
    expect(dutyTriggerText(document, duty({ kind: "idleTeam", headSHA: "1234567890", afterWork: [] }))).toBe("Team libero dopo aver cambiato il codice, commit 1234567");
    expect(dutyTriggerText(document, duty({ kind: "diagnosisFix", diagnosisId: "A-2" }))).toBe("Bug riprodotto dalla diagnosi A-2");
  });

  it("sums up the outcome, without dashes", () => {
    const trigger = { kind: "newIssue" as const, issueNumber: 4, title: "t" };
    const texts = [
      dutyOutcomeText(duty(trigger, { kind: "triage", category: "bug", state: "needs-info", reasoning: "", verification: "", alreadyImplemented: null, comment: "" })),
      dutyOutcomeText(
        duty(trigger, {
          kind: "diagnosis",
          loopCommand: "npm test",
          loopOutput: null,
          reproduced: true,
          hypotheses: [],
          cause: null,
          regressionTest: null,
          seamNote: null,
          fix: "f",
          moduleIds: [],
          openQuestions: null,
          fixAssignmentId: "A-9",
          fixWaiting: null,
        }),
      ),
      dutyOutcomeText(duty(trigger, { kind: "architecture", proposals: [], topRecommendation: null, decisionRequestId: null })),
      dutyOutcomeText({ ...duty(trigger), unreadable: true }),
    ];
    expect(texts).toEqual([
      "bug, needs-info (servono informazioni)",
      "Bug riprodotto. Correzione con test di regressione nell'incarico A-9.",
      "Niente da segnalare.",
      "Trama non ha potuto leggere la risposta: la trovi nel risultato.",
    ]);
    expect(dutyOutcomeText(duty(trigger))).toBeNull();
    for (const text of texts) expect(text).not.toMatch(/[\u2013\u2014]/);
  });

  it("finds the latest triage of an issue", () => {
    const triage = (id: string, issueNumber: number) => ({ id, issueNumber, duty: duty({ kind: "newIssue", issueNumber, title: "t" }) }) as unknown as SpecialistAssignment;
    const withTriage = { ...document, team: { proposals: [], confirmedAt: null, specialists: [{ assignments: [triage("A-1", 4), triage("A-2", 5), triage("A-3", 4)] }] } } as unknown as ProjectDocument;
    expect(issueTriage(withTriage, 4)?.id).toBe("A-3");
    expect(issueTriage(withTriage, 6)).toBeNull();
  });
});
