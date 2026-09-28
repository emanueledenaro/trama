import { describe, expect, it } from "vitest";
import type { CoordinatorRequest } from "@shared/domain";
import { buildReferenceIndex } from "@shared/references";
import { emptyDocument, recordReply } from "./document";
import { recordUnknownReferences, UNKNOWN_REFERENCES_TITLE, unknownReferencesFeedback } from "./referenceCheck";
import { translator } from "@shared/i18n";

const t = translator("it");

const github = { repository: "o/r", status: "ready" as const, message: null, issues: [], snapshot: null, events: [] };

function setup() {
  const document = emptyDocument("p");
  document.decisions = [{ id: "D-AAAAAAAA", value: "Revisione", acceptedExample: "Ordine 42", rationale: "r", version: 1, decidedAt: "" }];
  for (const id of ["r1", "r2"]) document.requests.push({ id, goalId: null } as CoordinatorRequest);
  return document;
}

describe("unknown references in the Coordinator's replies (issue #277)", () => {
  it("records the ids that name nothing and tells the next turn", () => {
    const document = setup();
    const index = buildReferenceIndex(t, { document, modules: [], github });
    const reply = "La decisione D-AAAAAAAA vale; il candidato C-AC540E8F e la #99 sono pronti.";
    recordReply(document, "r1", reply, "m", []);
    expect(recordUnknownReferences(document, "r1", reply, index)).toEqual(["C-AC540E8F", "#99"]);
    const activity = document.events.find((e) => e.content.type === "activity" && e.content.title === UNKNOWN_REFERENCES_TITLE);
    expect(activity?.content).toMatchObject({ tone: "error", detail: "La risposta cita C-AC540E8F, #99, che non esistono tra i dati di Trama: restano testo semplice." });
    const feedback = unknownReferencesFeedback(document, "r2")!;
    expect(feedback).toContain("## Riferimenti che non esistono");
    expect(feedback).toContain("C-AC540E8F, #99");
  });

  it("stays quiet when every id is real", () => {
    const document = setup();
    const index = buildReferenceIndex(t, { document, modules: [], github });
    expect(recordUnknownReferences(document, "r1", "La decisione D-AAAAAAAA vale.", index)).toEqual([]);
    expect(document.events).toHaveLength(0);
    expect(unknownReferencesFeedback(document, "r2")).toBeNull();
    expect(unknownReferencesFeedback(document, "r1")).toBeNull();
  });
});
