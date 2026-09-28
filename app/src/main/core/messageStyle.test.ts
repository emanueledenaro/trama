import { describe, expect, it } from "vitest";
import { messageStyle } from "./messageStyle";

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
});
