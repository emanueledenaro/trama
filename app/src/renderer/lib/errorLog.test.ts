import { describe, expect, it } from "vitest";
import { translator } from "@shared/i18n";
import type { ActivityEntry } from "@shared/activity";
import type { TechnicalStep } from "@shared/technicalSteps";
import { entryHasError, entryLog, joinLogs, turnLog } from "./errorLog";

const t = translator("it");
const step = (title: string, tone: TechnicalStep["tone"], details: string[] = [], count = 1) =>
  ({ id: title, event: {} as TechnicalStep["event"], title, tone, count, details }) satisfies TechnicalStep;

describe("the error log of Activity (2 October 2026)", () => {
  it("writes a turn with who, the request and every step, the failed ones marked with their output", () => {
    const log = turnLog(
      { who: "Luca", at: "2026-10-02T10:00:00.000Z", request: "sistema il typecheck", steps: [step("Letto package.json", "tool"), step("Comando npm run typecheck", "error", ["EACCES: permission denied\ntsconfig.tsbuildinfo"], 2)] },
      "it",
      t,
    );
    expect(log.split("\n")[0]).toMatch(/^Luca · .* · 2 passi, 1 con errore$/);
    expect(log).toContain("Richiesta: «sistema il typecheck»");
    expect(log).toContain("1. Letto package.json");
    expect(log).toContain("2. [errore] Comando npm run typecheck (×2)");
    expect(log).toContain("   EACCES: permission denied\n   tsconfig.tsbuildinfo");
  });

  it("writes a failed move with why it failed and the tools' own errors", () => {
    const entry = { label: "Esegui le verifiche", startedAt: "2026-10-02T10:00:00.000Z", outcome: "failed", trigger: "dopo una verifica rossa", detail: "La verifica non è partita.", toolErrors: [{ title: "run_checks", detail: "no worktree" }] } as ActivityEntry;
    expect(entryHasError(entry)).toBe(true);
    const log = entryLog(entry, "Non riuscita", "it", t);
    expect(log).toContain("Esegui le verifiche · ");
    expect(log).toContain(" · Non riuscita");
    expect(log).toContain("Perché: dopo una verifica rossa");
    expect(log).toContain("Strumenti non riusciti:\n- run_checks\n   no worktree");
  });

  it("copies only rows with an error, one after the other", () => {
    expect(entryHasError({ outcome: "done", toolErrors: [] })).toBe(false);
    expect(joinLogs(["a", "b"])).toBe("a\n\n---\n\nb");
  });
});
