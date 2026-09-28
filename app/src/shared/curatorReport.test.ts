import { describe, expect, it } from "vitest";
import { curatorRunLine, curatorRunView } from "./curatorReport";
import { translator } from "./i18n";

const report = (change: Partial<Parameters<typeof curatorRunView>[0] & object> = {}) => ({
  dryRun: false,
  autoTransitions: { markedStale: 0, archived: 0, reactivated: 0 },
  consolidated: [],
  pruned: [],
  llmError: null,
  ...change,
});

describe("the upkeep's last check for the person", () => {
  it("is null before the upkeep finishes a check", () => {
    expect(curatorRunView(null)).toBeNull();
  });

  it("says the changes in Italian, with the singular for one", () => {
    const run = curatorRunView(report({ autoTransitions: { markedStale: 2, archived: 1, reactivated: 0 }, pruned: [{}] }))!;
    expect(curatorRunLine(translator("it"), run)).toBe("2 skill inattive, 1 archiviata, 1 ritirata");
  });

  it("says when nothing changed, and marks the preview", () => {
    const t = translator("it");
    expect(curatorRunLine(t, curatorRunView(report())!)).toBe("nessun cambiamento");
    expect(curatorRunLine(t, curatorRunView(report({ dryRun: true, consolidated: [{}, {}] }))!)).toBe("anteprima, 2 unite ad altre");
  });

  it("never shows the upkeep's technical summary or the model's error", () => {
    const run = curatorRunView(report({ llmError: "spawn codex ENOENT" }))!;
    for (const language of ["it", "en"] as const) {
      const line = curatorRunLine(translator(language), run);
      expect(line).not.toMatch(/ENOENT|llm|auto:|deferred|curator|—/);
    }
    expect(curatorRunLine(translator("en"), run)).toBe("no changes; the merge with a model failed");
  });
});
