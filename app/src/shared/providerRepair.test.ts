import { describe, expect, it } from "vitest";
import type { ProviderRepairStep } from "./codex";
import { classifyProviderFailure } from "./providerFailure";
import { REPAIRABLE_CLIS, repairActivity, repairGaveUpMessage } from "./providerRepair";

const cli = REPAIRABLE_CLIS.antigravity!;
const repaired: ProviderRepairStep[] = [
  { action: "updateCli", outcome: "done", detail: "1.2.12" },
  { action: "reinstallPlugin", outcome: "done", detail: null },
  { action: "checkHook", outcome: "done", detail: null },
];

describe("automatic repair of a provider's CLI", () => {
  it("records in Activity what Trama did and that it runs the turn again", () => {
    expect(repairActivity("it", cli, { steps: repaired, repaired: true, retrying: true })).toEqual({
      title: "Trama ha riparato Antigravity CLI",
      detail:
        "Aggiornato con agy update: ora è la versione 1.2.12.\nPlugin di Trama reinstallato con agy plugin install.\nL'hook di Trama risponde come deve.\nTrama riprova il turno una volta.",
      tone: "info",
    });
    expect(repairActivity("en", cli, { steps: repaired, repaired: true, retrying: true })).toEqual({
      title: "Trama repaired Antigravity CLI",
      detail:
        "Updated with agy update: it is now version 1.2.12.\nTrama's plugin reinstalled with agy plugin install.\nTrama's hook answers as it should.\nTrama runs the turn again, once.",
      tone: "info",
    });
  });

  it("marks a failed repair as an error and does not promise another try", () => {
    const failed: ProviderRepairStep[] = [{ action: "reinstallPlugin", outcome: "failed", detail: "EACCES" }];
    expect(repairActivity("it", cli, { steps: failed, repaired: false, retrying: false })).toEqual({
      title: "Trama non è riuscito a riparare Antigravity CLI",
      detail: "Il plugin di Trama non si è reinstallato: EACCES.",
      tone: "error",
    });
  });

  it("reaches the person whole, as the explanation of the failed turn", () => {
    for (const language of ["it", "en"] as const) {
      const message = repairGaveUpMessage(language, cli, "notCalled", repaired);
      const failure = classifyProviderFailure(message, { provider: "Antigravity" });
      expect(failure.kind).toBe("unknown");
      expect(failure.explanation).toBe(message);
    }
  });
});
