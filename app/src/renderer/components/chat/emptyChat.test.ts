import { describe, expect, it } from "vitest";
import { emptyChatAction } from "./emptyChat";

describe("emptyChatAction", () => {
  it("offers the first goal while no goal is confirmed", () => {
    expect(emptyChatAction(undefined)).toBe("firstGoal");
    expect(emptyChatAction([])).toBe("firstGoal");
    expect(emptyChatAction([{ status: "proposed" }])).toBe("firstGoal");
  });

  it("offers the first message once a goal is confirmed", () => {
    expect(emptyChatAction([{ status: "proposed" }, { status: "active" }])).toBe("write");
  });
});
