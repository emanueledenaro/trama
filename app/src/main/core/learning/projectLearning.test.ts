import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LEARNING_SETTINGS } from "@shared/domain";
import { memoryTool } from "./memoryStore";
import { ProjectLearning } from "./projectLearning";

const learning = () => new ProjectLearning(mkdtempSync(join(tmpdir(), "trama-learning-")), "project-1", DEFAULT_LEARNING_SETTINGS);

describe("ProjectLearning", () => {
  it("migrates a long bullet list into entries the tools can still edit", () => {
    const project = learning();
    const bullets = Array.from({ length: 80 }, (_, i) => `- fatto numero ${i} sul progetto, con dettagli`).join("\n");
    expect(project.migrateLegacyMemory(bullets)).toBe(true);
    const entries = project.memory.entriesFor("memory");
    project.memory.loadFromDisk();
    expect(project.memory.entriesFor("memory").length).toBe(80);
    expect(entries).toEqual([]);
    expect(project.memory.remove("memory", "fatto numero 3 sul").success).toBe(true);
    expect(readdirSync(project.projectDir).some((f) => f.includes(".bak."))).toBe(false);
    expect(project.migrateLegacyMemory("altro")).toBe(false);
  });

  it("shows every staged operation and refuses a proposal whose entries changed", () => {
    const project = learning();
    project.memory.add("user", "Prefers Italian");
    project.memory.add("user", "Works on macOS");
    const review = { store: project.memory, origin: "backgroundReview" as const, stage: (p: Parameters<typeof project.stageProposal>[0]) => project.stageProposal(p) };
    memoryTool({ target: "user", operations: [{ action: "replace", old_text: "Italian", content: "Prefers Italian, short answers" }, { action: "remove", old_text: "macOS" }] }, review);
    const [proposal] = project.view({ turnsSinceMemory: 0, itersSinceSkill: 0 }).proposals;
    expect(proposal!.operations).toEqual(["- replace entry matching 'Italian' -> whole entry becomes: Prefers Italian, short answers", "- remove: macOS"]);
    project.memory.replace("user", "macOS", "Works on macOS and Linux");
    expect(project.resolveProposal(proposal!.id, true)).toMatchObject({ success: false });
    expect(project.memory.entriesFor("user")).toEqual(["Prefers Italian", "Works on macOS and Linux"]);
    expect(project.resolveProposal(proposal!.id, false).success).toBe(true);
    expect(project.proposals()).toEqual([]);
  });
});
