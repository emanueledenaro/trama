import { describe, expect, it } from "vitest";
import type { MandateRequest, ProjectMandate, Specialist, SpecialistAssignment } from "./domain";
import { mandateProposalDiff, unchangedMandate, workStoppedBy } from "./mandate";

const mandate = (over: Partial<ProjectMandate> = {}): ProjectMandate => ({
  version: 1,
  objectives: ["Documentare gli ordini"],
  priorities: [],
  scopeModuleIds: ["Root", "Orders", "Billing"],
  authorizedActions: ["plan", "executeInWorktree"],
  limits: ["Non modificare le API pubbliche."],
  grantedAt: "2026-09-27T10:00:00.000Z",
  status: "granted",
  revocation: null,
  history: [],
  ...over,
});

const request = (over: Partial<MandateRequest> = {}): MandateRequest => ({
  id: "M-6C648E49",
  requestId: null,
  reason: "Limitare il lavoro alla radice",
  objectives: ["Documentare gli ordini"],
  priorities: [],
  scopeModuleIds: ["Root"],
  authorizedActions: ["plan", "executeInWorktree"],
  limits: ["Non toccare C-2AB1376F.", "Non modificare le API pubbliche."],
  askedAt: "2026-09-27T11:00:00.000Z",
  resolution: null,
  ...over,
});

const work = (id: string, moduleIds: string[], status: SpecialistAssignment["status"] = "running") =>
  ({ id, moduleIds, status, tools: ["commands", "edits"], objective: `Lavoro ${id}` }) as unknown as SpecialistAssignment;

const specialist = (name: string, ...assignments: SpecialistAssignment[]) => ({ id: name, name, assignments }) as unknown as Specialist;

const document = (specialists: Specialist[], active: ProjectMandate | null = mandate()) => ({
  mandate: active,
  domainProposals: [],
  team: { specialists } as never,
});

describe("mandate proposal diff (U03)", () => {
  it("lists what the proposal adds and removes and the running work it would stop", () => {
    const doc = document([
      specialist("Ada", work("A-1", ["Orders"])),
      specialist("Bea", work("A-2", ["Root"])),
      specialist("Cy", work("A-3", ["Billing"], "stopRequested")),
      specialist("Dan", work("A-4", ["Billing"], "completed")),
    ]);
    const diff = mandateProposalDiff(doc, request())!;
    expect(diff.version).toBe(1);
    expect(diff.modules).toEqual({ added: [], removed: ["Orders", "Billing"] });
    expect(diff.actions).toEqual({ added: [], removed: [] });
    expect(diff.limits).toEqual({ added: ["Non toccare C-2AB1376F."], removed: [] });
    // Only active work the new perimeter no longer covers stops; work already stopping or done does not count.
    expect(diff.stoppedWork.map((w) => w.assignment.id)).toEqual(["A-1"]);
    expect(unchangedMandate(diff)).toBe(false);
  });

  it("stops work that writes when the proposal drops worktree execution", () => {
    const doc = document([specialist("Ada", work("A-1", ["Root"]))]);
    const diff = mandateProposalDiff(doc, request({ authorizedActions: ["plan"] }))!;
    expect(diff.actions).toEqual({ added: [], removed: ["executeInWorktree"] });
    expect(diff.stoppedWork.map((w) => w.assignment.id)).toEqual(["A-1"]);
  });

  it("has no diff without a mandate in force, and says when nothing changes", () => {
    expect(mandateProposalDiff(document([], null), request())).toBeNull();
    expect(mandateProposalDiff(document([], mandate({ status: "revoked" })), request())).toBeNull();
    const same = mandateProposalDiff(document([]), request({ scopeModuleIds: ["Root", "Orders", "Billing"], limits: ["Non modificare le API pubbliche."] }))!;
    expect(unchangedMandate(same)).toBe(true);
  });

  it("stops every running piece of work when no mandate is left", () => {
    const doc = document([specialist("Ada", work("A-1", ["Root"])), specialist("Bea", work("A-2", ["Orders"], "failed"))]);
    expect(workStoppedBy(doc, null).map((w) => w.assignment.id)).toEqual(["A-1"]);
  });
});
