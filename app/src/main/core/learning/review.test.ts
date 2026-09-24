import { describe, expect, it } from "vitest";
import {
  COMBINED_REVIEW_PROMPT,
  deniedToolMessage,
  finishTurnSkillNudge,
  MEMORY_REVIEW_PROMPT,
  resetOnToolUse,
  reviewPrompt,
  reviewToolNames,
  reviewTranscript,
  SKILL_REVIEW_PROMPT,
  summarizeReviewActions,
  tickMemoryNudge,
} from "./review";

describe("review triggers (Hermes turn_context / turn_finalizer)", () => {
  it("fires the memory review on the tenth person turn and resets", () => {
    const counters = { turnsSinceMemory: 0, itersSinceSkill: 0 };
    const fired = Array.from({ length: 20 }, () => tickMemoryNudge(counters, true));
    expect(fired.map((f, i) => (f ? i + 1 : null)).filter(Boolean)).toEqual([10, 20]);
    expect(tickMemoryNudge(counters, false)).toBe(false);
  });

  it("counts tool iterations for the skill review and resets when the Coordinator writes", () => {
    const counters = { turnsSinceMemory: 4, itersSinceSkill: 0 };
    expect(finishTurnSkillNudge(counters, 6)).toBe(false);
    expect(finishTurnSkillNudge(counters, 4)).toBe(true);
    expect(counters.itersSinceSkill).toBe(0);
    counters.itersSinceSkill = 7;
    resetOnToolUse(counters, "skill_manage");
    resetOnToolUse(counters, "memory");
    expect(counters).toEqual({ turnsSinceMemory: 0, itersSinceSkill: 0 });
  });

  it("picks Hermes' prompt by scope and names the tools the review may call", () => {
    expect(reviewPrompt({ memory: true, skills: true }, true)).toContain(COMBINED_REVIEW_PROMPT);
    expect(reviewPrompt({ memory: true, skills: false }, true)).toContain(MEMORY_REVIEW_PROMPT);
    expect(reviewPrompt({ memory: false, skills: true }, true)).toContain(SKILL_REVIEW_PROMPT);
    expect(reviewPrompt({ memory: false, skills: true }, true)).toMatch(/You can only call skill management tools\. Other tools will be denied at runtime — do not attempt them\.$/);
    expect(reviewPrompt({ memory: true, skills: false }, true, "focus on tests")).toContain("prioritize it over the general instructions above:\nfocus on tests");
    expect(reviewToolNames({ memory: false, skills: true }, true)).not.toContain("memory");
    expect(reviewToolNames({ memory: true, skills: true }, false)).not.toContain("memory");
    expect(deniedToolMessage("terminal", ["memory", "skill_manage"])).toContain("and memory for notes (add only)");
  });
});

describe("summarizeReviewActions", () => {
  it("reports writes, staged proposals and batch skills, never failures", () => {
    const actions = summarizeReviewActions([
      { tool: "memory", args: { target: "user" }, result: { success: true, message: "Entry added", target: "user" } },
      { tool: "memory", args: {}, result: { success: true, staged: true, proposal_staged: true, message: "staged for your approval" } },
      { tool: "memory", args: {}, result: { success: false, error: "Blocked" } },
      { tool: "skill_manage", args: {}, result: { success: true, operations_applied: 1, results: [{ name: "deploy", action: "patch", success: true }] } },
      { tool: "skill_view", args: {}, result: { success: true, content: "x" } },
      { tool: "memory", args: { target: "memory" }, result: { success: true, message: "Memory entry created." } },
    ]);
    expect(actions).toEqual(["User profile updated", "staged for your approval", "Skill 'deploy' patched", "Memory entry created."]);
  });
});

describe("reviewTranscript (Hermes _digest_history)", () => {
  it("keeps the last 24 messages verbatim and digests the older ones", () => {
    const messages = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), text: `message ${i}\nsecond line` }));
    const text = reviewTranscript(messages);
    expect(text.startsWith("[Earlier conversation digest")).toBe(true);
    expect(text).toContain("USER: message 0 second line");
    expect(text).toContain("ASSISTANT: message 5 second line");
    expect(text).toContain("USER: message 6\nsecond line");
    expect(reviewTranscript(messages.slice(0, 3))).not.toContain("digest");
  });

  it("never starts the verbatim tail on a tool message", () => {
    const messages = [
      ...Array.from({ length: 5 }, () => ({ role: "user" as const, text: "old" })),
      { role: "tool" as const, text: "tool output" },
      ...Array.from({ length: 23 }, () => ({ role: "user" as const, text: "recent" })),
    ];
    const text = reviewTranscript(messages);
    expect(text.split("\n\n")[1]!.startsWith("USER: old")).toBe(true);
  });
});
