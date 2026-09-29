/**
 * What the person reads when a memory write is refused (issue #305). The store answers the model in its original
 * English, word for word (ADR 0014); Trama's own paths read only the stable code and say it in the person's language.
 */
import { formatNumber } from "@shared/i18n";
import { personLanguage, t } from "../personLanguage";
import type { JsonRecord, MemoryTarget } from "./memoryStore";

const format = (n: number) => formatNumber(personLanguage(), n);

/** The code of a refused memory result, or null when the result succeeded. */
export function memoryErrorCode(result: JsonRecord): string | null {
  if (result.success !== false) return null;
  return typeof result.code === "string" ? result.code : "unknown";
}

/** The toast of the person's own edit or approval: one line in the person's language, never the model's text. */
export function memoryFailureLine(result: JsonRecord, target: MemoryTarget, size: { chars: number; limit: number }): string {
  switch (memoryErrorCode(result)) {
    case "memory_full":
      return t(target === "user" ? "main.memory.userFull" : "main.memory.projectFull", { chars: format(size.chars), limit: format(size.limit) });
    case "no_match":
      return t("main.memory.noMatch");
    case "ambiguous":
      return t("main.memory.ambiguous");
    case "drift":
      return t("main.memory.drift");
    case "unreadable":
      return t("main.memory.unreadable");
    case "threat":
      return t("main.memory.threat");
    case "disabled":
      return t("main.memory.disabled");
    case "stale_proposal":
      return t("main.memory.staleProposal");
    case "unknown_proposal":
      return t("main.memory.unknownProposal");
    default:
      return t("main.memory.notUpdated");
  }
}

/** The Activity line of the Coordinator's refused memory write: short, in the person's language, with the error tone. */
export function memoryActivityLine(result: JsonRecord): string {
  switch (memoryErrorCode(result)) {
    case "memory_full":
      return t("main.memory.activity.full");
    case "no_match":
      return t("main.memory.activity.noMatch");
    case "ambiguous":
      return t("main.memory.activity.ambiguous");
    case "drift":
      return t("main.memory.activity.drift");
    case "unreadable":
      return t("main.memory.activity.unreadable");
    case "threat":
      return t("main.memory.activity.threat");
    case "too_many_failures":
      return t("main.memory.activity.tooManyFailures");
    case "disabled":
      return t("main.memory.activity.disabled");
    default:
      return t("main.memory.activity.notUpdated");
  }
}
