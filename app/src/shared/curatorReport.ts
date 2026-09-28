// What the last upkeep of the learned skills did, told to the person in their language (issue #335). The upkeep keeps
// its own technical summary on disk; the person reads counts and outcomes from the catalogs instead.
import type { Translate } from "./i18n";

export interface CuratorRunView {
  /** A preview: nothing changed, the counts say what a real check would do. */
  dryRun: boolean;
  markedStale: number;
  archived: number;
  reactivated: number;
  /** Skills a model merged into another one. */
  consolidated: number;
  /** Skills a model retired. */
  pruned: number;
  /** The merge with a model failed: the automatic part still ran. */
  consolidationFailed: boolean;
}

/** The report's counts as the view carries them; null when the upkeep never finished a check. */
export function curatorRunView(
  report: {
    dryRun: boolean;
    autoTransitions: { markedStale: number; archived: number; reactivated: number };
    consolidated: unknown[];
    pruned: unknown[];
    llmError: string | null;
  } | null,
): CuratorRunView | null {
  if (!report) return null;
  return {
    dryRun: report.dryRun,
    markedStale: report.autoTransitions.markedStale,
    archived: report.autoTransitions.archived,
    reactivated: report.autoTransitions.reactivated,
    consolidated: report.consolidated.length,
    pruned: report.pruned.length,
    consolidationFailed: report.llmError !== null,
  };
}

/** "2 skill inattive, 1 archiviata", or "nessun cambiamento", with the preview and a failed merge said as such. */
export function curatorRunLine(t: Translate, run: CuratorRunView): string {
  const changes = [
    run.markedStale ? t("memory.curator.stale", { count: run.markedStale }) : null,
    run.archived ? t("memory.curator.archived", { count: run.archived }) : null,
    run.reactivated ? t("memory.curator.reactivated", { count: run.reactivated }) : null,
    run.consolidated ? t("memory.curator.consolidated", { count: run.consolidated }) : null,
    run.pruned ? t("memory.curator.pruned", { count: run.pruned }) : null,
  ].filter((part): part is string => part !== null);
  const outcome = changes.length ? changes.join(", ") : t("memory.curator.noChanges");
  const line = run.dryRun ? t("memory.curator.preview", { outcome }) : outcome;
  return run.consolidationFailed ? t("memory.curator.withFailure", { outcome: line }) : line;
}
