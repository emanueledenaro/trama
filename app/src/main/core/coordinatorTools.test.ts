import { describe, expect, it } from "vitest";
import { COORDINATOR_TOOLS, developerInstructions } from "./coordinatorTools";

describe("Coordinator grilling instructions (M01)", () => {
  it("describe rounds, the frontier, the recommended answer, when to skip and the confirmation", () => {
    const instructions = developerInstructions("Demo");
    expect(instructions).toContain("Work the tree in rounds. The frontier is every decision whose prerequisites are already settled");
    expect(instructions).toContain("recommendedAlternative, the alternative you recommend");
    expect(instructions).toContain("Ask the person only decisions.");
    expect(instructions).toContain("A small change needs one round. A request for information");
    expect(instructions).toContain("ask the person to confirm it; only after that confirmation start the plan or the work");
  });

  it("let request_decision carry the round and the recommended alternative", () => {
    const tool = COORDINATOR_TOOLS.find((t) => t.name === "request_decision")!;
    expect(Object.keys(tool.properties)).toEqual(expect.arrayContaining(["grillingRound", "recommendedAlternative"]));
    expect(tool.required).not.toContain("grillingRound");
  });
});
