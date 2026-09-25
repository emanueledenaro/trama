import { describe, expect, it } from "vitest";
import { clampWidth } from "./resizable";

describe("clampWidth", () => {
  it("keeps a panel between its minimum and maximum, and at the minimum when the window is too narrow for both", () => {
    expect(clampWidth(500, 340, 900)).toBe(500);
    expect(clampWidth(100, 340, 900)).toBe(340);
    expect(clampWidth(2000, 340, 900)).toBe(900);
    expect(clampWidth(600, 340, 200)).toBe(340);
  });
});
