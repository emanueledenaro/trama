import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LEARNING_SETTINGS } from "@shared/domain";
import { ProjectLearning } from "./projectLearning";
import { runReviewSession } from "./reviewRunner";

const executable = join(import.meta.dirname, "../../../../test-fixtures/fake-codex.mjs");

describe("runReviewSession", () => {
  it("stops the session at the tool-call limit and keeps what was saved", async () => {
    const learning = new ProjectLearning(mkdtempSync(join(tmpdir(), "trama-review-")), "p", DEFAULT_LEARNING_SETTINGS);
    const result = await runReviewSession({
      learning,
      provider: "codex",
      model: "gpt-5.5",
      executable,
      allowedTools: ["memory", "skills_list", "skill_view", "skill_manage"],
      prompt: "Review the conversation above\n\nYou can only call memory and skill management tools.",
      maxToolCalls: 1,
      timeoutMs: 20_000,
      attended: false,
    });
    expect(result.calls.map((c) => c.tool)).toEqual(["memory"]);
    learning.memory.loadFromDisk();
    expect(learning.memory.entriesFor("user")).toEqual(["La persona preferisce risposte brevi in italiano"]);
    expect(learning.skills.entries()).toEqual([]);
  });
});
