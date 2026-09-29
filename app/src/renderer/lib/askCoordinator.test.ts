import { describe, expect, it } from "vitest";
import { resolveMentions } from "@shared/mentions";
import { issueQuestion, specialistQuestion, withQuestion } from "./askCoordinator";
import { translator } from "@shared/i18n";

const t = translator("it");

describe("Chiedi al Coordinatore (W12)", () => {
  it("cites the issue with the composer's mention, so the Coordinator receives it as context", () => {
    const question = issueQuestion({ number: 152, title: "Ogni pulsante fa quello che dice" });
    expect(question).toContain("@issue:152 ");
    const issue = { number: 152, title: "Ogni pulsante fa quello che dice", state: "open" as const, body: "", url: "", author: null, labels: [], updatedAt: "" };
    expect(resolveMentions(t, question, { modules: [], issues: [issue], decisions: [] }).map((m) => m.label)).toEqual(["issue #152"]);
  });

  it("asks about the specialist's latest assignment, or about the role when there is none", () => {
    expect(specialistQuestion({ name: "Ada" }, { objective: "Annullare gli ordini pagati" })).toBe(
      "Aggiornami sul lavoro di Ada: «Annullare gli ordini pagati».",
    );
    expect(specialistQuestion({ name: "Guardiano delle regressioni" }, null)).toContain("Guardiano delle regressioni");
  });

  it("keeps what the person already wrote and never adds the same question twice", () => {
    expect(withQuestion("", "Domanda?")).toBe("Domanda?");
    expect(withQuestion("Bozza mia  ", "Domanda?")).toBe("Bozza mia\n\nDomanda?");
    expect(withQuestion("Bozza mia\n\nDomanda?", "Domanda?")).toBe("Bozza mia\n\nDomanda?");
  });
});
