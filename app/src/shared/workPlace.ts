import type { ProviderAccount, ProviderId } from "./codex";
import type { AssignmentPlace, ProjectDocument, Specialist, SpecialistAssignment, WorkPlace, WorkPlaceSetting } from "./domain";
import type { MessageParams, Translate } from "./i18n";

/**
 * The place of a developer's work (A19, issue #260, ADR 0017): in a worktree on the Mac, or in a cloud session of the
 * provider. The project setting decides, the person moves one assignment, and the cloud is never mandatory: when it
 * cannot be used the work runs locally and the card says why and how to enable it.
 */

/** The providers that offer a cloud session (Q31): Claude Code on the web and Codex Cloud. */
export const CLOUD_PROVIDERS: readonly ProviderId[] = ["claudeAgent", "codex"];

/** The providers whose cloud session Trama starts today: Claude Code on the web. */
export const CLOUD_STARTERS: readonly ProviderId[] = ["claudeAgent"];

export const offersCloud = (provider: ProviderId | null | undefined): boolean => CLOUD_PROVIDERS.includes(provider ?? "codex");

/** The three values of the project's setting, in the order the settings show them. */
export const WORK_PLACE_SETTINGS: readonly WorkPlaceSetting[] = ["automatic", "local", "cloud"];

/** The project's setting: automatic unless the person changed it. */
export function workPlaceSetting(document: Pick<ProjectDocument, "settings">): WorkPlaceSetting {
  const value = document.settings?.workPlace;
  return value === "local" || value === "cloud" ? value : "automatic";
}

export const isWorkPlaceSetting = (value: unknown): value is WorkPlaceSetting => value === "automatic" || value === "local" || value === "cloud";

/**
 * Whether the work may leave the Mac at all (Q24): only a developer that writes code in a slice. The Coordinator, the
 * read-only roles, the fixed roles' automatic work, live trials and the final check stay local.
 */
export function cloudEligible(specialist: Pick<Specialist, "role">, assignment: SpecialistAssignment): boolean {
  return specialist.role === "developer" && !assignment.duty && assignment.tools.includes("edits");
}

/** What the base branch has that GitHub does not: uncommitted files, no branch on GitHub, or commits not pushed. */
export type UnpushedWork = { kind: "dirty" } | { kind: "noUpstream" } | { kind: "ahead"; count: number } | { kind: "unreadable" };

/** What stops the cloud now; each field is null, false or empty when it holds. Read by the main process, judged here. */
export interface CloudConditions {
  /** The GitHub repository of the project, `owner/name`; null when it is not on GitHub. */
  repository: string | null;
  /** The base branch has changes the cloud cannot see; null when it matches GitHub. */
  unpushed: UnpushedWork | null;
  /** Files ignored by git that the project keeps only on the Mac, like `.env`. */
  localOnlyFiles: string[];
  /** The provider's account as Trama last read it. */
  account: ProviderAccount | null;
  /** The mandate does not allow the draft pull request the session opens. */
  mandateRefuses: boolean;
}

const PROVIDER_NAMES: Partial<Record<ProviderId, string>> = { claudeAgent: "Claude", codex: "Codex" };
const nameOf = (provider: ProviderId) => PROVIDER_NAMES[provider] ?? provider;

function unpushedText(t: Translate, unpushed: UnpushedWork): string {
  switch (unpushed.kind) {
    case "dirty":
      return t("workPlace.unpushed.dirty");
    case "noUpstream":
      return t("workPlace.unpushed.noUpstream");
    case "ahead":
      return t("workPlace.unpushed.ahead", { count: unpushed.count });
    default:
      return t("workPlace.unpushed.unreadable");
  }
}

/**
 * Why the cloud cannot run this work now, with the step that enables it; null when it can (Q27). `personAsked` lets
 * the person's own move to the cloud pass the files kept only on the Mac: the person knows whether the session needs them.
 */
export function cloudBlock(t: Translate, provider: ProviderId, conditions: CloudConditions, personAsked = false): { reason: string; enable: string } | null {
  const block = (key: BlockKey, params?: MessageParams) => ({ reason: t(`workPlace.block.${key}`, params), enable: t(`workPlace.block.${key}.enable`) });
  if (!offersCloud(provider)) return block("provider", { provider: nameOf(provider) });
  if (!CLOUD_STARTERS.includes(provider)) return block("codex");
  if (!conditions.repository) return block("github");
  if (conditions.unpushed) return block("unpushed", { detail: unpushedText(t, conditions.unpushed) });
  const account = conditions.account;
  if (account?.kind === "blocked") return block("limit", { provider: nameOf(provider) });
  if (account?.kind !== "authenticated" && account?.kind !== "chatgpt") return block("signedOut", { provider: nameOf(provider) });
  if (conditions.mandateRefuses) return block("mandate");
  if (conditions.localOnlyFiles.length && !personAsked) return block("localFiles", { files: conditions.localOnlyFiles.slice(0, 3).join(", ") });
  return null;
}

type BlockKey = "provider" | "codex" | "github" | "unpushed" | "limit" | "signedOut" | "mandate" | "localFiles" | "localWork";

/** The cloud is not used because the work already has changes in its worktree on the Mac. */
export function localWorkBlock(t: Translate): { reason: string; enable: string } {
  return { reason: t("workPlace.block.localWork"), enable: t("workPlace.block.localWork.enable") };
}

/**
 * The Coordinator's choice by type of work in automatic (Q30): a slice of code goes to the cloud and frees the Mac;
 * a live trial and an urgent fix stay local, where Trama tries them at once.
 */
export function automaticPlace(t: Translate, assignment: SpecialistAssignment): { where: WorkPlace; reason: string } {
  if (assignment.exercise) return { where: "local", reason: t("workPlace.reason.liveTrial") };
  if (assignment.commit?.hotfix) return { where: "local", reason: t("workPlace.reason.hotfix") };
  if (!assignment.slice) return { where: "local", reason: t("workPlace.reason.notSlice") };
  return { where: "cloud", reason: t("workPlace.reason.slice") };
}

/**
 * Where the next start of the work runs (A19). The person's move wins, then the setting; in automatic the Coordinator
 * chooses by type of work. The cloud is used only when nothing blocks it; otherwise the place is local with the reason.
 */
export function chooseWorkPlace(input: {
  t: Translate;
  setting: WorkPlaceSetting;
  provider: ProviderId;
  assignment: SpecialistAssignment;
  conditions: CloudConditions;
  now?: Date;
}): AssignmentPlace {
  const { t } = input;
  const at = (input.now ?? new Date()).toISOString();
  const choice = input.assignment.placeChoice ?? null;
  const local = (chosenBy: AssignmentPlace["chosenBy"], reason: string, cloudBlocked: AssignmentPlace["cloudBlocked"] = null): AssignmentPlace => ({
    where: "local",
    chosenBy,
    reason,
    cloudBlocked,
    at,
  });
  if (choice === "local") return local("person", t("workPlace.reason.personLocal"));
  let wanted: { chosenBy: AssignmentPlace["chosenBy"]; reason: string };
  if (choice === "cloud") {
    wanted = { chosenBy: "person", reason: t("workPlace.reason.personCloud") };
  } else if (input.setting === "local") {
    return local("setting", t("workPlace.reason.alwaysLocal"));
  } else if (input.setting === "cloud") {
    if (!input.assignment.slice) return local("setting", t("workPlace.reason.notSlice"));
    wanted = { chosenBy: "setting", reason: t("workPlace.reason.cloudWhenPossible") };
  } else {
    const automatic = automaticPlace(t, input.assignment);
    if (automatic.where === "local") return local("coordinator", automatic.reason);
    wanted = { chosenBy: "coordinator", reason: automatic.reason };
  }
  const hasLocalWork = Boolean(input.assignment.workspace && !input.assignment.workspaceRemovedAt);
  const blocked = hasLocalWork ? localWorkBlock(t) : cloudBlock(t, input.provider, input.conditions, choice === "cloud");
  if (blocked) return local(wanted.chosenBy, t("workPlace.reason.blocked", { reason: blocked.reason }), blocked);
  return { where: "cloud", chosenBy: wanted.chosenBy, reason: wanted.reason, cloudBlocked: null, at };
}

/** A cloud session still at work, which Trama must not stop on closing or reopening (Q28). */
export const cloudWorking = (assignment: SpecialistAssignment): boolean =>
  assignment.cloud?.status === "starting" || assignment.cloud?.status === "working" || assignment.cloud?.status === "draft";


/** Whether the person can move the work now (Q30): before it starts, or when it waits for a resume. */
export function canMovePlace(assignment: SpecialistAssignment): boolean {
  return ["preparing", "stopped", "failed", "paused"].includes(assignment.status) && !cloudWorking(assignment);
}
