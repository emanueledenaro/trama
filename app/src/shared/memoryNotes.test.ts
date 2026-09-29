import { describe, expect, it } from "vitest";
import { nearlyFull, noteLanguage, tidyFocus } from "./memoryNotes";

describe("noteLanguage", () => {
  it("tells Italian notes from English ones, as in the profile of the negozio project", () => {
    expect(noteLanguage("La persona (Emanuele Denaro, titolare di MondoPet) chiede spiegazioni in italiano semplice: frasi brevi, pochi termini tecnici, un passaggio alla volta, esempi concreti. Vale anche per i piani.")).toBe("it");
    expect(noteLanguage("Si è spazientito quando il Coordinatore ha girato in tondo su blocchi tecnici per ore: vuole meno giri e messaggi più corti.")).toBe("it");
    expect(noteLanguage("Before risky work (e.g. branch realignment/merge conflicts), user wants the steps proposed first and waits to say \"sì\" before anything changes, even if the mandate already covers it.")).toBe("en");
    expect(noteLanguage("negozio (MondoPet): Revisori often exceed the 2-min wait; review keeps running in background, don't rerun immediately.")).toBe("en");
  });

  it("leaves out code in backticks and says nothing when too few words tell", () => {
    expect(noteLanguage("negozio verifica: node_typecheck needs npm script `typecheck`; plain `tsc --noEmit` fails in Trama sandbox (can't write tsconfig.tsbuildinfo), use `tsc --noEmit --incremental false`.")).toBe("en");
    expect(noteLanguage("`pnpm install --frozen-lockfile`")).toBeNull();
    expect(noteLanguage("src/payments.ts, src/orders.ts")).toBeNull();
    expect(noteLanguage("Il catalogo si aggiorna di notte")).toBe("it");
    expect(noteLanguage("Dell'ordine l'importo")).toBe("it");
  });
});

describe("nearlyFull", () => {
  it("is true from 90% of the limit", () => {
    expect(nearlyFull({ chars: 1283, limit: 1375 })).toBe(true);
    expect(nearlyFull({ chars: 674, limit: 2200 })).toBe(false);
    expect(nearlyFull({ chars: 0, limit: 0 })).toBe(false);
  });
});

describe("tidyFocus", () => {
  it("gives the review the entries as they are and asks for one batch in the person's language", () => {
    const focus = tidyFocus("user", { entries: ["Parla italiano", "Wants short answers"], chars: 1283, limit: 1375 }, "it");
    expect(focus).toContain("the person's profile (USER.md)");
    expect(focus).toContain("1283 of 1375 characters");
    expect(focus).toContain("Parla italiano\n§\nWants short answers");
    expect(focus).toContain("ONE memory call on target 'user'");
    expect(focus).toContain("in Italian, the person's language");
  });
});
