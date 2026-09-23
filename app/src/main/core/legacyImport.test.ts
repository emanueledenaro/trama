import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { convertLegacyDocument, readLegacyDocument, readLegacyRecentProjects, swiftDate } from "./legacyImport";

const swiftDocument = {
  schemaVersion: 7,
  requests: [{ id: "R1", title: "t", moduleID: "Sources/Orders", moduleName: "Orders", request: "Come funziona?", state: "Risposta disponibile", createdAt: 780_000_000, sourceFingerprint: "x", model: "gpt-5.6-luna" }],
  conversation: {
    projectID: "P",
    lastSequence: 4,
    events: [
      { id: "E1", sequence: 1, origin: "coordinator", createdAt: 780_000_000, content: { card: { _0: { kind: "study", title: "Studio del progetto", detail: "Progetto Swift" } } } },
      { id: "E2", sequence: 2, origin: "person", requestID: "R1", createdAt: 780_000_010, content: { personMessage: { text: "Come funziona?", moduleID: "Sources/Orders", moduleName: "Orders" } } },
      { id: "E3", sequence: 3, origin: "coordinator", requestID: "R1", createdAt: 780_000_020, content: { coordinatorText: { text: "Così.", model: "gpt-5.6-luna", references: ["a.swift"] } } },
      { id: "E4", sequence: 4, origin: "trama", createdAt: 780_000_030, content: { card: { _0: { kind: "candidate", title: "Candidato", detail: "C-1" } } } },
    ],
  },
  pact: {
    decisionsByID: { "D-1": { id: "D-1", version: 2, value: "Revisione", acceptedExample: "Ordine 42", rationale: "r" } },
    decisionHistoryByID: { "D-1": [{ id: "D-1", version: 1, value: "Rimborso", acceptedExample: "e", rationale: "r" }, { id: "D-1", version: 2, value: "Revisione", acceptedExample: "Ordine 42", rationale: "r" }] },
  },
  mandate: {
    projectID: "P",
    version: 1,
    objectives: ["o"],
    priorities: [],
    scopeModuleIDs: ["Sources/Orders"],
    authorizedActions: [{ plan: { _0: "agreedTicket" } }, { executeInWorktree: {} }],
    limits: [],
    grantedBy: "Persona",
    grantedAt: 780_000_000,
    status: "granted",
    history: [],
  },
  coordinator: {
    thread: { provider: "codex", resumeCursor: { threadId: "thr_123" }, model: "gpt-5.6-luna", startedAt: 780_000_000, injectedStudy: {} },
    memory: { text: "Nota", updatedAt: 780_000_000, revision: 3 },
  },
  selectedModel: "gpt-5.6-luna",
};

describe("legacy import", () => {
  it("converts Swift dates", () => {
    expect(swiftDate(0)).toBe("2001-01-01T00:00:00.000Z");
  });

  it("converts the conversation, Pact, mandate and Coordinator thread", () => {
    const document = convertLegacyDocument(JSON.parse(JSON.stringify(swiftDocument)), "P");
    expect(document.events.map((e) => e.content.type)).toEqual(["card", "personMessage", "coordinatorText", "card"]);
    expect(document.events[3]!.content).toMatchObject({ kind: "contextNotice", title: "Candidato (importata dalla versione SwiftUI)" });
    expect(document.requests[0]).toMatchObject({ text: "Come funziona?", state: "completed" });
    expect(document.decisions).toMatchObject([{ id: "D-1", version: 2 }]);
    expect(document.decisionHistory).toHaveLength(2);
    expect(document.mandate?.authorizedActions).toEqual(["plan", "executeInWorktree"]);
    expect(document.coordinator).toMatchObject({ threadId: "thr_123", memory: { text: "Nota", revision: 3 } });
    expect(Object.keys(document.coordinator.injectedStudy).length).toBeGreaterThan(0);
  });

  it("finds Swift files by project id and reads recent projects", async () => {
    const root = await mkdtemp(join(tmpdir(), "trama-legacy-"));
    await mkdir(join(root, "Projects"));
    const id = "0A1B2C3D-0000-0000-0000-000000000000";
    await writeFile(join(root, "Projects", `${createHash("sha256").update(id).digest("hex")}.json`), JSON.stringify(swiftDocument));
    await writeFile(join(root, "recent-projects.json"), JSON.stringify([{ id, name: "Negozio", path: "/tmp/negozio", isDemo: false, lastOpenedAt: 780_000_000 }]));
    const recents = await readLegacyRecentProjects(root);
    expect(recents).toEqual([{ id, name: "Negozio", path: "/tmp/negozio", isDemo: false, lastOpenedAt: swiftDate(780_000_000) }]);
    expect(await readLegacyDocument(root, recents[0]!)).not.toBeNull();
  });
});
