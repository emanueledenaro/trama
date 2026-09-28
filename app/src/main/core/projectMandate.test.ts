import { describe, expect, it } from "vitest";
import type { SpecialistAssignment } from "@shared/domain";
import { activeTerms } from "@shared/mandate";
import { DELEGABLE_ACTIONS } from "@shared/labels";
import { waitingForYou } from "@shared/waitingForYou";
import { emptyDocument, normalizeDocument } from "./document";
import { authorize } from "./team";
import { grantMandate, rejectMandateRequest, resolveMandateRequest, revokeMandate } from "./pact";
import {
  acknowledgeFixedBanRefusal,
  fixedBanActivity,
  needsProjectMandate,
  proposeProjectMandate,
  recordFixedBanRefusal,
  restrictionMessage,
  restrictMandate,
} from "./projectMandate";
import { translator } from "@shared/i18n";

const t = translator("it");

const MODULES = ["Sources/Orders", "Sources/Catalog"];
const at = (minute: number) => new Date(Date.UTC(2026, 8, 28, 10, minute));

function granted(actions = [...DELEGABLE_ACTIONS]) {
  const document = emptyDocument("p");
  grantMandate(document, { objectives: ["Ordini"], priorities: [], scopeModuleIds: MODULES, authorizedActions: actions, limits: [] }, at(0));
  return document;
}

describe("project mandate proposal (issue #244)", () => {
  it("proposes a mandate for the whole cycle to a project opened without one, and it waits in Aspetta te", () => {
    const document = emptyDocument("p");
    expect(needsProjectMandate(document, MODULES)).toBe(true);
    const request = proposeProjectMandate(document, MODULES, at(1));
    expect(request.projectCycle).toBe(true);
    expect(request.scopeModuleIds).toEqual(MODULES);
    expect(request.authorizedActions).toEqual(DELEGABLE_ACTIONS);
    const [item] = waitingForYou(t, document);
    expect(item).toMatchObject({ kind: "mandate", targetId: request.id, label: "Mandato di progetto" });
    // A request already waits: opening the project again asks nothing more.
    expect(needsProjectMandate(document, MODULES)).toBe(false);
  });

  it("does not propose one to a project with a granted mandate", () => {
    expect(needsProjectMandate(granted(), MODULES)).toBe(false);
  });

  it("does not propose one to a project with no module to cover", () => {
    expect(needsProjectMandate(emptyDocument("p"), [])).toBe(false);
  });

  it("does not ask again after the person turned it down, until a later mandate is revoked", () => {
    const document = emptyDocument("p");
    const request = proposeProjectMandate(document, MODULES, at(1));
    rejectMandateRequest(document, request.id, "Per ora lavoro da solo", at(2));
    expect(needsProjectMandate(document, MODULES)).toBe(false);

    grantMandate(document, { objectives: ["Ordini"], priorities: [], scopeModuleIds: MODULES, authorizedActions: ["plan"], limits: [] }, at(3));
    revokeMandate(document, "Cambio di piani", at(4));
    expect(needsProjectMandate(document, MODULES)).toBe(true);
  });

  it("grants the proposal as it is: the mandate covers every module and action", () => {
    const document = emptyDocument("p");
    const request = proposeProjectMandate(document, MODULES, at(1));
    const mandate = grantMandate(document, request, at(2));
    resolveMandateRequest(document, request.id, "granted", mandate.version, at(2));
    expect(authorize(document.mandate, "integrateCandidate", MODULES)).toBe("authorized");
    expect(waitingForYou(t, document)).toEqual([]);
  });
});

describe("restricting the mandate (issue #244)", () => {
  it("takes modules and actions away without revoking, as a new version in the history", () => {
    const document = granted();
    const restricted = restrictMandate(document, { scopeModuleIds: ["Sources/Orders"], authorizedActions: ["plan", "executeInWorktree"] }, at(5));
    expect(restricted.status).toBe("granted");
    expect(restricted.version).toBe(2);
    expect(restricted.scopeModuleIds).toEqual(["Sources/Orders"]);
    expect(restricted.authorizedActions).toEqual(["plan", "executeInWorktree"]);
    expect(restricted.restriction).toEqual({
      removedModuleIds: ["Sources/Catalog"],
      removedActions: ["openPullRequest", "integrateCandidate", "composeTeam"],
    });
    expect(restricted.history.map((h) => h.version)).toEqual([1]);
    expect(restricted.history[0]!.scopeModuleIds).toEqual(MODULES);
    // The next turn reads the narrower terms: the removed module and action are no longer authorized.
    expect(authorize(document.mandate, "executeInWorktree", ["Sources/Catalog"])).toBe("outside_scope");
    expect(authorize(document.mandate, "integrateCandidate", ["Sources/Orders"])).toBe("not_in_mandate");
    expect(activeTerms(document.mandate)?.scopeModuleIds).toEqual(["Sources/Orders"]);
  });

  it("tells the Coordinator what went and that it holds from its next turn", () => {
    const document = granted();
    const restricted = restrictMandate(document, { scopeModuleIds: ["Sources/Orders"], authorizedActions: [...DELEGABLE_ACTIONS] }, at(5));
    const message = restrictionMessage(restricted, (id) => id.split("/").at(-1)!);
    expect(message).toContain("versione 2");
    expect(message).toContain("tolti i moduli Catalog");
    expect(message).toContain("prossimo turno");
    expect(message).not.toMatch(/[–—]/);
  });

  it("names the work the restriction stopped, and the work it depends on (C06)", () => {
    const document = granted();
    const restricted = restrictMandate(document, { scopeModuleIds: ["Sources/Orders"], authorizedActions: [...DELEGABLE_ACTIONS] }, at(5));
    const work = (id: string) => ({ id }) as SpecialistAssignment;
    const message = restrictionMessage(restricted, (id) => id, [
      { assignment: work("A-1"), dependsOn: null },
      { assignment: work("A-2"), dependsOn: work("A-1") },
    ]);
    expect(message).toContain("Ho fermato A-1, A-2 (dipende da A-1)");
    expect(message).toContain("il diff non si perde");
    expect(message).toContain("il resto continua");
    expect(restrictionMessage(restricted)).toContain("Nessun lavoro in corso era fuori dal mandato ristretto.");
  });

  it("refuses to widen, to remove nothing or to remove everything", () => {
    const document = granted(["plan", "executeInWorktree"]);
    expect(() => restrictMandate(document, { scopeModuleIds: MODULES, authorizedActions: ["plan", "executeInWorktree", "integrateCandidate"] })).toThrow(/non ne aggiunge/);
    expect(() => restrictMandate(document, { scopeModuleIds: MODULES, authorizedActions: ["plan", "executeInWorktree"] })).toThrow(/non toglie niente/);
    expect(() => restrictMandate(document, { scopeModuleIds: [], authorizedActions: ["plan"] })).toThrow(/revocalo/);
    expect(document.mandate?.version).toBe(1);
  });

  it("refuses without a mandate in force", () => {
    const document = granted();
    revokeMandate(document, "Stop", at(6));
    expect(() => restrictMandate(document, { scopeModuleIds: ["Sources/Orders"], authorizedActions: ["plan"] })).toThrow(/Non c'è un mandato/);
  });
});

describe("refused actions in Aspetta te (issue #244)", () => {
  it("turns every refusal into an item with its reason until the person has seen it", () => {
    const document = granted();
    const refusal = recordFixedBanRefusal(
      document,
      { ban: "forcePush", action: "git push --force origin feature/x", by: { kind: "specialist", specialistId: "dev-1", assignmentId: "A-1" } },
      at(7),
    );
    const [item] = waitingForYou(t, document);
    expect(item).toMatchObject({ kind: "fixedBan", targetId: refusal.id, label: "Azione vietata", title: "Force push: git push --force origin feature/x", blocks: 1 });
    expect(fixedBanActivity(refusal).detail).toContain("Nessun mandato la concede");

    acknowledgeFixedBanRefusal(document, refusal.id, at(8));
    expect(waitingForYou(t, document)).toEqual([]);
    expect(document.fixedBanRefusals).toHaveLength(1);
  });

  it("keeps a mandate granted before the fixed bans valid, with no migration", () => {
    // A document written before issue #244: no fixedBanRefusals field, a mandate with every action.
    const raw = JSON.parse(JSON.stringify(granted()));
    delete raw.fixedBanRefusals;
    const document = normalizeDocument(raw, "p");
    expect(document.mandate?.status).toBe("granted");
    expect(authorize(document.mandate, "openPullRequest", MODULES)).toBe("authorized");
    expect(waitingForYou(t, document)).toEqual([]);
    recordFixedBanRefusal(document, { ban: "tagOrRelease", action: "git tag v1", by: { kind: "coordinator" } });
    expect(waitingForYou(t, document).map((i) => i.kind)).toEqual(["fixedBan"]);
  });
});
