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
});
