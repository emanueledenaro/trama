import type { ProviderAccount, ProviderId } from "./codex";
import type { AssignmentPlace, CloudSessionStatus, ProjectDocument, Specialist, SpecialistAssignment, WorkPlace, WorkPlaceSetting } from "./domain";

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

export const WORK_PLACE_OPTIONS: { value: WorkPlaceSetting; label: string; description: string }[] = [
  { value: "automatic", label: "Automatico", description: "Il Coordinatore sceglie per tipo di lavoro e scrive il motivo nella scheda dell'incarico." },
  { value: "local", label: "Sempre in locale", description: "Ogni incarico lavora sul Mac. Nessuna sessione cloud parte." },
  { value: "cloud", label: "Cloud quando possibile", description: "Gli incarichi di sviluppo vanno in cloud quando si può, altrimenti in locale." },
];

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

/** What stops the cloud now; each field is null or empty when it holds. Read by the main process, judged here. */
export interface CloudConditions {
  /** The GitHub repository of the project, `owner/name`; null when it is not on GitHub. */
  repository: string | null;
  /** The base branch has changes the cloud cannot see: uncommitted files or commits not pushed. Null when clean. */
  unpushed: string | null;
  /** Files ignored by git that the project keeps only on the Mac, like `.env`. */
  localOnlyFiles: string[];
  /** The provider's account as Trama last read it. */
  account: ProviderAccount | null;
  /** Why the mandate does not allow the pull request the session opens; null when it does. */
  mandate: string | null;
}

const PROVIDER_NAMES: Partial<Record<ProviderId, string>> = { claudeAgent: "Claude", codex: "Codex" };
const nameOf = (provider: ProviderId) => PROVIDER_NAMES[provider] ?? provider;

/**
 * Why the cloud cannot run this work now, with the step that enables it; null when it can (Q27). `personAsked` lets
 * the person's own move to the cloud pass the files kept only on the Mac: the person knows whether the session needs them.
 */
export function cloudBlock(provider: ProviderId, conditions: CloudConditions, personAsked = false): { reason: string; enable: string } | null {
  if (!offersCloud(provider)) {
    return { reason: `${nameOf(provider)} lavora solo in locale: il cloud c'è con Claude e Codex.`, enable: "Scegli Claude per questo incarico." };
  }
  if (!CLOUD_STARTERS.includes(provider)) {
    return { reason: "Trama non avvia ancora le attività di Codex Cloud.", enable: "Scegli Claude per questo incarico, se vuoi il cloud." };
  }
  if (!conditions.repository) {
    return { reason: "Il progetto non è su GitHub, e la sessione cloud parte dal repository su GitHub.", enable: "Pubblica il progetto su GitHub con il remoto origin, poi riprendi l'incarico." };
  }
  if (conditions.unpushed) {
    return { reason: `Il branch del progetto ha modifiche che GitHub non ha: ${conditions.unpushed}`, enable: "Fai commit e push delle modifiche, poi riprendi l'incarico." };
  }
  const account = conditions.account;
  if (account?.kind === "blocked") {
    return { reason: `${nameOf(provider)} è al limite di utilizzo.`, enable: "Aspetta che il limite passi, poi riprendi l'incarico." };
  }
  if (account?.kind !== "authenticated" && account?.kind !== "chatgpt") {
    return { reason: `${nameOf(provider)} non è collegato.`, enable: "Accedi con `claude login` nel terminale e collega il repository da claude.ai/code, poi aggiorna i collegamenti." };
  }
  if (conditions.mandate) {
    return { reason: `La sessione cloud apre una pull request in bozza. ${conditions.mandate}`, enable: "Concedi nel mandato l'apertura delle pull request." };
  }
  if (conditions.localOnlyFiles.length && !personAsked) {
    const files = conditions.localOnlyFiles.slice(0, 3).join(", ");
    return {
      reason: `Il progetto usa file che stanno solo sul Mac: ${files}.`,
      enable: "Se la sessione non ne ha bisogno, o hai messo i valori nell'ambiente cloud di Claude Code, sposta l'incarico in cloud dalla sua scheda.",
    };
  }
  return null;
}

/**
 * The Coordinator's choice by type of work in automatic (Q30): a slice of code goes to the cloud and frees the Mac;
 * a live trial and an urgent fix stay local, where Trama tries them at once.
 */
export function automaticPlace(assignment: SpecialistAssignment): { where: WorkPlace; reason: string } {
  if (assignment.exercise) return { where: "local", reason: "Il lavoro prevede una prova dal vivo, che si fa sul Mac." };
  if (assignment.commit?.hotfix) return { where: "local", reason: "È una correzione urgente: resta sul Mac per verificarla subito." };
  if (!assignment.slice) return { where: "local", reason: "Il lavoro non è una fetta del piano: in cloud va solo il codice di una fetta." };
  return { where: "cloud", reason: "È una fetta di codice senza prove dal vivo: in cloud libera il Mac e continua anche con Trama chiusa." };
}

/**
 * Where the next start of the work runs (A19). The person's move wins, then the setting; in automatic the Coordinator
 * chooses by type of work. The cloud is used only when nothing blocks it; otherwise the place is local with the reason.
 */
export function chooseWorkPlace(input: {
  setting: WorkPlaceSetting;
  provider: ProviderId;
  assignment: SpecialistAssignment;
  conditions: CloudConditions;
  now?: Date;
}): AssignmentPlace {
  const at = (input.now ?? new Date()).toISOString();
  const choice = input.assignment.placeChoice ?? null;
  const local = (chosenBy: AssignmentPlace["chosenBy"], reason: string, cloudBlocked: AssignmentPlace["cloudBlocked"] = null): AssignmentPlace => ({
    where: "local",
    chosenBy,
    reason,
    cloudBlocked,
    at,
  });
  if (choice === "local") return local("person", "Lo hai spostato tu in locale.");
  let wanted: { chosenBy: AssignmentPlace["chosenBy"]; reason: string };
  if (choice === "cloud") {
    wanted = { chosenBy: "person", reason: "Lo hai spostato tu in cloud." };
  } else if (input.setting === "local") {
    return local("setting", "Il progetto lavora sempre in locale.");
  } else if (input.setting === "cloud") {
    if (!input.assignment.slice) return local("setting", "Il lavoro non è una fetta del piano: in cloud va solo il codice di una fetta.");
    wanted = { chosenBy: "setting", reason: "Il progetto usa il cloud quando possibile." };
  } else {
    const automatic = automaticPlace(input.assignment);
    if (automatic.where === "local") return local("coordinator", automatic.reason);
    wanted = { chosenBy: "coordinator", reason: automatic.reason };
  }
  const blocked = cloudBlock(input.provider, input.conditions, choice === "cloud");
  if (blocked) return local(wanted.chosenBy, `Il cloud non si può usare ora, quindi lavora in locale. ${blocked.reason}`, blocked);
  return { where: "cloud", chosenBy: wanted.chosenBy, reason: wanted.reason, cloudBlocked: null, at };
}

/** A cloud session still at work, which Trama must not stop on closing or reopening (Q28). */
export const cloudWorking = (assignment: SpecialistAssignment): boolean =>
  assignment.cloud?.status === "starting" || assignment.cloud?.status === "working" || assignment.cloud?.status === "draft";

export const CLOUD_STATUS: Record<CloudSessionStatus, { label: string; tone: "info" | "success" | "warning" | "destructive" | "secondary" }> = {
  starting: { label: "In avvio", tone: "info" },
  working: { label: "Al lavoro", tone: "info" },
  draft: { label: "Pull request in bozza aperta", tone: "info" },
  returned: { label: "Tornata sul Mac", tone: "success" },
  stopped: { label: "Fermata in Trama", tone: "secondary" },
  failed: { label: "Non riuscita", tone: "destructive" },
};

/** Whether the person can move the work now (Q30): before it starts, or when it waits for a resume. */
export function canMovePlace(assignment: SpecialistAssignment): boolean {
  return ["preparing", "stopped", "failed", "paused"].includes(assignment.status) && !cloudWorking(assignment);
}
