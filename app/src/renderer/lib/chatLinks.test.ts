import { describe, expect, it } from "vitest";
import { projectFileLink } from "./chatLinks";

const project = {
  rootPath: "/Users/persona/negozio",
  snapshot: { modules: [{ files: [{ relativePath: "Sources/Orders/CancelPaidOrder.swift" }, { relativePath: "README.md" }] }] },
};

describe("projectFileLink (W12)", () => {
  it("finds a project file from a relative path, a path inside the folder or a line suffix", () => {
    expect(projectFileLink("Sources/Orders/CancelPaidOrder.swift", project)).toBe("Sources/Orders/CancelPaidOrder.swift");
    expect(projectFileLink("./README.md", project)).toBe("README.md");
    expect(projectFileLink("/Users/persona/negozio/Sources/Orders/CancelPaidOrder.swift:12", project)).toBe("Sources/Orders/CancelPaidOrder.swift");
    expect(projectFileLink("file:///Users/persona/negozio/README.md#L3", project)).toBe("README.md");
  });

  it("leaves out links that name no file of the project", () => {
    expect(projectFileLink("https://github.com/o/r", project)).toBeNull();
    expect(projectFileLink("mailto:persona@example.com", project)).toBeNull();
    expect(projectFileLink("Sources/Missing.swift", project)).toBeNull();
    expect(projectFileLink("/Users/altro/README.md", project)).toBeNull();
    expect(projectFileLink("README.md", null)).toBeNull();
  });
});
