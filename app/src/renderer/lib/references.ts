import type { ActiveProjectState } from "@shared/domain";
import { DEFAULT_LANGUAGE, type Language, translator } from "@shared/i18n";
import { buildReferenceIndex, lookupReference, type Reference, type ReferenceIndex, type ReferenceTarget } from "@shared/references";
import { revealCard } from "./nextStep";
import { useUi } from "./store";

let last: { document: unknown; snapshot: unknown; github: unknown; language: Language; index: ReferenceIndex } | null = null;
let stable: { key: string; index: ReferenceIndex } | null = null;

// The files come from one scan: its time and size stand for thousands of paths.
const fingerprint = (index: ReferenceIndex, project: ActiveProjectState, language: Language) =>
  JSON.stringify([
    language,
    [project.snapshot.rootPath, project.snapshot.scannedAt, project.snapshot.totalFileCount],
    index.githubReady,
    [...index.ids.values()].map((r) => [r.id, r.label, r.detail]),
    [...index.issues.values()].map((r) => [r.id, r.target.kind, r.detail, r.url]),
    [...index.slices.values()].map((r) => [r.id, r.label, r.target]),
    [...index.names.keys()],
    [...index.branches.keys()],
    index.commits.map((c) => c.sha),
  ]);

/**
 * The references of the open project (issue #277). Built once per state change and kept the same object while
 * the references do not change, so the messages already on screen are not parsed again at every streamed word.
 */
export function referenceIndexOf(project: ActiveProjectState | null | undefined, language: Language): ReferenceIndex | null {
  if (!project) return null;
  if (last && last.document === project.document && last.snapshot === project.snapshot && last.github === project.github && last.language === language) return last.index;
  const built = buildReferenceIndex(translator(language), { document: project.document, modules: project.snapshot.modules, github: project.github });
  const key = fingerprint(built, project, language);
  const index = stable?.key === key ? stable.index : built;
  stable = { key, index };
  last = { document: project.document, snapshot: project.snapshot, github: project.github, language, index };
  return index;
}

export const useReferenceIndex = () => useUi((s) => referenceIndexOf(s.app?.project, s.app?.language ?? DEFAULT_LANGUAGE));

/** The record an id names, to show its name instead of the id (issue #270); null while nothing names it. */
export function useRecord(id: string | null | undefined): Reference | null {
  const index = useReferenceIndex();
  return id && index ? lookupReference(id, index) : null;
}

/** A name as the start of a title: "candidato di Ada" becomes "Candidato di Ada". */
export const asTitle = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Opens what a reference names inside Trama: its panel in the inspector, or its card in the dialog (issue #277). */
export function openReference(target: ReferenceTarget): void {
  const { setInspector } = useUi.getState();
  switch (target.kind) {
    case "issue":
      return setInspector({ kind: "issue", number: target.number });
    case "pullRequest":
      return setInspector({ kind: "pullRequest", number: target.number });
    case "commit":
      return setInspector({ kind: "commit", sha: target.sha });
    case "branch":
      return setInspector({ kind: "branch", name: target.name });
    case "assignment":
      // The work's card shows its state and its actions; outside this dialog the developer's panel lists it.
      if (revealCard(target.id)) return;
      return setInspector({ kind: "specialist", id: target.specialistId });
    case "candidate":
      return setInspector({ kind: "candidate", id: target.id });
    case "review":
      return setInspector({ kind: "candidate", id: target.candidateId });
    case "audit":
      return setInspector({ kind: "audit", id: target.id });
    case "decision":
      return setInspector({ kind: "decision", id: target.id });
    case "question":
      if (revealCard(target.id)) return;
      return setInspector({ kind: "pact" });
    case "mandate":
      return setInspector({ kind: "mandate" });
    case "plan":
      if (revealCard(target.id)) return;
      return setInspector({ kind: "work" });
    case "slice":
      if (revealCard(target.planId)) return;
      return setInspector({ kind: "work" });
    case "goal":
      return setInspector({ kind: "goal", id: target.id });
    case "route": {
      // The route's card in the dialog; while it waits for the person, its item in Aspetta te.
      if (revealCard(target.id)) return;
      const item = (useUi.getState().app?.project?.waiting ?? []).find((i) => i.targetId === target.id);
      return setInspector(item ? { kind: "waiting", key: item.key } : { kind: "waiting" });
    }
    case "specialist":
      return setInspector({ kind: "specialist", id: target.id });
    case "module":
      return setInspector({ kind: "module", id: target.id });
    case "file":
      return setInspector({ kind: "file", path: target.path });
  }
}
