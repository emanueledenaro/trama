import { afterEach, describe, expect, it } from "vitest";
import { setPersonLanguage } from "../personLanguage";
import { memoryActivityLine, memoryErrorCode, memoryFailureLine } from "./memoryErrors";

describe("memory refusals in Italian (issue #305)", () => {
  const full = { success: false, code: "memory_full", error: "Memory at 2,450/2,200 chars. Adding this entry (80 chars) would exceed the limit. Consolidate now." };

  it("never gives the person the model's English text", () => {
    expect(memoryFailureLine(full, "memory", { chars: 2450, limit: 2200 })).toBe(
      "La memoria del progetto è piena (2450 su 2200 caratteri): togli o accorcia una nota prima di aggiungerne un'altra.",
    );
    expect(memoryFailureLine({ ...full }, "user", { chars: 1375, limit: 1375 })).toMatch(/^Il profilo è pieno/);
    const tooMany = { success: false, code: "too_many_failures", error: "Memory consolidation failed 4 times this turn. Stop retrying memory calls" };
    for (const result of [full, tooMany, { success: false, code: "no_match", error: "No entry matched" }, { success: false, error: "Unknown" }]) {
      expect(memoryFailureLine(result, "memory", { chars: 0, limit: 2200 })).not.toMatch(/Memory|entry|turn/);
      expect(memoryActivityLine(result)).toMatch(/^Memoria non aggiornata/);
    }
  });

  it("reads the code, and none for a success", () => {
    expect(memoryErrorCode({ success: true })).toBeNull();
    expect(memoryErrorCode(full)).toBe("memory_full");
    expect(memoryErrorCode({ success: false, error: "x" })).toBe("unknown");
    expect(memoryActivityLine(full)).toBe("Memoria non aggiornata: è piena.");
  });
});

describe("memory refusals in English (issue #301)", () => {
  afterEach(() => setPersonLanguage("it"));

  it("says the refusal in the person's language, with the numbers of the language", () => {
    setPersonLanguage("en");
    const full = { success: false, code: "memory_full", error: "Memory at 12,450/12,200 chars." };
    expect(memoryFailureLine(full, "memory", { chars: 12450, limit: 12200 })).toBe(
      "The project Memory is full (12,450 of 12,200 characters): remove or shorten a note before adding another one.",
    );
    expect(memoryActivityLine(full)).toBe("Memory not updated: it is full.");
    setPersonLanguage("it");
    expect(memoryFailureLine(full, "user", { chars: 12450, limit: 12200 })).toMatch(/^Il profilo è pieno \(12\.450 su 12\.200 caratteri\)/);
  });
});
