import type { ProviderId } from "./codex";
import type { AgentModelChoice, Specialist } from "./domain";
import type { MessageKey, Translate } from "./i18n";
import { catalogOffers, type CatalogEntry, supportsReadOnly } from "./providers";

const EFFORT_LABELS: Record<string, MessageKey> = {
  minimal: "chat.model.effort.minimal",
  low: "chat.model.effort.low",
  medium: "chat.model.effort.medium",
  high: "chat.model.effort.high",
  xhigh: "chat.model.effort.xhigh",
  max: "chat.model.effort.max",
  ultra: "chat.model.effort.ultra",
  thinking: "chat.model.effort.thinking",
};

/** The effort level's name in the current language; a level Trama does not know keeps the provider's id. */
export const effortLabel = (t: Translate, effort: string): string => (EFFORT_LABELS[effort] ? t(EFFORT_LABELS[effort]) : effort);

/** A provider Trama can run now, with the models its catalogue offers; an empty list means any. */
export interface RunnableProvider {
  id: ProviderId;
  models: readonly CatalogEntry[];
}

/**
 * Where the person's model for an agent stands (issue #455): none chosen, ready for the next assignment, or not usable
 * now because its provider is not connected or its catalogue no longer offers the model. Then the Coordinator's
 * default runs the work.
 */
export type AgentModelState = "none" | "ready" | "providerOff" | "modelGone";

export function agentModelState(choice: AgentModelChoice | null | undefined, providers: readonly RunnableProvider[]): AgentModelState {
  if (!choice) return "none";
  const provider = providers.find((p) => p.id === choice.provider);
  if (!provider) return "providerOff";
  if (provider.models.length && !catalogOffers(choice.provider, provider.models, choice.model)) return "modelGone";
  return "ready";
}

/**
 * The person's model for the agent's next assignment, when it can run that work now: a provider that runs only in a
 * worktree takes no read-only work. Null leaves the choice to the Coordinator.
 */
export function personModel(specialist: Specialist, providers: readonly RunnableProvider[], withEdits: boolean): AgentModelChoice | null {
  const choice = specialist.chosenModel;
  if (!choice || agentModelState(choice, providers) !== "ready") return null;
  return withEdits || supportsReadOnly(choice.provider) ? choice : null;
}
