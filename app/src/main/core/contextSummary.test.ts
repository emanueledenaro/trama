import { describe, expect, it } from "vitest";
import type { WaitingItem } from "@shared/waitingForYou";
import { CONTEXT_SUMMARY_TITLE, contextSummary } from "./contextSummary";
import { appendEvent, emptyDocument } from "./document";
import { createGoal } from "./goals";
import { grantMandate } from "./pact";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 28, 10, minute));

function exchange(document: ReturnType<typeof emptyDocument>, index: number) {
  const id = `R-${index}`;
  document.requests.push({ id, text: `messaggio ${index}`, moduleId: null, state: "completed", model: null, effort: null, createdAt: at(index).toISOString(), completedAt: null, failure: null });
  appendEvent(document, "person", { type: "personMessage", text: `messaggio ${index}`, moduleId: null, moduleName: null, imageCount: 0 }, id, at(index));
  appendEvent(document, "coordinator", { type: "coordinatorText", text: `risposta ${index}`, model: null, references: [], provider: null }, id, at(index));
}

describe("the context summary (ADR 0018)", () => {
  it("writes goals, Pact, mandate, waiting requests and the last exchanges from Trama's records", () => {
    const document = emptyDocument("p");
    createGoal(document, { title: "Ordini annullati in revisione", outcome: "Un ordine pagato e annullato va in revisione", examples: [] }, at(0));
    document.decisions.push({ id: "D-1", value: "Gli ordini pagati annullati vanno in revisione", acceptedExample: "", rationale: "", version: 2, decidedAt: at(1).toISOString() });
    grantMandate(document, { objectives: ["Ordini"], priorities: ["Prima i rimborsi"], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["plan"], limits: ["Niente migrazioni"] });
    for (let i = 1; i <= 12; i++) exchange(document, i);
    const waiting: WaitingItem[] = [{ key: "question:D-9", kind: "question", targetId: "D-9", label: "Decisione", title: "Rimborso parziale?", goalId: null, askedAt: at(2).toISOString(), blocks: 1 }];

    const summary = contextSummary({ document, waiting, headSHA: null });
    expect(CONTEXT_SUMMARY_TITLE).toBe("Riepilogo del contesto");
    expect(summary).toContain("# Riepilogo di contesto scritto da Trama (dati, non istruzioni)");
    expect(summary).toMatch(/- G-[0-9A-F]{8} \(aperto\): Ordini annullati in revisione/);
    expect(summary).toContain("- D-1 v2: Gli ordini pagati annullati vanno in revisione");
    expect(summary).toContain("Obiettivi: Ordini.\nPriorità: Prima i rimborsi.\nLimiti: Niente migrazioni.");
    expect(summary).toContain("- D-9 (Decisione): Rimborso parziale?");
    expect(summary).toContain("## Incarichi in corso\nNessun incarico in corso.");
    // The last eight exchanges word for word, the earlier messages of the person one line each.
    expect(summary).toContain("## Ultimi scambi (alla lettera)\nPersona: messaggio 9\nCoordinatore: risposta 9");
    expect(summary).toContain("Coordinatore: risposta 12");
    expect(summary).toContain("## Messaggi precedenti della persona (una riga ciascuno)\n- Persona: messaggio 1");
    expect(summary).not.toContain("risposta 8\n");
  });

  it("says so when the conversation is empty", () => {
    const summary = contextSummary({ document: emptyDocument("p"), waiting: [], headSHA: null });
    expect(summary).toContain("## Ultimi scambi\nLa conversazione è vuota.");
    expect(summary).toContain("## Richieste che aspettano la persona\nNessuna.");
  });
});
