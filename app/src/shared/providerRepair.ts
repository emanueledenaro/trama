// The texts of a repair Trama runs by itself on a provider's CLI (its version, Trama's plugin and hook), in the
// person's language: the entry in Activity and the one message left for the person when the repair fails.
import type { ProviderId, ProviderRepairStep } from "./codex";
import { type Language, type MessageKey, translate } from "./i18n";

/** A CLI Trama can repair, with the commands it runs, named in the texts so the person can run the same one. */
export interface RepairableCli {
  name: string;
  update: string;
  pluginInstall: string;
}

export const REPAIRABLE_CLIS: Partial<Record<ProviderId, RepairableCli>> = {
  antigravity: { name: "Antigravity CLI", update: "agy update", pluginInstall: "agy plugin install" },
};

const STEP_KEYS: Record<ProviderRepairStep["action"], Partial<Record<ProviderRepairStep["outcome"], MessageKey>>> = {
  updateCli: { done: "providerRepair.updateCli.done", failed: "providerRepair.updateCli.failed", notNeeded: "providerRepair.updateCli.notNeeded" },
  reinstallPlugin: { done: "providerRepair.reinstallPlugin.done", failed: "providerRepair.reinstallPlugin.failed" },
  checkHook: { done: "providerRepair.checkHook.done", failed: "providerRepair.checkHook.failed" },
};

/** One sentence per step, in the order Trama ran them. */
export function repairStepTexts(language: Language, cli: RepairableCli, steps: readonly ProviderRepairStep[]): string[] {
  return steps.flatMap((step) => {
    const key = STEP_KEYS[step.action][step.outcome];
    if (!key) return [];
    const command = step.action === "updateCli" ? cli.update : cli.pluginInstall;
    const text = translate(language, key, { command, detail: step.detail?.trim() || "?" }).trim();
    return [/[.!?]$/.test(text) ? text : `${text}.`];
  });
}

/** The entry Trama records in Activity after a repair. */
export function repairActivity(
  language: Language,
  cli: RepairableCli,
  event: { steps: readonly ProviderRepairStep[]; repaired: boolean; retrying: boolean },
): { title: string; detail: string; tone: "info" | "error" } {
  const lines = repairStepTexts(language, cli, event.steps);
  if (event.retrying) lines.push(translate(language, "providerRepair.retry"));
  return {
    title: translate(language, event.repaired ? "providerRepair.title" : "providerRepair.failedTitle", { cli: cli.name }),
    detail: lines.join("\n"),
    tone: event.repaired ? "info" : "error",
  };
}

/** The one thing left for the person: the update when that is what failed, otherwise a clean install. */
export function repairAction(language: Language, cli: RepairableCli, steps: readonly ProviderRepairStep[]): string {
  const updateFailed = steps.some((step) => step.action === "updateCli" && step.outcome === "failed");
  return updateFailed
    ? translate(language, "providerRepair.action.update", { cli: cli.name, command: cli.update })
    : translate(language, "providerRepair.action.reinstall", { cli: cli.name });
}

/** The account message when the CLI is older than Trama needs and the update Trama ran did not fix it. */
export function repairOutdatedMessage(
  language: Language,
  cli: RepairableCli,
  version: string,
  minimum: string,
  steps: readonly ProviderRepairStep[],
): string {
  return translate(language, "providerRepair.outdated", {
    cli: cli.name,
    version,
    minimum,
    command: cli.update,
    steps: repairStepTexts(language, cli, steps).join(" "),
  });
}

/** The message a turn ends with when the repair did not bring the hook back. */
export function repairGaveUpMessage(
  language: Language,
  cli: RepairableCli,
  problem: "notCalled" | "notReady",
  steps: readonly ProviderRepairStep[],
): string {
  return translate(language, "providerRepair.gaveUp", {
    problem: translate(language, problem === "notCalled" ? "providerRepair.problem.notCalled" : "providerRepair.problem.notReady", { cli: cli.name }),
    steps: repairStepTexts(language, cli, steps).join(" "),
    action: repairAction(language, cli, steps),
  });
}
