import { randomUUID } from "node:crypto";
import type { FixedBanRefusal, MandateAction, MandateRequest, ProjectDocument, ProjectMandate } from "@shared/domain";
import { type FixedBan, fixedBanInfo } from "@shared/fixedBans";
import { shortId } from "@shared/ids";
import { actionLabel, DELEGABLE_ACTIONS } from "@shared/labels";
import { ITALIAN } from "@shared/i18n";
import type { StoppedWork } from "@shared/mandate";
import { createMandateRequest, DomainError } from "./pact";
import { t } from "./personLanguage";

/**
 * The project mandate (issue #244, ADR 0017): one mandate for the whole cycle of work, asked when a project opens
 * without one, granted once and narrowed at any time. The fixed bans stay outside every mandate (`@shared/fixedBans`).
 */

/** The reason of the project mandate request, in the person's language when Trama asks. */
export const projectMandateReason = () => t("main.projectMandate.reason");

export const projectMandateObjectives = () => [t("main.projectMandate.objective")];

/**
 * Whether Trama asks for the project mandate now: no mandate in force, no request waiting, and the person has not
 * turned a project mandate down since the last mandate ended. A project with no module yet has nothing to cover.
 */
export function needsProjectMandate(document: ProjectDocument, moduleIds: string[]): boolean {
  if (moduleIds.length === 0) return false;
  if (document.mandate?.status === "granted") return false;
  if (document.mandateRequests.some((r) => !r.resolution)) return false;
  const since = document.mandate?.revocation?.revokedAt ?? "";
  // A refusal is the person's answer: Trama does not ask again at every opening, only after a new revocation.
  return !document.mandateRequests.some((r) => r.projectCycle && r.resolution?.kind === "rejected" && r.resolution.resolvedAt >= since);
}

/** Asks for the project mandate on the Coordinator's behalf: every module and every delegable action. */
export function proposeProjectMandate(document: ProjectDocument, moduleIds: string[], now = new Date()): MandateRequest {
  const request = createMandateRequest(
    document,
    {
      requestId: null,
      reason: projectMandateReason(),
      objectives: projectMandateObjectives(),
      priorities: [],
      scopeModuleIds: moduleIds,
      authorizedActions: [...DELEGABLE_ACTIONS],
      limits: [],
    },
    now,
  );
  request.projectCycle = true;
  return request;
}

/**
 * Narrows the mandate in force without revoking it: a new version with fewer modules or actions, the previous one in
 * the history. It cannot widen the mandate: that goes through a proposal or a correction.
 */
export function restrictMandate(
  document: ProjectDocument,
  input: { scopeModuleIds: string[]; authorizedActions: MandateAction[] },
  now = new Date(),
): ProjectMandate {
  const mandate = document.mandate;
  if (mandate?.status !== "granted") throw new DomainError(t("main.projectMandate.noMandateToRestrict"));
  const scopeModuleIds = mandate.scopeModuleIds.filter((id) => input.scopeModuleIds.includes(id));
  const authorizedActions = mandate.authorizedActions.filter((a) => input.authorizedActions.includes(a));
  const added = [...input.scopeModuleIds.filter((id) => !mandate.scopeModuleIds.includes(id)), ...input.authorizedActions.filter((a) => !mandate.authorizedActions.includes(a))];
  if (added.length) throw new DomainError(t("main.projectMandate.restrictionAdds"));
  if (scopeModuleIds.length === 0 || authorizedActions.length === 0) {
    throw new DomainError(t("main.projectMandate.restrictionEmpty"));
  }
  const removedModuleIds = mandate.scopeModuleIds.filter((id) => !scopeModuleIds.includes(id));
  const removedActions = mandate.authorizedActions.filter((a) => !authorizedActions.includes(a));
  if (removedModuleIds.length === 0 && removedActions.length === 0) throw new DomainError(t("main.projectMandate.restrictionNothing"));
  const { status: _status, revocation: _revocation, history, ...snapshot } = mandate;
  const restricted: ProjectMandate = {
    ...snapshot,
    version: mandate.version + 1,
    scopeModuleIds,
    authorizedActions,
    grantedAt: now.toISOString(),
    restriction: { removedModuleIds, removedActions },
    status: "granted",
    revocation: null,
    history: [...history, snapshot],
  };
  document.mandate = restricted;
  return restricted;
}

/** What the Coordinator reads after a restriction, as the person's message: what went, the work it stopped and from when. */
export function restrictionMessage(
  mandate: ProjectMandate,
  moduleName: (id: string) => string = (id) => id,
  stopped: Pick<StoppedWork, "assignment" | "dependsOn">[] = [],
): string {
  const removed = mandate.restriction;
  const parts = [
    removed?.removedModuleIds.length ? t("main.projectMandate.removedModules", { modules: removed.removedModuleIds.map(moduleName).join(", ") }) : null,
    removed?.removedActions.length
      ? t("main.projectMandate.removedActions", { actions: removed.removedActions.map((a) => actionLabel(t, a).toLowerCase()).join(", ") })
      : null,
  ].filter(Boolean);
  const outside = stopped.filter((w) => !w.dependsOn).map((w) => w.assignment.id);
  const dependents = stopped.filter((w) => w.dependsOn).map((w) => t("main.projectMandate.dependsOn", { id: w.assignment.id, dependsOn: w.dependsOn!.id }));
  const halted = stopped.length
    ? t("main.projectMandate.halted", { work: [...outside, ...dependents].join(", ") })
    : t("main.projectMandate.nothingHalted");
  return t("main.projectMandate.restricted", { version: String(mandate.version), parts: parts.join("; "), halted });
}

// MARK: Refusals

/** Records an action a fixed ban stopped; it waits in "Aspetta te" until the person has seen it. */
export function recordFixedBanRefusal(
  document: ProjectDocument,
  input: { ban: FixedBan; action: string; by: FixedBanRefusal["by"] },
  now = new Date(),
): FixedBanRefusal {
  const refusal: FixedBanRefusal = {
    id: shortId("V", randomUUID()),
    ban: input.ban,
    action: input.action.trim().slice(0, 500) || fixedBanInfo(ITALIAN, input.ban).label,
    by: input.by,
    refusedAt: now.toISOString(),
    acknowledgedAt: null,
  };
  document.fixedBanRefusals = [...(document.fixedBanRefusals ?? []), refusal];
  return refusal;
}

/** The person has seen a refused action: it leaves "Aspetta te" and stays in the history. */
export function acknowledgeFixedBanRefusal(document: ProjectDocument, id: string, now = new Date()): FixedBanRefusal {
  const refusal = document.fixedBanRefusals?.find((r) => r.id === id);
  if (!refusal) throw new DomainError(t("main.projectMandate.refusalNotFound"));
  refusal.acknowledgedAt ??= now.toISOString();
  return refusal;
}

/** The activity line of a refusal: which ban, and what was tried. */
export function fixedBanActivity(refusal: FixedBanRefusal) {
  const info = fixedBanInfo(ITALIAN, refusal.ban);
  return {
    type: "activity" as const,
    title: t("main.projectMandate.refusalTitle", { ban: info.label.toLowerCase() }),
    detail: `${refusal.action}\n${t("main.projectMandate.refusalDetail", { reason: info.reason })}`,
    tone: "error" as const,
  };
}
