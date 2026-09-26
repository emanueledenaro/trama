import type { SpecSections, WorkPlan } from "@shared/domain";
import { useState } from "react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge, Input, TextArea } from "@/components/ui/field";
import { act, useUi } from "@/lib/store";
import { PlanSlices } from "./PlanSlices";

/**
 * The body of a plan written as a spec with AI Hero's to-spec (M04): the seam check the person answers, then the
 * spec with the template's sections, where it was published, and the person's corrections; then its slices (M05).
 */

type ListKey = "userStories" | "implementationDecisions" | "testingDecisions";
type Draft = Omit<SpecSections, ListKey> & Record<ListKey, string>;

const LIST_LABELS: Record<ListKey, string> = {
  userStories: "Storie utente",
  implementationDecisions: "Decisioni di implementazione",
  testingDecisions: "Decisioni sui test",
};

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <div className="text-ui-xs text-muted-foreground/70">{label}</div>
      <div className="mt-0.5 text-ui text-foreground/90 whitespace-pre-line">{children}</div>
    </div>
  );
}

function List({ items, numbered }: { items: string[]; numbered?: boolean }) {
  if (!items.length) return <span className="text-muted-foreground">Nessuna.</span>;
  const Tag = numbered ? "ol" : "ul";
  return (
    <Tag className={numbered ? "list-decimal space-y-0.5 pl-4" : "list-disc space-y-0.5 pl-4"}>
      {items.map((item, index) => (
        <li key={`${index}-${item}`}>{item}</li>
      ))}
    </Tag>
  );
}

const toDraft = (sections: SpecSections): Draft => ({
  ...sections,
  userStories: sections.userStories.join("\n"),
  implementationDecisions: sections.implementationDecisions.join("\n"),
  testingDecisions: sections.testingDecisions.join("\n"),
});

const fromDraft = (draft: Draft): SpecSections => ({
  ...draft,
  userStories: draft.userStories.split("\n"),
  implementationDecisions: draft.implementationDecisions.split("\n"),
  testingDecisions: draft.testingDecisions.split("\n"),
});

function SpecEditor({ plan, sections, onClose }: { plan: WorkPlan; sections: SpecSections; onClose: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(sections));
  const field = (key: keyof Draft, label: string, hint?: string) => (
    <label className="block text-ui-xs text-muted-foreground">
      {label}
      {hint ? `, ${hint}` : ""}
      <TextArea value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} className="mt-1 min-h-12" />
    </label>
  );
  return (
    <div className="mt-2 space-y-2">
      <label className="block text-ui-xs text-muted-foreground">
        Titolo
        <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="mt-1" />
      </label>
      {field("problemStatement", "Problema")}
      {field("solution", "Soluzione")}
      {(Object.keys(LIST_LABELS) as ListKey[]).map((key) => (
        <div key={key}>{field(key, LIST_LABELS[key], "una per riga")}</div>
      ))}
      {field("outOfScope", "Fuori perimetro")}
      {field("furtherNotes", "Altre note")}
      <div className="cta-row">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Annulla
        </Button>
        <Button size="sm" onClick={() => void act("plan:edit", { planId: plan.id, sections: fromDraft(draft) }).then(onClose)}>
          Salva la spec
        </Button>
      </div>
    </div>
  );
}

export function PlanSpecBody({ plan }: { plan: WorkPlan }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const [correction, setCorrection] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const spec = plan.spec;
  if (!spec) return null;
  const sections = spec.sections;
  const moduleName = (id: string) => project.snapshot.modules.find((m) => m.id === id)?.name ?? id;
  const connected = Boolean(project.github.repository) && project.github.status !== "unavailable";
  const answer = spec.seamsAnswer;

  return (
    <div data-testid="plan-spec" data-status={plan.status}>
      {sections ? (
        <>
          <p className="mt-2 text-ui font-medium text-foreground">{sections.title}</p>
          {plan.editedAt ? <p className="text-ui-xs text-muted-foreground">Corretta da te</p> : null}
          <Section label="Problema">{sections.problemStatement}</Section>
          <Section label="Soluzione">{sections.solution}</Section>
        </>
      ) : plan.status === "seams" ? (
        <p className="mt-2 text-ui text-foreground/90">Prima di scrivere la spec, il pianificatore propone dove testare il lavoro. Vanno bene?</p>
      ) : null}

      <Section label="Seam da testare">
        <div className="space-y-1.5">
          {spec.seams.map((seam) => (
            <div key={seam.seam} data-testid="plan-seam" className="rounded-lg border border-[color:var(--color-border)] px-3 py-2">
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 text-ui text-foreground">{seam.seam}</span>
                <Badge tone={seam.existing ? "success" : "info"}>{seam.existing ? "Esistente" : "Nuovo"}</Badge>
              </div>
              <div className="mt-0.5 text-ui-sm text-muted-foreground">Si verifica: {seam.tests}</div>
            </div>
          ))}
        </div>
      </Section>
      {answer ? (
        <p className="mt-1 text-ui-xs text-muted-foreground">{answer.confirmed ? "Confermati da te." : `Corretti da te: «${answer.note ?? ""}»`}</p>
      ) : null}

      {plan.status === "seams" ? (
        correction === null ? (
          <div className="cta-row mt-3">
            <Button size="sm" variant="ghost" onClick={() => setCorrection("")}>
              Correggi i seam
            </Button>
            <Button size="sm" onClick={() => void act("plan:answerSeams", { planId: plan.id, confirmed: true, note: null })}>
              Conferma i seam
            </Button>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <TextArea
              value={correction}
              onChange={(e) => setCorrection(e.target.value)}
              placeholder="Cosa cambieresti? Per esempio un seam da aggiungere o da spostare"
              aria-label="Correzione dei seam"
              className="min-h-12"
            />
            <div className="cta-row">
              <Button size="sm" variant="ghost" onClick={() => setCorrection(null)}>
                Annulla
              </Button>
              <Button
                size="sm"
                disabled={!correction.trim()}
                onClick={() => void act("plan:answerSeams", { planId: plan.id, confirmed: false, note: correction.trim() }).then(() => setCorrection(null))}
              >
                Invia la correzione
              </Button>
            </div>
          </div>
        )
      ) : null}

      {sections ? (
        <>
          {expanded ? (
            <>
              {(Object.keys(LIST_LABELS) as ListKey[]).map((key) => (
                <Section key={key} label={LIST_LABELS[key]}>
                  <List items={sections[key]} numbered={key === "userStories"} />
                </Section>
              ))}
              <Section label="Fuori perimetro">{sections.outOfScope || "Nessuno."}</Section>
              <Section label="Altre note">{sections.furtherNotes || "Nessuna."}</Section>
              {spec.affectedModuleIDs.length ? <Section label="Moduli">{spec.affectedModuleIDs.map(moduleName).join(", ")}</Section> : null}
              {spec.requiredDecisionIDs.length ? <Section label="Decisioni da rispettare">{spec.requiredDecisionIDs.join(", ")}</Section> : null}
              {spec.references.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {spec.references.slice(0, 10).map((path) => (
                    <button
                      key={path}
                      type="button"
                      onClick={() => setInspector({ kind: "file", path })}
                      className="rounded-md bg-[var(--color-background-button-secondary)] px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {path}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
          <button type="button" className="mt-2 text-ui-sm text-[var(--color-text-accent)] hover:underline" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Mostra meno" : `Mostra tutta la spec (${sections.userStories.length} storie utente)`}
          </button>

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-sm text-muted-foreground" data-testid="plan-spec-publication">
            {spec.issue ? (
              <>
                <span>Pubblicata su GitHub come issue #{spec.issue.number}.</span>
                <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={() => void act("shell:openExternal", { url: spec.issue!.url })}>
                  Apri la issue
                </button>
              </>
            ) : connected ? (
              <span>Non ancora pubblicata su GitHub.</span>
            ) : (
              <span>Resta in Trama: il progetto non ha GitHub collegato.</span>
            )}
            {spec.publishFailure ? <span className="text-warning">{spec.publishFailure}</span> : null}
          </div>

          {editing ? (
            <SpecEditor plan={plan} sections={sections} onClose={() => setEditing(false)} />
          ) : plan.status === "ready" || plan.status === "stale" ? (
            <div className="cta-row mt-3">
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Correggi la spec
              </Button>
              {connected && !spec.issue && plan.status === "ready" ? (
                <Button size="sm" variant="outline" onClick={() => void act("plan:publish", { planId: plan.id })}>
                  Pubblica su GitHub
                </Button>
              ) : null}
              {/* A spec written before M05 has no slices yet: the person can have it split, or approve it as a whole. */}
              {!plan.slicing && plan.status === "ready" ? (
                <Button size="sm" variant="outline" onClick={() => void act("plan:slice", { planId: plan.id })}>
                  Dividi in fette
                </Button>
              ) : null}
              {!plan.slicing ? (
                <Button
                  size="sm"
                  disabled={plan.status === "stale"}
                  onClick={() =>
                    void act("coordinator:send", {
                      text: `Ho rivisto il piano ${plan.id} e va bene. Realizzalo con il team entro il mandato.`,
                      moduleId: null,
                      model: null,
                      effort: null,
                    })
                  }
                >
                  Approva il piano e chiedi di realizzarlo
                </Button>
              ) : null}
            </div>
          ) : null}
          <PlanSlices plan={plan} />
        </>
      ) : null}
    </div>
  );
}
