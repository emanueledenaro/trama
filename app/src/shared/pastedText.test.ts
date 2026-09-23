import { describe, expect, it } from "vitest";
import { extractPastes, pasteSizeLabel, pasteTitle, serializePastes, shouldCollapsePaste } from "./pastedText";

describe("pasted text", () => {
  it("collapses long pastes and round-trips them", () => {
    expect(shouldCollapsePaste("breve")).toBe(false);
    expect(shouldCollapsePaste(Array(25).fill("riga").join("\n"))).toBe(true);
    expect(shouldCollapsePaste("x".repeat(4_000))).toBe(true);
    const message = serializePastes("Guarda questo log", ["errore 1\nerrore 2"]);
    expect(extractPastes(message)).toEqual({ prompt: "Guarda questo log", pastes: ["errore 1\nerrore 2"] });
    expect(extractPastes("solo testo")).toEqual({ prompt: "solo testo", pastes: [] });
    expect(pasteTitle("\n  prima riga  \nseconda")).toBe("prima riga");
    expect(pasteSizeLabel("a\nb\nc")).toBe("3 righe");
  });
});
