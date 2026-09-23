import { describe, expect, it } from "vitest";
import { partsToInject, redactSecrets } from "./study";

describe("study", () => {
  it("redacts credentials", () => {
    expect(redactSecrets("token ghp_abcdefghijklmnopqrstuvwxyz0123")).toBe("token [segreto rimosso]");
    expect(redactSecrets("OPENAI_API_KEY=sk-live")).toBe("OPENAI_API_KEY=[segreto rimosso]");
    expect(redactSecrets("nessun segreto")).toBe("nessun segreto");
  });

  it("injects only changed parts and never the history", () => {
    const study = {
      updatedAt: "",
      sections: [
        { part: "code" as const, text: "a", fingerprint: "1" },
        { part: "pact" as const, text: "b", fingerprint: "2" },
        { part: "history" as const, text: "c", fingerprint: "3" },
      ],
    };
    expect(partsToInject(study, { code: "1" })).toEqual(["pact"]);
    expect(partsToInject(study, {})).toEqual(["code", "pact"]);
  });
});
