import { describe, expect, it } from "vitest";
import { TOOL_ERROR_PLACEHOLDER, toolErrorMessage, withoutToolErrors } from "./toolErrors";
import { toolFailure, toolSuccess } from "./toolServer";

const notDeclared =
  "A-11BB6D2C is an assignment, not a candidate, and no candidate was declared from it yet. First call declare_candidate with assignment A-11BB6D2C and the Pact decisions it must respect, then call this tool again with the candidateID it returns.";

describe("tool errors stay out of the chat (issue #241)", () => {
  it("reads the message of a failed tool result, and nothing from a successful one", () => {
    expect(toolErrorMessage(toolFailure("candidate_not_declared", notDeclared))).toBe(notDeclared);
    expect(toolErrorMessage({ content: [{ type: "text", text: "Tool not found." }], isError: true })).toBe("Tool not found.");
    expect(toolErrorMessage(toolSuccess({ ok: true }))).toBeNull();
  });

  it("reads the error of a refused learning write (issue #305)", () => {
    const refused = { ...toolSuccess({ success: false, code: "memory_full", error: "Memory at 2,450/2,200 chars." }), isError: true };
    expect(toolErrorMessage(refused)).toBe("Memory at 2,450/2,200 chars.");
  });

  it("replaces an error the reply pastes verbatim with a line in Italian", () => {
    const reply = `Non posso eseguire le verifiche: ${notDeclared}`;
    expect(withoutToolErrors(reply, [notDeclared])).toBe(`Non posso eseguire le verifiche: ${TOOL_ERROR_PLACEHOLDER}`);
  });

  it("leaves alone a reply that explains the error in its own words, and errors too short to be a sentence", () => {
    const reply = "Non posso ancora verificare il lavoro di Ada: prima devo dichiararne il candidato. Lo faccio ora.";
    expect(withoutToolErrors(reply, [notDeclared])).toBe(reply);
    expect(withoutToolErrors("Il file non esiste.", ["not found"])).toBe("Il file non esiste.");
    expect(withoutToolErrors("Tutto fatto.", [])).toBe("Tutto fatto.");
  });
});
