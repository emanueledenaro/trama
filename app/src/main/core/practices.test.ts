import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Practice } from "@shared/domain";
import { emptyDocument } from "./document";
import { decide } from "./pact";
import {
  adoptedPractices,
  adoptPractice,
  PracticeStore,
  practicesText,
  privateContent,
  problemEvidence,
  proposePractice,
  retirePractice,
  revisePractice,
  rollbackPractice,
} from "./practices";

const evidence = [{ kind: "review" as const, reference: "R-1", summary: "Revisione tecnica con modifiche richieste" }];

describe("practices (C15)", () => {
  it("accepts only evidence of a problem in the project", () => {
    const document = emptyDocument("p");
    document.conflicts = [
      { id: "c1", candidateId: "C-1", snapshotId: "s", remoteSHA: "a", references: [], classification: "conflict", conflictingFiles: [], detail: "", checkedAt: "" },
      { id: "c2", candidateId: "C-1", snapshotId: "s", remoteSHA: "b", references: [], classification: "clean", conflictingFiles: [], detail: "", checkedAt: "" },
    ];
    expect(problemEvidence(document, "c1")?.kind).toBe("conflict");
    expect(problemEvidence(document, "c2")).toBeNull();
    expect(problemEvidence(document, "anything")).toBeNull();
  });

  it("keeps project-specific content out of a practice", () => {
    const document = emptyDocument("p");
    const decision = decide(document, { id: null, value: "v", acceptedExample: "e", rationale: "r" });
    expect(privateContent(`Rileggi Sources/Orders/Cancel.swift come in ${decision.id} e #42`, document, ["Sources/Orders/Cancel.swift"])).toEqual([
      "Sources/Orders/Cancel.swift",
      decision.id,
      "#42",
    ]);
    expect(privateContent("Scrivi prima il test che riproduce il difetto", document, ["Sources/Orders/Cancel.swift"])).toEqual([]);
  });

  it("adopts per project, versions, rolls back and retires with history", async () => {
    const practices: Practice[] = [];
    expect(() => proposePractice(practices, { projectId: "a", title: "t", method: "m", rationale: "r", evidence: [] })).toThrow(/evidence/);
    const practice = proposePractice(practices, { projectId: "a", title: "Test prima", method: "Scrivi il test che fallisce", rationale: "Regressioni", evidence });
    expect(adoptedPractices(practices, "b")).toEqual([]);
    adoptPractice(practices, practice.id, "b");
    revisePractice(practices, practice.id, { method: "Scrivi il test che fallisce e fallo vedere", rationale: "r", evidence });
    expect(adoptedPractices(practices, "b")[0]).toMatchObject({ version: 1 });
    adoptPractice(practices, practice.id, "b");
    expect(adoptedPractices(practices, "b")[0]).toMatchObject({ version: 2 });
    rollbackPractice(practices, practice.id, "b");
    expect(practicesText(practices, "b")).toContain("(v1): Scrivi il test che fallisce");
    expect(practicesText(practices, "a")).toBeNull();
    retirePractice(practices, practice.id, "b", "Non aiuta qui");
    expect(adoptedPractices(practices, "b")).toEqual([]);
    expect(practice.status).toBe("retired");
    expect(practice.adoptions[0]).toMatchObject({ retiredReason: "Non aiuta qui" });
    expect(practice.versions).toHaveLength(2);

    const store = new PracticeStore(await mkdtemp(join(tmpdir(), "trama-practices-")));
    await store.save(practices);
    expect(await store.load()).toEqual(practices);
  });
});
