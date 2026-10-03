import { describe, expect, it } from "vitest";
import { reviewerInstructions } from "./cleanCode";
import { messageStyle } from "./messageStyle";
import { toolErrorsRule, withoutToolErrors } from "./toolErrors";

describe("messageStyle (issue #301)", () => {
  it("asks for Italian by default", () => {
    const style = messageStyle("the person");
    expect(style).toContain("Write to the person in Italian");
    expect(style).toContain('"(consigliata)"');
  });

  it("asks for the language the person chose, and keeps the project's rules for code and commits", () => {
    const style = messageStyle("the person", "en");
    expect(style).toContain("Write to the person in English");
    expect(style).toContain('"(recommended)"');
    expect(style).toContain("commit messages, pull requests and the project's documents follow the project's own rules");
  });

  it("keeps tool errors and the technical review in the person's language", () => {
    expect(toolErrorsRule("en")).toContain("Say in plain English");
    const error = "Tool run_checks refused: the assignment has no worktree yet.";
    expect(withoutToolErrors(`I cannot: ${error}`, [error], "en")).toBe("I cannot: a Trama tool refused the request (the details are in Activity)");
    expect(reviewerInstructions(undefined, "en")).toContain("Answer in English.");
    expect(reviewerInstructions(undefined)).toContain("Answer in Italian.");
  });

  it("keeps the person's chat plain: the need first, no codes, settings or tool words, Trama's words explained (2 October 2026)", () => {
    const style = messageStyle("the person");
    expect(style).toContain("Open with what the person needs");
    expect(style).toContain("When they have nothing to do, say so in the first sentence");
    expect(style).toContain("write its id bare, never inside `code`");
    expect(style).toContain("commerce.checkout_enabled=false");
    expect(style).toContain("il Patto, cioè le decisioni che hai preso sul prodotto");
    expect(style).toContain("Patto: Le decisioni che hai preso sul comportamento del prodotto");
    expect(style).toContain("Speak as yourself, in the first person");
    expect(style).toContain("Do not repeat what the person already knows");
    expect(style).not.toContain("Put paths and commands in `code`");
    expect(messageStyle("the person", "en")).toContain("Speak plain English");
  });

  it("keeps the Coordinator's own briefings of the specialists technical", () => {
    const style = messageStyle("the Coordinator");
    expect(style).toContain("Put paths, commands and identifiers in `code`");
    expect(style).not.toContain("Speak as yourself");
  });
});

