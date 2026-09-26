import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { declareCandidate, recordEvidence, recordTechnicalReview } from "./candidates";
import { emptyDocument } from "./document";
import { decide } from "./pact";
import { AppStorage } from "./storage";
import { assign, beginTurn, confirmTeam, endTurn, proposeTeam, recordThread, recordWorkspace, requestStop } from "./team";

describe("AppStorage", () => {
  it("saves documents privately and marks unreadable state as not writable", async () => {
    const storage = new AppStorage(await mkdtemp(join(tmpdir(), "trama-storage-")));
    const document = emptyDocument("p1");
    document.requests.push({ id: "r", text: "t", moduleId: null, state: "running", model: null, effort: null, createdAt: "", completedAt: null, failure: null });
    await storage.saveDocument(document);
    expect((await stat(storage.documentPath("p1"))).mode & 0o777).toBe(0o600);
    const loaded = await storage.loadDocument("p1");
    expect(loaded.document?.requests[0]?.state).toBe("interrupted");

    await writeFile(storage.documentPath("p1"), "{ non è json");
    const broken = await storage.loadDocument("p1");
    expect(broken).toMatchObject({ document: null, writable: false });
    expect(await readFile(storage.documentPath("p1"), "utf8")).toBe("{ non è json");
  });

  it("keeps the team, its assignments and their candidates across a save and a reopening (V04, V05)", async () => {
    const storage = new AppStorage(await mkdtemp(join(tmpdir(), "trama-storage-")));
    const document = emptyDocument("p1");
    const decision = decide(document, { id: null, value: "Un ordine pagato va in revisione", acceptedExample: "Ordine 42", rationale: "r" });
    const proposal = proposeTeam(document, { requestId: null, summary: "s", members: [{ name: "Ada", tag: "Ordini", competence: "Swift", reason: "Il dominio è in Swift", moduleIds: ["Sources/Orders"] }] });
    confirmTeam(document, proposal.id, null, null);
    const order = {
      specialist: "Ada",
      kind: "agreedTicket" as const,
      objective: "Documenta l'annullamento",
      issueNumber: 12,
      exercise: null,
      moduleIds: ["Sources/Orders"],
      dependencies: [],
      model: "gpt-5.5",
      tools: ["edits" as const],
      requiredChecks: ["git_diff_check"],
      instructions: "Scrivi una nota",
    };
    const first = assign(document, order, 1, null);
    recordWorkspace(document, first.id, { worktreeRoot: "/w/1", branch: "trama/ada-1", baseSHA: "base" } as never);
    recordThread(document, first.id, "thread-1");
    beginTurn(document, first.id, "t1", "gpt-5.5");
    requestStop(document, "Ada", "Persona", "Cambio di piano");
    endTurn(document, first.id, "t1", { kind: "interrupted" });
    const review = { snapshotId: "snap", baseSHA: "base", diff: "+nota   ", changedFiles: ["NOTE.md"], excludedSensitiveFiles: [] };
    const candidate = declareCandidate(document, { assignmentId: first.id, decisionIds: [decision.id], unresolvedChoices: [], externalEffects: [] }, review);
    recordEvidence(document, candidate.id, { check: "git_diff_check", passed: false, command: "git diff --check HEAD", output: "NOTE.md:1: trailing whitespace.", snapshotId: "snap" });
    recordTechnicalReview(document, candidate.id, { reviewerThreadId: "thread-r", authorThreadId: "thread-1", verdict: "changesRequested", summary: "Spazi finali" });
    const saved = JSON.parse(JSON.stringify({ team: document.team, candidates: document.candidates }));

    await storage.saveDocument(document);
    const reopened = (await storage.loadDocument("p1")).document!;
    const ada = reopened.team.specialists.find((s) => s.name === "Ada")!;
    expect(ada).toEqual(saved.team.specialists.find((s: { name: string }) => s.name === "Ada"));
    expect(ada).toMatchObject({ competence: "Swift", reason: "Il dominio è in Swift", moduleIds: ["Sources/Orders"], tag: "Ordini", status: "stopped" });
    expect(ada.assignments[0]).toMatchObject({
      objective: "Documenta l'annullamento",
      issueNumber: 12,
      model: "gpt-5.5",
      tools: ["commands", "edits"],
      requiredChecks: ["git_diff_check"],
      workspace: { worktreeRoot: "/w/1", branch: "trama/ada-1" },
      threadId: "thread-1",
      turns: [{ number: 1, outcome: "interrupted" }],
      stops: [{ requestedBy: "Persona", reason: "Cambio di piano" }],
    });
    expect(reopened.team.proposals).toEqual(saved.team.proposals);
    expect(reopened.candidates).toEqual(saved.candidates);
  });

  it("accepts only supported images within the limits", async () => {
    const storage = new AppStorage(await mkdtemp(join(tmpdir(), "trama-storage-")));
    const png = { name: "a.png", mimeType: "image/png", dataBase64: Buffer.from("png").toString("base64") };
    const [path] = await storage.saveAttachments("p1", [png]);
    expect(await readFile(path!, "utf8")).toBe("png");
    await expect(storage.saveAttachments("p1", [{ ...png, mimeType: "image/svg+xml" }])).rejects.toThrow(/non supportato/);
    await expect(storage.saveAttachments("p1", Array(9).fill(png))).rejects.toThrow(/al massimo/);
  });
});
