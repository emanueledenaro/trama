import { IconArchive, IconArrowLeft, IconMessageCircle, IconPlus, IconTarget, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import type { GoalExample, GoalStatus, ProjectGoal } from "@shared/domain";
import { GOAL_STATUS_LABELS, findGoal, goalDialogIsEmpty, goalLinks, goalWorkSummary, isArchived, projectGoals } from "@shared/goals";
import type { GoalExampleInputPayload } from "@shared/ipc";
import { PROVIDERS } from "@shared/providers";
import { ASSIGNMENT_STATUS, CANDIDATE_STATE } from "@/components/chat/Cards";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Badge, Input, Label, TextArea } from "@/components/ui/field";
import { PickerSelect } from "@/components/ui/picker";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { act, useUi } from "@/lib/store";
import { EmptyNote, InspectorSection } from "./Inspector";
import { Sep } from "@/components/ui/sep";
import { AgentName } from "@/components/AgentIdentity";

const STATUS_TONE: Record<GoalStatus, "warning" | "info" | "success" | "secondary"> = {
  proposed: "warning",
  open: "info",
  achieved: "success",
  abandoned: "secondary",
};

export function GoalStatusBadge({ status }: { status: GoalStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{GOAL_STATUS_LABELS[status]}</Badge>;
}

/** The status of a goal, and whether the person archived it: archiving keeps the status (W03). */
function GoalBadges({ goal }: { goal: ProjectGoal }) {
  return (
    <>
      <GoalStatusBadge status={goal.status} />
      {isArchived(goal) ? <Badge tone="outline">Archiviato</Badge> : null}
    </>
  );
}

/** Archives or restores a goal; the toast says where an archived goal went. */
export function setArchived(goal: ProjectGoal, archived: boolean) {
  void act("goal:archive", { id: goal.id, archived }).then((id) => {
    if (!id) return;
    useUi.getState().setToast(archived ? "Obiettivo archiviato. Lo ritrovi tra gli obiettivi archiviati." : "Obiettivo ripristinato.", "info");
  });
}

/**
 * Confirms the deletion of an empty goal dialog (W03). Only a dialog without history can be deleted: the
 * main process checks it again, so a message sent meanwhile keeps the goal.
 */
export function DeleteGoalDialog({ goal, onClose }: { goal: ProjectGoal | null; onClose: () => void }) {
  const inspector = useUi((s) => s.inspector);
  const setInspector = useUi((s) => s.setInspector);
  return (
    <Dialog
      open={goal !== null}
      onOpenChange={(open) => (open ? null : onClose())}
      title="Eliminare il dialogo vuoto?"
      description="Il dialogo non ha messaggi, domande, decisioni né lavoro. Eliminarlo toglie anche l'obiettivo e non si può annullare."
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Annulla
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              if (!goal) return;
              void act("goal:delete", { id: goal.id }).then(() => {
                if (inspector?.kind === "goal" && inspector.id === goal.id) setInspector({ kind: "goals" });
                onClose();
              });
            }}
          >
            Elimina il dialogo
          </Button>
        </>
      }
    >
      {goal ? <p className="pt-1 text-ui text-foreground/90">{goal.title}</p> : null}
    </Dialog>
  );
}

const providerName = (id: string | undefined) => PROVIDERS.find((p) => p.id === (id ?? "codex"))?.name ?? id ?? "Codex";

/** Title, desired outcome and examples of a goal, validated again by the main process. */
export function GoalEditor({ goal, onDone }: { goal?: ProjectGoal; onDone: (id: string | null) => void }) {
  const [title, setTitle] = useState(goal?.title ?? "");
  const [outcome, setOutcome] = useState(goal?.outcome ?? "");
  const [examples, setExamples] = useState<GoalExampleInputPayload[]>(
    goal?.examples.map((e) => ({ id: e.id, kind: e.kind, text: e.text })) ?? [{ kind: "accepted", text: "" }],
  );
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const valid = title.trim() && outcome.trim();
  const update = (index: number, change: Partial<GoalExampleInputPayload>) =>
    setExamples((current) => current.map((e, i) => (i === index ? { ...e, ...change } : e)));
  // The main process answers only after the goal is saved; on a refusal the form keeps what the person wrote.
  const save = async () => {
    setSaving(true);
    setFailed(false);
    const payload = { title, outcome, examples: examples.filter((e) => e.text.trim()) };
    const id = goal ? await act("goal:update", { id: goal.id, ...payload }) : await act("goal:create", payload);
    setSaving(false);
    if (id) onDone(id);
    else setFailed(true);
  };
  return (
    <div className="space-y-2.5 rounded-xl border border-[color:var(--color-border)] p-3" data-testid="goal-editor">
      <div>
        <Label>Titolo</Label>
        <Input aria-label="Titolo dell'obiettivo" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Cosa vuoi ottenere" maxLength={200} />
      </div>
      <div>
        <Label>Risultato atteso</Label>
        <TextArea
          aria-label="Risultato atteso"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          placeholder="Come ti accorgi che l'obiettivo è raggiunto"
        />
      </div>
      <div>
        <Label>Esempi verificabili</Label>
        <div className="space-y-1.5">
          {examples.map((example, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: new examples have no id until saved.
            <div key={example.id ?? `new-${index}`} className="flex items-center gap-1.5">
              <PickerSelect
                label="Tipo di esempio"
                value={example.kind}
                options={[
                  { value: "accepted", title: "Deve succedere" },
                  { value: "refused", title: "Non deve succedere" },
                ]}
                onChange={(kind) => update(index, { kind })}
                className="h-8 shrink-0"
              />
              <Input
                aria-label={`Esempio ${index + 1}`}
                value={example.text}
                onChange={(e) => update(index, { text: e.target.value })}
                placeholder="Un caso concreto"
              />
              <button
                type="button"
                aria-label="Togli l'esempio"
                className="sidebar-icon-button size-6 shrink-0 rounded-md"
                onClick={() => setExamples((current) => current.filter((_, i) => i !== index))}
              >
                <IconTrash className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
        <Button size="xs" variant="ghost" className="mt-1" onClick={() => setExamples((current) => [...current, { kind: "accepted", text: "" }])}>
          <IconPlus /> Aggiungi un esempio
        </Button>
      </div>
      <div className="cta-row">
        <Button size="sm" disabled={!valid || saving} onClick={() => void save()}>
          {goal ? "Salva l'obiettivo" : "Crea l'obiettivo"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDone(null)}>
          Annulla
        </Button>
      </div>
      {failed ? (
        <p role="alert" className="text-ui-sm text-warning">
          L'obiettivo non è stato salvato. Il testo resta qui: correggilo o riprova.
        </p>
      ) : null}
      <p className="text-ui-xs text-muted-foreground">Creare un obiettivo non concede un mandato e non avvia specialisti.</p>
    </div>
  );
}

export function GoalsView({ create }: { create?: boolean }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const openDialog = useUi((s) => s.openDialog);
  const [editing, setEditing] = useState(Boolean(create));
  const goals = projectGoals(project.document);
  // Archived goals get their own group at the end, whatever their status (W03).
  const groups: { title: string; items: ProjectGoal[] }[] = [
    { title: "Proposti dal Coordinatore", items: goals.filter((g) => !isArchived(g) && g.status === "proposed") },
    { title: "Aperti", items: goals.filter((g) => !isArchived(g) && g.status === "open") },
    { title: "Chiusi", items: goals.filter((g) => !isArchived(g) && (g.status === "achieved" || g.status === "abandoned")) },
    { title: "Archiviati", items: goals.filter(isArchived) },
  ];
  return (
    <>
      <InspectorSection
        title="Obiettivi del progetto"
        aside={
          !editing ? (
            <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
              <IconPlus /> Nuovo obiettivo
            </Button>
          ) : null
        }
      >
        <p className="text-ui-sm text-muted-foreground">
          Un obiettivo descrive un risultato ed esempi verificabili. Ha un dialogo proprio con il Coordinatore; mandato e decisioni restano quelli del progetto.
        </p>
        {editing ? (
          <div className="mt-2">
            <GoalEditor
              onDone={(id) => {
                setEditing(false);
                if (id) {
                  openDialog(id);
                  setInspector({ kind: "goal", id });
                }
              }}
            />
          </div>
        ) : null}
        {goals.length === 0 && !editing ? <p className="mt-2 text-ui text-muted-foreground/70">Nessun obiettivo. La conversazione precedente resta nel dialogo del progetto.</p> : null}
      </InspectorSection>
      {groups.map(({ title, items }) => {
        if (!items.length) return null;
        return (
          <InspectorSection key={title} title={`${title} (${items.length})`}>
            <div className="-mx-2 flex flex-col gap-0.5">
              {items.map((goal) => (
                <button
                  key={goal.id}
                  type="button"
                  onClick={() => setInspector({ kind: "goal", id: goal.id })}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--sidebar-accent)]"
                >
                  <IconTarget className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-ui text-foreground">{goal.title}</span>
                    <span className="block truncate text-ui-sm text-muted-foreground">
                      {isArchived(goal) ? (
                        <>
                          {GOAL_STATUS_LABELS[goal.status]}
                          <Sep />
                        </>
                      ) : null}
                      {goal.examples.length ? `${goal.examples.length} ${goal.examples.length === 1 ? "esempio" : "esempi"}` : "esempi da definire"}<Sep />{goalWorkSummary(project.document, goal.id)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </InspectorSection>
        );
      })}
    </>
  );
}

function ExampleList({ examples }: { examples: GoalExample[] }) {
  if (!examples.length) {
    return <EmptyNote>Esempi da definire: senza esempi il risultato non si può confrontare con quanto concordato.</EmptyNote>;
  }
  return (
    <ul className="space-y-1">
      {examples.map((example) => (
        <li key={example.id} className="flex items-start gap-2 text-ui">
          <Badge tone={example.kind === "accepted" ? "success" : "destructive"} className="mt-0.5">
            {example.kind === "accepted" ? "Sì" : "No"}
          </Badge>
          <span className="text-foreground/90">{example.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function GoalView({ id }: { id: string }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const openDialog = useUi((s) => s.openDialog);
  const dialogGoalId = useUi((s) => s.dialogGoalId);
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState("");
  const [deleting, setDeleting] = useState<ProjectGoal | null>(null);
  const document = project.document;
  const goal = findGoal(document, id);
  if (!goal) return <div className="p-4"><EmptyNote>Obiettivo non trovato.</EmptyNote></div>;
  const links = goalLinks(document, goal.id);
  const linkable = document.decisions.filter((d) => !goal.decisionIds.includes(d.id));
  const setStatus = (status: GoalStatus) => void act("goal:update", { id: goal.id, status });
  const archived = isArchived(goal);
  const empty = goalDialogIsEmpty(document, goal.id);
  return (
    <>
      <div className="px-4 pt-3">
        <button type="button" className="inline-flex items-center gap-1 text-ui-sm text-muted-foreground hover:text-foreground" onClick={() => setInspector({ kind: "goals" })}>
          <IconArrowLeft className="size-3.5" /> Tutti gli obiettivi
        </button>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 text-ui-lg font-medium text-foreground">{goal.title}</h3>
          <GoalBadges goal={goal} />
        </div>
        <p className="mt-0.5 text-ui-xs text-muted-foreground">
          <span className="font-mono">{goal.id}</span><Sep />{goal.origin === "person" ? "creato da te" : "proposto dal Coordinatore"}<Sep />{formatRelativeTime(goal.createdAt)}
          {goal.archivedAt ? (
            <>
              <Sep />archiviato {formatRelativeTime(goal.archivedAt)}
            </>
          ) : null}
        </p>
        {archived ? (
          <p className="mt-2 text-ui-sm text-muted-foreground">
            L'obiettivo è fuori dalla barra laterale e dalla panoramica. Stato, decisioni e cronologia restano; ripristinalo per riprendere il lavoro.
          </p>
        ) : null}
        <div className="cta-row mt-3">
          <Button size="sm" variant={dialogGoalId === goal.id ? "ghost" : "outline"} disabled={dialogGoalId === goal.id} onClick={() => openDialog(goal.id)}>
            <IconMessageCircle /> {dialogGoalId === goal.id ? "Dialogo aperto" : "Apri il dialogo"}
          </Button>
          {empty ? (
            <Button size="sm" variant="ghost" onClick={() => setDeleting(goal)}>
              <IconTrash /> Elimina
            </Button>
          ) : null}
          {archived ? null : (
            <Button size="sm" variant="ghost" onClick={() => setArchived(goal, true)}>
              <IconArchive /> Archivia
            </Button>
          )}
          {archived ? (
            <Button size="sm" onClick={() => setArchived(goal, false)}>
              Ripristina
            </Button>
          ) : goal.status === "proposed" ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setStatus("abandoned")}>
                Scarta
              </Button>
              <Button size="sm" onClick={() => setStatus("open")}>
                Conferma l'obiettivo
              </Button>
            </>
          ) : goal.status === "open" ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setStatus("achieved")}>
                Segna come raggiunto
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setStatus("abandoned")}>
                Abbandona
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setStatus("open")}>
              Riapri
            </Button>
          )}
        </div>
        <DeleteGoalDialog goal={deleting} onClose={() => setDeleting(null)} />
      </div>
      <InspectorSection title="Risultato atteso" aside={!editing ? <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>Modifica</Button> : null}>
        {editing ? (
          <GoalEditor goal={goal} onDone={() => setEditing(false)} />
        ) : (
          <p className="text-ui whitespace-pre-wrap text-foreground/90">{goal.outcome}</p>
        )}
      </InspectorSection>
      {!editing ? (
        <InspectorSection title={`Esempi (${goal.examples.length})`}>
          <ExampleList examples={goal.examples} />
        </InspectorSection>
      ) : null}
      <InspectorSection title="Decisioni">
        {links.openQuestions.map((question) => (
          <button
            key={question.id}
            type="button"
            className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 py-1 text-left text-ui hover:bg-[var(--sidebar-accent)]"
            onClick={() => setInspector({ kind: "pact" })}
          >
            <span className="size-[7px] shrink-0 rounded-full bg-[var(--color-text-accent)]" />
            <span className="min-w-0 flex-1 truncate">{question.question}</span>
            <Badge tone="warning">da decidere</Badge>
          </button>
        ))}
        {links.decisions.map((decision) => (
          <div key={decision.id} className="flex items-center gap-2 py-0.5">
            <button type="button" className="min-w-0 flex-1 truncate text-left text-ui hover:underline" onClick={() => setInspector({ kind: "decision", id: decision.id })}>
              <span className="font-mono text-[11px] text-muted-foreground">{decision.id} v{decision.version}</span> {decision.value}
            </button>
            <button
              type="button"
              aria-label={`Scollega ${decision.id}`}
              className="sidebar-icon-button size-5 shrink-0 rounded-md"
              onClick={() => void act("goal:update", { id: goal.id, decisionIds: goal.decisionIds.filter((d) => d !== decision.id) })}
            >
              <IconTrash className="size-3" />
            </button>
          </div>
        ))}
        {links.missingDecisionIds.map((missing) => (
          <p key={missing} className="text-ui-sm text-warning">
            {missing}: la decisione collegata non è più nel Patto.
          </p>
        ))}
        {!links.decisions.length && !links.openQuestions.length && !links.missingDecisionIds.length ? <EmptyNote>Nessuna decisione collegata.</EmptyNote> : null}
        {linkable.length ? (
          <div className="mt-2 flex items-center gap-1.5">
            <PickerSelect
              label="Decisione da collegare"
              title="Decisioni del Patto"
              meta={linkable.length === 1 ? "1 decisione" : `${linkable.length} decisioni`}
              placeholder="Collega una decisione del Patto…"
              searchPlaceholder="Cerca una decisione"
              value={linking}
              options={linkable.map((d) => ({ value: d.id, title: d.id, subtitle: d.value }))}
              onChange={setLinking}
              className="flex-1"
            />
            <Button
              size="xs"
              variant="outline"
              disabled={!linking}
              onClick={() => void act("goal:update", { id: goal.id, decisionIds: [...goal.decisionIds, linking] }).then(() => setLinking(""))}
            >
              Collega
            </Button>
          </div>
        ) : null}
      </InspectorSection>
      <InspectorSection title={`Lavori (${links.assignments.length})`}>
        {links.assignments.length === 0 ? (
          <EmptyNote>Nessun incarico collegato. Il Coordinatore assegna il lavoro dal dialogo dell'obiettivo, entro il mandato.</EmptyNote>
        ) : null}
        {links.assignments.map(({ assignment, specialist }) => (
          <button
            key={assignment.id}
            type="button"
            onClick={() => setInspector({ kind: "specialist", id: specialist.id })}
            className="-mx-2 block w-[calc(100%+1rem)] rounded-lg px-2 py-1.5 text-left hover:bg-[var(--sidebar-accent)]"
          >
            <span className="flex items-center gap-2 text-ui">
              <span className="min-w-0 flex-1 truncate text-foreground">
                <AgentName agent={specialist} /> <span className="text-muted-foreground"><Sep />{assignment.objective}</span>
              </span>
              <Badge tone={ASSIGNMENT_STATUS[assignment.status].tone}>{ASSIGNMENT_STATUS[assignment.status].label}</Badge>
            </span>
            <span className="block truncate text-ui-sm text-muted-foreground">
              {providerName(assignment.provider)}<Sep />{assignment.model}
            </span>
          </button>
        ))}
      </InspectorSection>
      <InspectorSection title={`Risultati (${links.candidates.length})`}>
        {links.candidates.length === 0 ? <EmptyNote>Nessun candidato per questo obiettivo.</EmptyNote> : null}
        {links.candidates.map((candidate) => {
          const report = project.candidateReports[candidate.id];
          return (
            <button
              key={candidate.id}
              type="button"
              onClick={() => setInspector({ kind: "candidate", id: candidate.id })}
              className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 py-1 text-left text-ui hover:bg-[var(--sidebar-accent)]"
            >
              <span className="font-mono text-[11px] text-muted-foreground">{candidate.id}</span>
              <span className="min-w-0 flex-1 truncate">{candidate.changedFiles.length} file</span>
              {report ? <Badge tone={CANDIDATE_STATE[report.state].tone}>{CANDIDATE_STATE[report.state].label}</Badge> : null}
            </button>
          );
        })}
      </InspectorSection>
    </>
  );
}

/** A goal in the conversation: the one the person created, or the one the Coordinator proposed. */
export function GoalCard({ goalId }: { goalId: string }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const openDialog = useUi((s) => s.openDialog);
  const dialogGoalId = useUi((s) => s.dialogGoalId);
  const goal = findGoal(project.document, goalId);
  if (!goal) return null;
  return (
    <div className="my-3 overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-[var(--card)]" data-testid="goal-card">
      <div className="flex items-center gap-2 px-3.5 pt-2.5 pb-1 text-ui">
        <IconTarget className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {goal.status === "proposed" ? "Obiettivo proposto" : "Obiettivo"}: {goal.title}
        </span>
        <GoalBadges goal={goal} />
      </div>
      <div className="px-3.5 pb-3">
        <p className="text-ui text-foreground/90">{goal.outcome}</p>
        <div className="mt-2">
          <ExampleList examples={goal.examples} />
        </div>
        <div className="cta-row mt-3">
          {goal.status === "proposed" && !isArchived(goal) ? (
            <Button size="sm" onClick={() => void act("goal:update", { id: goal.id, status: "open" })}>
              Conferma l'obiettivo
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => setInspector({ kind: "goal", id: goal.id })}>
            {goal.status === "proposed" ? "Modifica la proposta" : "Dettagli"}
          </Button>
          {dialogGoalId !== goal.id && goal.status !== "proposed" ? (
            <Button size="sm" variant="ghost" onClick={() => openDialog(goal.id)}>
              <IconMessageCircle /> Apri il dialogo
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Shown at the top of a goal dialog: where the messages go. */
export function GoalDialogHeader({ goalId }: { goalId: string }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const [deleting, setDeleting] = useState<ProjectGoal | null>(null);
  const goal = findGoal(project.document, goalId);
  if (!goal) return null;
  const accepted = goal.examples.filter((e) => e.kind === "accepted").length;
  const refused = goal.examples.length - accepted;
  const archived = isArchived(goal);
  const empty = goalDialogIsEmpty(project.document, goal.id);
  return (
    <div className={cn("mb-2 rounded-xl border border-[color:var(--color-border)] px-3.5 py-2.5")} data-testid="goal-dialog-header">
      <div className="flex items-center gap-2 text-ui">
        <IconTarget className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{goal.title}</span>
        <GoalBadges goal={goal} />
      </div>
      <p className="mt-1 line-clamp-2 text-ui-sm text-muted-foreground">{goal.outcome}</p>
      <p className="mt-1 text-ui-xs text-muted-foreground">
        {goal.examples.length ? `${accepted} esempi accettati, ${refused} rifiutati` : "Esempi da definire"}<Sep />{goalWorkSummary(project.document, goal.id)}<Sep />{" "}
        <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "goal", id: goal.id })}>
          dettagli
        </button>
      </p>
      {archived || empty ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[color:var(--color-border)] pt-2">
          <p className="min-w-[12rem] flex-1 text-ui-sm text-muted-foreground">
            {archived
              ? "Obiettivo archiviato: il dialogo resta consultabile. Ripristinalo per riportarlo tra gli obiettivi di lavoro."
              : "Il dialogo è vuoto. Se l'hai creato per sbaglio puoi eliminarlo."}
          </p>
          <div className="cta-row">
            {archived ? (
              <Button size="xs" variant="outline" onClick={() => setArchived(goal, false)}>
                Ripristina
              </Button>
            ) : (
              <Button size="xs" variant="ghost" onClick={() => setDeleting(goal)}>
                <IconTrash /> Elimina il dialogo
              </Button>
            )}
          </div>
        </div>
      ) : null}
      <DeleteGoalDialog goal={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}
