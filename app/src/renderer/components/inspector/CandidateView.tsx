import { candidateGoalId, exampleChecks, findGoal } from "@shared/goals";
import { CandidateCard } from "@/components/chat/Cards";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { act, useUi } from "@/lib/store";
import { EmptyNote, InspectorSection } from "./Inspector";
import { Sep } from "@/components/ui/sep";

function lineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff --git") || line.startsWith("index ")) return "text-muted-foreground";
  if (line.startsWith("@@")) return "text-[var(--color-text-accent)]";
  if (line.startsWith("+")) return "bg-success/10 text-foreground";
  if (line.startsWith("-")) return "bg-destructive/10 text-foreground";
  return "text-foreground/80";
}

/**
 * The goal's examples next to the evidence of this exact snapshot (UX06). The person marks what they
 * observed; an observation of another snapshot or of an earlier example text is shown as historical.
 */
function GoalExamplesSection({ candidateId }: { candidateId: string }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const candidate = project.document.candidates.find((c) => c.id === candidateId);
  if (!candidate) return null;
  const goal = findGoal(project.document, candidateGoalId(project.document, candidate));
  if (!goal) {
    return (
      <InspectorSection title="Esempi dell'obiettivo">
        <EmptyNote>Questo candidato non è collegato a un obiettivo: non ci sono esempi concordati da confrontare.</EmptyNote>
      </InspectorSection>
    );
  }
  const checks = exampleChecks(candidate, goal);
  const passed = Object.values(candidate.evidence).filter((e) => e.result === "pass" && e.snapshotId === candidate.snapshotId).length;
  return (
    <InspectorSection title={`Esempi dell'obiettivo, versione ${candidate.snapshotId.slice(0, 12)}`}>
      <button type="button" className="mb-1.5 text-left text-ui-sm text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "goal", id: goal.id })}>
        {goal.title}
      </button>
      <p className="mb-2 text-ui-sm text-muted-foreground">
        Verifiche superate su questa versione: {passed} di {candidate.requiredChecks.length}. Le verifiche non provano gli esempi: segna tu cosa hai osservato provando questa
        versione.
      </p>
      {checks.length === 0 ? <EmptyNote>L'obiettivo non ha esempi definiti.</EmptyNote> : null}
      <ul className="space-y-2">
        {checks.map(({ example, current, stale }) => (
          <li key={example.id} className="rounded-lg border border-[color:var(--color-border)] px-2.5 py-2" data-testid="example-check">
            <div className="flex items-start gap-2 text-ui">
              <Badge tone={example.kind === "accepted" ? "success" : "destructive"} className="mt-0.5">
                {example.kind === "accepted" ? "Deve succedere" : "Non deve succedere"}
              </Badge>
              <span className="min-w-0 flex-1 text-foreground/90">{example.text}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-ui-sm">
              {current ? (
                <span className={current.observed ? "text-success" : "text-destructive"}>
                  {current.observed ? "Osservato" : "Non osservato"} su questa versione<Sep />{formatRelativeTime(current.at)}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Non verificato su questa versione
                  {stale ? `, in precedenza ${stale.observed ? "osservato" : "non osservato"} su un'altra versione o un altro testo` : ""}
                </span>
              )}
              <span className="ml-auto flex gap-1">
                <Button
                  size="xs"
                  variant={current?.observed === true ? "outline" : "ghost"}
                  onClick={() => void act("candidate:observeExample", { candidateId, exampleId: example.id, observed: true, snapshotId: candidate.snapshotId })}
                >
                  Osservato
                </Button>
                <Button
                  size="xs"
                  variant={current?.observed === false ? "outline" : "ghost"}
                  onClick={() => void act("candidate:observeExample", { candidateId, exampleId: example.id, observed: false, snapshotId: candidate.snapshotId })}
                >
                  Non osservato
                </Button>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </InspectorSection>
  );
}

export function CandidateView({ id }: { id: string }) {
  const candidate = useUi((s) => s.app?.project?.document.candidates.find((c) => c.id === id));
  if (!candidate) return <div className="p-4"><EmptyNote>Candidato non trovato.</EmptyNote></div>;
  return (
    <>
      <div className="px-4">
        <CandidateCard candidateId={id} />
      </div>
      <GoalExamplesSection candidateId={id} />
      <InspectorSection title={`Diff catturato da Trama, ${candidate.changedFiles.length} file`}>
        <pre className="overflow-x-auto rounded-xl bg-[var(--app-chat-code-surface)] py-2 font-mono text-[11px] leading-[1.55]">
          {candidate.diff.split("\n").map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: diff lines have no identity beyond their position.
            <div key={index} className={cn("px-3 whitespace-pre", lineClass(line))}>
              {line || " "}
            </div>
          ))}
        </pre>
      </InspectorSection>
    </>
  );
}
