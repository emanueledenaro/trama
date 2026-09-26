import { describe, expect, it } from "vitest";
import { clampWidth, sashKeyDelta, sashOrientation } from "./resizable";

describe("clampWidth", () => {
  it("keeps a panel between its minimum and maximum, and at the minimum when the window is too narrow for both", () => {
    expect(clampWidth(500, 340, 900)).toBe(500);
    expect(clampWidth(100, 340, 900)).toBe(340);
    expect(clampWidth(2000, 340, 900)).toBe(900);
    expect(clampWidth(600, 340, 200)).toBe(340);
  });
});

describe("sashOrientation", () => {
  it("makes side edges vertical and top or bottom edges horizontal", () => {
    expect(sashOrientation("left")).toBe("vertical");
    expect(sashOrientation("right")).toBe("vertical");
    expect(sashOrientation("top")).toBe("horizontal");
    expect(sashOrientation("bottom")).toBe("horizontal");
  });
});

describe("sashKeyDelta", () => {
  it("grows the panel when the arrow points away from it", () => {
    expect(sashKeyDelta("right", "ArrowRight", false)).toBe(16);
    expect(sashKeyDelta("right", "ArrowLeft", false)).toBe(-16);
    expect(sashKeyDelta("left", "ArrowLeft", false)).toBe(16);
    expect(sashKeyDelta("left", "ArrowRight", false)).toBe(-16);
    expect(sashKeyDelta("bottom", "ArrowDown", false)).toBe(16);
    expect(sashKeyDelta("top", "ArrowUp", false)).toBe(16);
    expect(sashKeyDelta("top", "ArrowDown", false)).toBe(-16);
  });

  it("takes bigger steps with Shift", () => {
    expect(sashKeyDelta("right", "ArrowRight", true)).toBe(64);
    expect(sashKeyDelta("left", "ArrowRight", true)).toBe(-64);
  });

  it("ignores the arrows across the sash and every other key", () => {
    expect(sashKeyDelta("right", "ArrowUp", false)).toBeNull();
    expect(sashKeyDelta("bottom", "ArrowLeft", false)).toBeNull();
    expect(sashKeyDelta("left", "Enter", false)).toBeNull();
  });
});
