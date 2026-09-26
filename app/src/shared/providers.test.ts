import { describe, expect, it } from "vitest";
import { catalogModel, catalogOffers } from "./providers";

describe("catalogue names", () => {
  const antigravity = ["Gemini 3.8 Flash", "Gemini 3.1 Pro", "Claude Sonnet 4.6"];

  it("reads an Antigravity name with its level as the catalogue model and that level", () => {
    expect(catalogModel("antigravity", "Gemini 3.8 Flash (High)")).toEqual({ model: "Gemini 3.8 Flash", effort: "high" });
    expect(catalogModel("antigravity", "Claude Sonnet 4.6 (Thinking)")).toEqual({ model: "Claude Sonnet 4.6", effort: "thinking" });
    expect(catalogModel("antigravity", "Gemini 3.8 Flash")).toEqual({ model: "Gemini 3.8 Flash", effort: null });
    // Other providers keep parentheses as part of the name.
    expect(catalogModel("opencode", "local/llama (Q4)")).toEqual({ model: "local/llama (Q4)", effort: null });
  });

  it("accepts the full names agy 1.2.11 lists", () => {
    for (const name of ["Gemini 3.8 Flash (High)", "Gemini 3.8 Flash (Low)", "Gemini 3.1 Pro (High)", "Claude Sonnet 4.6 (Thinking)", "Gemini 3.8 Flash"]) {
      expect(catalogOffers("antigravity", antigravity, name)).toBe(true);
    }
    expect(catalogOffers("antigravity", antigravity, "Gemini 9 Ultra (High)")).toBe(false);
    expect(catalogOffers("codex", ["gpt-6-luna"], "gpt-6-luna (High)")).toBe(false);
  });
});
