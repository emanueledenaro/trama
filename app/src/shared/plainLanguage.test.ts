import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BLOCKER_TEXT, GLOSSARY, plainConflictReference, plainText, withoutRepeatedLead } from "./plainLanguage";

describe("plain language for the person (issue #270)", () => {
  it("keeps the glossary of the documentation and of the code the same", () => {
    const doc = readFileSync(join(__dirname, "../../../docs/glossario.md"), "utf8");
    const rows = doc
      .split("\n")
      .filter((line) => line.startsWith("| ") && !line.startsWith("| Parola") && !line.startsWith("| ---"))
      .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
    expect(rows).toEqual(GLOSSARY.map((t) => [t.term, t.meaning, t.insteadOf.join(", ")]));
  });

  it("names a skill without its path", () => {
    expect(plainText("Skill ricevute: skill:improve-codebase-architecture:/home/user/trama/app/resources/AIHero/skills/improve-codebase-architecture/SKILL.md, tdd")).toBe(
      "Skill ricevute: improve-codebase-architecture, tdd",
    );
    expect(plainText("Letta /Users/ada/Library/Trama/skills/grilling/SKILL.md prima di rispondere")).toBe("Letta grilling prima di rispondere");
  });

  it("translates the technical codes and the skill's fixed phrases", () => {
    expect(plainText("WORKTREE_CONFLICT con il lavoro di Ada")).toBe(`${BLOCKER_TEXT.WORKTREE_CONFLICT!.toLowerCase()} con il lavoro di Ada`);
    expect(plainText("no spec available")).toBe("Nessun piano da confrontare");
    expect(plainText("Spec: no spec available.")).toBe("Spec: nessun piano da confrontare.");
    expect(plainText("Tutto a posto.")).toBe("Tutto a posto.");
  });

  it("does not repeat the lead of a label", () => {
    expect(withoutRepeatedLead("Approfondire", "Approfondire l'annullamento")).toBe("Approfondire l'annullamento");
    expect(withoutRepeatedLead("Approfondire", "Unire i pagamenti")).toBe("Approfondire: Unire i pagamenti");
  });

  it("reads an older comparison record by its id alone", () => {
    expect(plainConflictReference("C-4B220EA8 di Ada (feature/documenta-l-annullamento-trama-1dd0a7a0)")).toBe("C-4B220EA8");
    expect(plainConflictReference("C-4B220EA8")).toBe("C-4B220EA8");
    expect(plainConflictReference("feature")).toBe("feature");
  });
});
