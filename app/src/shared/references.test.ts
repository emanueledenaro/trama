import { describe, expect, it } from "vitest";
import { emptyDocument } from "../main/core/document";
import type { Candidate, GitHubState, SpecialistAssignment, Specialist, WorkPlan } from "./domain";
import {
  buildReferenceIndex,
  lookupReference,
  parseReferenceHref,
  referenceHref,
  referenceListing,
  referenceText,
  referenceTitle,
  splitReferences,
  leadingPunctuation,
  unknownReferences,
} from "./references";
import { translator } from "@shared/i18n";

const t = translator("it");

const assignment = { id: "A-11111111", objective: "Mostrare gli ordini in revisione al supporto", slice: { planId: "P-22222222", sliceId: "S2" }, workspace: { branch: "feature/support-review-trama-1a2b3c4d" } } as SpecialistAssignment;
const luca = { id: "S-33333333", name: "Luca", origin: "coordinator", competence: "Swift", assignments: [assignment] } as unknown as Specialist;
const security = { id: "S-44444444", name: "Sicurezza", origin: "fixedRole", competence: "Vulnerabilità", assignments: [] } as unknown as Specialist;
const candidate = { id: "C-55555555", assignmentId: "A-11111111", specialistId: "S-33333333", baseSHA: "0123456789abcdef0123456789abcdef01234567", technicalReview: null, pullRequest: null } as unknown as Candidate;
const plan = {
  id: "P-22222222",
  summary: "Revisione degli ordini",
  proposal: null,
  spec: null,
  slicing: {
    tickets: [
      { id: "S1", title: "Il pagamento va in revisione", whatToBuild: "..." },
      { id: "S2", title: "Il supporto vede gli ordini in revisione", whatToBuild: "..." },
    ],
  },
} as unknown as WorkPlan;
const github: GitHubState = {
  repository: "negozio/app",
  status: "ready",
  message: null,
  issues: [{ number: 13, title: "Annullo ordini pagati", state: "open", body: "", url: "https://github.com/negozio/app/issues/13", author: null, labels: [], updatedAt: "" }],
  pullRequestLinks: [{ number: 14, linkedIssues: [13] }],
  snapshot: null,
  events: [],
};
const modules = [
  {
    id: "Sources/Orders",
    name: "Orders",
    summary: "Ordini",
    relativePath: "Sources/Orders",
    files: [{ id: "f", relativePath: "Sources/Orders/CancelPaidOrder.swift", lineCount: 15, contentHash: "" }],
    dependencies: [],
    symbol: "folder",
  },
];

function index(ready = true) {
  const document = emptyDocument("p");
  document.team.specialists = [luca, security];
  document.candidates = [candidate];
  document.plans = [plan];
  document.decisions = [{ id: "D-1", value: "Un ordine pagato annullato va in revisione", acceptedExample: "Ordine 42", rationale: "r", version: 1, decidedAt: "" }];
  document.goals = [{ id: "G-66666666", title: "Annullo sicuro", outcome: "Nessun rimborso automatico" } as never];
  return buildReferenceIndex(t, { document, modules, github: { ...github, status: ready ? "ready" : "loading" } });
}

const links = (text: string, ready = true) =>
  splitReferences(text, index(ready)).map((part) => ("reference" in part ? `[${part.reference.target.kind}:${part.text}]` : "unknown" in part ? `{${part.text}}` : part.text)).join("");

describe("references in messages (issue #277)", () => {
  it("links the ids, numbers, names, paths and slices that name Trama's records", () => {
    // The author the candidate's name already says is part of its link (issue #392).
    expect(links("Il candidato C-55555555 di Luca chiude la S2 e la #13, vedi Sources/Orders/CancelPaidOrder.swift:12 e la PR #14.")).toBe(
      "Il candidato [candidate:C-55555555 di Luca] chiude la [slice:S2] e la [issue:#13], vedi [file:Sources/Orders/CancelPaidOrder.swift:12] e la PR [pullRequest:#14].",
    );
    expect(links("Luca consegna il candidato C-55555555.")).toBe("[specialist:Luca] consegna il candidato [candidate:C-55555555].");
    expect(links("Incarico A-11111111, decisione D-1, obiettivo G-66666666, piano P-22222222, modulo Sources/Orders.")).toBe(
      "Incarico [assignment:A-11111111], decisione [decision:D-1], obiettivo [goal:G-66666666], piano [plan:P-22222222], modulo [module:Sources/Orders].",
    );
    expect(links("Branch feature/support-review-trama-1a2b3c4d, base 0123456.")).toBe("Branch [branch:feature/support-review-trama-1a2b3c4d], base [commit:0123456].");
  });

  it("links the composer's mentions and keeps the punctuation out", () => {
    expect(links("Guarda @module:Sources/Orders, @issue:13 e @Sources/Orders/CancelPaidOrder.swift.")).toBe(
      "Guarda [module:@module:Sources/Orders], [issue:@issue:13] e [file:@Sources/Orders/CancelPaidOrder.swift].",
    );
  });

  it("leaves unknown ids as text and reports them, only when Trama can know", () => {
    expect(links("Il candidato C-AC540E8F e la #99 non esistono; E-12345678 non si collega.")).toBe(
      "Il candidato {C-AC540E8F} e la {#99} non esistono; E-12345678 non si collega.",
    );
    expect(unknownReferences("C-AC540E8F, C-AC540E8F e #99", index())).toEqual(["C-AC540E8F", "#99"]);
    // Before GitHub answers an issue number cannot be judged.
    expect(unknownReferences("la #99", index(false))).toEqual([]);
    // A fixed role's name is a common word, a slice id that names nothing is not reported.
    expect(links("Sicurezza e S9 restano testo.")).toBe("Sicurezza e S9 restano testo.");
    expect(links("Niente url&#13; né a/#13")).toBe("Niente url&#13; né a/#13");
  });

  it("shows readable names and keeps the id for the hover", () => {
    const refs = index();
    const slice = lookupReference("S2", refs)!;
    expect(slice.label).toBe("fetta 2, Il supporto vede gli ordini in revisione");
    expect(referenceText(slice, "S2", "Ora lavoro sulla ")).toBe("fetta 2, Il supporto vede gli ordini in revisione");
    expect(referenceText(slice, "S2", "Ora lavoro sulla fetta ")).toBe("2, Il supporto vede gli ordini in revisione");
    const work = lookupReference("C-55555555", refs)!;
    expect(work.label).toBe("candidato di Luca, fetta 2, Il supporto vede gli ordini in revisione");
    expect(referenceTitle(work)).toBe("C-55555555: Mostrare gli ordini in revisione al supporto");
    expect(referenceText(lookupReference("#13", refs)!, "#13", "Chiude ")).toBe("issue #13");
    expect(referenceText(lookupReference("#13", refs)!, "#13", "Chiude la issue ")).toBe("#13");
    expect(lookupReference("#13", refs)!.url).toBe("https://github.com/negozio/app/issues/13");
    expect(lookupReference("#14", refs)!.url).toBe("https://github.com/negozio/app/pull/14");
    expect(referenceText(lookupReference("S-33333333", refs)!, "S-33333333", "Lavora ")).toBe("Luca");
    expect(referenceText(lookupReference("Luca", refs)!, "Luca", "")).toBe("Luca");
  });

  it("numbers the works of the same agent that would read the same", () => {
    const document = emptyDocument("p");
    const first = { id: "A-00000001", objective: "Prima" } as SpecialistAssignment;
    const second = { id: "A-00000002", objective: "Seconda" } as SpecialistAssignment;
    document.team.specialists = [{ ...luca, assignments: [first, second] } as Specialist];
    document.candidates = [{ ...candidate, id: "C-00000001", assignmentId: "A-00000001" }, { ...candidate, id: "C-00000002", assignmentId: "A-00000002" }];
    const refs = buildReferenceIndex(t, { document, modules: [], github });
    expect(lookupReference("C-00000001", refs)!.label).toBe("candidato di Luca, n. 1");
    expect(lookupReference("C-00000002", refs)!.label).toBe("candidato di Luca, n. 2");
    expect(lookupReference("A-00000002", refs)!.label).toBe("incarico di Luca, n. 2");
  });

  it("leaves a number that belongs to another word as the text wrote it (issue #392)", () => {
    // "S1" and "#2" after a word that is not a noun of Trama are that word's own codes, not a slice or an issue.
    expect(links("Le tariffe S1 e S2 valgono per l'ordine #13 e il prodotto #14.")).toBe("Le tariffe S1 e S2 valgono per l'ordine #13 e il prodotto #14.");
    expect(unknownReferences("La taglia S9 e il passo #99", index())).toEqual([]);
    // The noun of Trama, an article or a list of the same kind keep the reference.
    expect(links("La fetta S1, la S2 e le issue #13 e #14.")).toBe("La fetta [slice:S1], la [slice:S2] e le issue [issue:#13] e [pullRequest:#14].");
    expect(links("Sto verificando la S1, poi assegno la S2.")).toBe("Sto verificando la [slice:S1], poi assegno la [slice:S2].");
  });

  it("says the author of a work once (issue #392)", () => {
    const refs = index();
    const [before, part, after] = splitReferences("Il candidato C-55555555 di Luca è pronto.", refs);
    expect(before).toEqual({ text: "Il candidato " });
    expect(part).toMatchObject({ text: "C-55555555 di Luca", reference: { id: "C-55555555" } });
    expect(after).toEqual({ text: " è pronto." });
    const reference = (part as { reference: Parameters<typeof referenceText>[0] }).reference;
    expect(`${before!.text}${referenceText(reference, part!.text, before!.text)}${after!.text}`).toBe(
      "Il candidato di Luca, fetta 2, Il supporto vede gli ordini in revisione è pronto.",
    );
    // Another agent after the work is a different person and stays.
    expect(links("Il candidato C-55555555 di Sicurezza")).toBe("Il candidato [candidate:C-55555555] di Sicurezza");
  });

  it("writes every target as a link and reads it back", () => {
    const refs = index();
    for (const token of ["#13", "#14", "A-11111111", "C-55555555", "D-1", "G-66666666", "P-22222222", "S2", "S-33333333", "Sources/Orders", "Sources/Orders/CancelPaidOrder.swift", "0123456", "feature/support-review-trama-1a2b3c4d"]) {
      const reference = lookupReference(token, refs)!;
      expect(parseReferenceHref(referenceHref(reference.target))).toEqual(reference.target);
    }
    expect(parseReferenceHref("trama:ref/nothing/x")).toBeNull();
    expect(parseReferenceHref("https://github.com")).toBeNull();
  });

  it("lists the real ids for the Coordinator", () => {
    const listing = referenceListing(index())!;
    expect(listing).toContain("- C-55555555: candidato di Luca");
    expect(listing).toContain("- S2 (piano P-22222222): fetta 2, Il supporto vede gli ordini in revisione");
    expect(listing).toContain("- D-1: decisione «Un ordine pagato annullato va in revisione»");
    const empty = emptyDocument("p");
    empty.team.specialists = [];
    expect(referenceListing(buildReferenceIndex(t, { document: empty, modules: [], github }))).toBeNull();
  });
});

describe("routes of Ask Trama (issue #270)", () => {
  it("names a route by its situation in the message that starts it, with the id on hover", () => {
    const document = emptyDocument("p");
    document.routes = [{ id: "AT-66666666", situation: "Voglio capire chi vede gli ordini", reason: "Serve un chiarimento" } as never];
    const index = buildReferenceIndex(t, { document, modules: [], github: { ...github, issues: [], pullRequestLinks: [], status: "idle" } as GitHubState });
    const text = "Avvia il percorso AT-66666666 di Ask Trama: chiarire.";
    const [before, part] = splitReferences(text, index);
    expect(part).toMatchObject({ text: "AT-66666666", reference: { target: { kind: "route", id: "AT-66666666" } } });
    const reference = (part as { reference: Parameters<typeof referenceText>[0] }).reference;
    expect(referenceText(reference, "AT-66666666", before!.text)).toBe("«Voglio capire chi vede gli ordini»");
    expect(referenceTitle(reference)).toBe("AT-66666666: Serve un chiarimento");
    expect(parseReferenceHref(referenceHref(reference.target))).toEqual({ kind: "route", id: "AT-66666666" });
    expect(unknownReferences("Avvia il percorso AT-77777777", index)).toEqual(["AT-77777777"]);
  });
});

describe("leadingPunctuation", () => {
  it("splits the closing punctuation that follows a reference from the rest of the text", () => {
    expect(leadingPunctuation(", domanda «Il cliente riceve una email?».")).toEqual({ glued: ",", rest: " domanda «Il cliente riceve una email?»." });
    expect(leadingPunctuation(".")).toEqual({ glued: ".", rest: "" });
    expect(leadingPunctuation("»).")).toEqual({ glued: "»).", rest: "" });
  });

  it("leaves a text that does not start with punctuation whole", () => {
    expect(leadingPunctuation(" e poi")).toEqual({ glued: "", rest: " e poi" });
    expect(leadingPunctuation("")).toEqual({ glued: "", rest: "" });
  });
});
