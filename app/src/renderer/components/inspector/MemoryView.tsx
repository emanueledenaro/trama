import { useState } from "react";
import type { LearnedSkillView, LearningReviewRun, LearningView, MemoryStoreView, PracticeView } from "@shared/domain";
import { Button } from "@/components/ui/button";
import { Badge, TextArea } from "@/components/ui/field";
import { formatDate } from "@/lib/format";
import { act, useUi } from "@/lib/store";
import { EmptyNote, InspectorSection } from "./Inspector";

/** What the Coordinator learned in this project, visible and correctable by the person (ADR 0014, C15). */
export function MemoryView() {
  const learning = useUi((s) => s.app?.learning ?? null);
  return (
    <>
      <InspectorSection title="Cosa impara il Coordinatore">
        <p className="text-ui-sm text-muted-foreground">
          Il Coordinatore tiene note sul progetto, un profilo di come lavori e le procedure che funzionano, dette skill. Dopo un po' di lavoro una revisione separata rilegge la conversazione e le aggiorna. Tutto
          resta nella cartella di Trama, mai nel repository, e qui puoi correggere o togliere ogni cosa. Sono note del Coordinatore: le decisioni restano quelle del Patto.
        </p>
      </InspectorSection>
      {learning ? (
        <>
          <ProposalsSection learning={learning} />
          <MemorySection title="Note sul progetto" target="memory" store={learning.memory} empty="Nessuna nota sul progetto finora." />
          <MemorySection title="Il tuo profilo" target="user" store={learning.user} empty="Nessun fatto sul tuo modo di lavorare finora. Vale per tutti i tuoi progetti." />
          <SkillsSection learning={learning} />
          <ReviewsSection learning={learning} />
          <CuratorSection learning={learning} />
        </>
      ) : null}
      <PracticesSection />
    </>
  );
}

function UsageLine({ store }: { store: MemoryStoreView }) {
  const percent = Math.min(100, Math.floor((store.chars / store.limit) * 100));
  return (
    <div className="mb-2">
      <div className="h-1 overflow-hidden rounded-full bg-[var(--color-border)]">
        <div className={percent >= 90 ? "h-full bg-[var(--color-text-destructive,#d33)]" : "h-full bg-[var(--color-text-accent)]"} style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-ui-xs text-muted-foreground">
        {store.chars} di {store.limit} caratteri
      </p>
    </div>
  );
}

function MemorySection({ title, target, store, empty }: { title: string; target: "memory" | "user"; store: MemoryStoreView; empty: string }) {
  const [adding, setAdding] = useState("");
  return (
    <InspectorSection title={`${title} (${store.entries.length})`}>
      {!store.enabled ? <p className="mb-2 text-ui-xs text-muted-foreground">Spenta nelle impostazioni: il Coordinatore non la riceve e non la scrive.</p> : null}
      <UsageLine store={store} />
      {store.entries.length === 0 ? <EmptyNote>{empty}</EmptyNote> : null}
      <div className="space-y-1.5">
        {store.entries.map((entry) => (
          <MemoryEntry key={entry} target={target} entry={entry} />
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <TextArea value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Aggiungi un fatto" className="min-h-9" />
        <Button
          size="sm"
          variant="outline"
          disabled={!adding.trim()}
          onClick={() =>
            void act("learning:memory", { target, action: "add", content: adding }).then((result) => {
              if (result?.success) setAdding("");
              else if (result?.error) useUi.getState().setToast(result.error);
            })
          }
        >
          Aggiungi
        </Button>
      </div>
    </InspectorSection>
  );
}

function MemoryEntry({ target, entry }: { target: "memory" | "user"; entry: string }) {
  const [editing, setEditing] = useState<string | null>(null);
  const save = (action: "replace" | "remove") =>
    void act("learning:memory", { target, action, oldText: entry, content: editing ?? "" }).then((result) => {
      if (result?.success) setEditing(null);
      else if (result?.error) useUi.getState().setToast(result.error);
    });
  return (
    <div className="rounded-xl border border-[color:var(--color-border)] p-2 text-ui-sm">
      {editing === null ? (
        <p className="whitespace-pre-wrap text-foreground/90">{entry}</p>
      ) : (
        <TextArea value={editing} onChange={(e) => setEditing(e.target.value)} className="min-h-12" />
      )}
      <div className="mt-1.5 flex gap-2">
        {editing === null ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(entry)}>
            Correggi
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={!editing.trim()} onClick={() => save("replace")}>
            Salva
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => save("remove")}>
          Togli
        </Button>
      </div>
    </div>
  );
}

function ProposalsSection({ learning }: { learning: LearningView }) {
  if (!learning.proposals.length) return null;
  return (
    <InspectorSection title={`Proposte da approvare (${learning.proposals.length})`}>
      <p className="mb-2 text-ui-sm text-muted-foreground">La revisione non cambia né toglie note da sola: lo propone e decidi tu.</p>
      <div className="space-y-2">
        {learning.proposals.map((proposal) => (
          <div key={proposal.id} className="rounded-xl border border-[color:var(--color-border)] p-2.5 text-ui-sm">
            <p className="text-ui-xs text-muted-foreground">
              {proposal.target === "user" ? "Profilo" : "Note sul progetto"} · {formatDate(proposal.createdAt)}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-foreground/90">{proposal.summary}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void act("learning:proposal", { id: proposal.id, approve: true })}>
                Applica
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void act("learning:proposal", { id: proposal.id, approve: false })}>
                Scarta
              </Button>
            </div>
          </div>
        ))}
      </div>
    </InspectorSection>
  );
}

function SkillsSection({ learning }: { learning: LearningView }) {
  return (
    <InspectorSection title={`Skill apprese (${learning.skills.length})`}>
      <p className="mb-2 text-ui-sm text-muted-foreground">
        Procedure che il Coordinatore carica quando servono. Quelle create dalla revisione le cura il manutentore: dopo 14 giorni senza uso diventano inattive, dopo 30 vanno in archivio. Una skill fissata non
        cambia mai da sola.
      </p>
      {learning.skills.length === 0 ? <EmptyNote>Nessuna skill appresa finora.</EmptyNote> : null}
      <div className="space-y-2">
        {learning.skills.map((skill) => (
          <SkillRow key={skill.name} skill={skill} />
        ))}
      </div>
      {learning.archivedSkills.length ? (
        <div className="mt-3">
          <p className="mb-1 text-ui-xs text-muted-foreground">In archivio</p>
          {learning.archivedSkills.map((name) => (
            <div key={name} className="flex items-center gap-2 py-0.5 text-ui-sm">
              <span className="text-foreground/80">{name}</span>
              <Button className="ml-auto" size="sm" variant="ghost" onClick={() => void act("learning:skill", { name: name.replace(/-\d{14}$/, ""), action: "restore" })}>
                Ripristina
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </InspectorSection>
  );
}

function SkillRow({ skill }: { skill: LearnedSkillView }) {
  const [content, setContent] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const change = (action: "pin" | "unpin" | "adopt" | "archive" | "delete" | "edit", extra: { content?: string } = {}) =>
    act("learning:skill", { name: skill.name, action, ...extra });
  return (
    <div className="rounded-xl border border-[color:var(--color-border)] p-2.5 text-ui-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-foreground">{skill.name}</span>
        {skill.category ? <span className="text-ui-xs text-muted-foreground">{skill.category}</span> : null}
        <span className="ml-auto flex gap-1">
          {skill.pinned ? <Badge tone="info">Fissata</Badge> : null}
          {skill.state === "stale" ? <Badge tone="warning">Inattiva</Badge> : null}
          {skill.createdBy === "agent" ? <Badge tone="secondary">Dalla revisione</Badge> : <Badge tone="outline">Con te</Badge>}
        </span>
      </div>
      <p className="mt-1 text-foreground/90">{skill.description}</p>
      <p className="mt-1 text-ui-xs text-muted-foreground">
        Usata {skill.useCount} volte · modificata {skill.patchCount} volte · {skill.lastActivityAt ? `ultimo uso ${formatDate(skill.lastActivityAt)}` : "mai usata"}
      </p>
      {content !== null ? (
        <div className="mt-2 space-y-2">
          <TextArea value={content} onChange={(e) => setContent(e.target.value)} className="min-h-40 font-mono text-ui-xs" />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void change("edit", { content }).then(() => setContent(null))}>
              Salva la skill
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setContent(null)}>
              Chiudi
            </Button>
          </div>
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {content === null ? (
          <Button size="sm" variant="ghost" onClick={() => void act("learning:skillContent", { name: skill.name }).then((text) => setContent(text ?? ""))}>
            Apri
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => void change(skill.pinned ? "unpin" : "pin")}>
          {skill.pinned ? "Togli il fissaggio" : "Fissa"}
        </Button>
        {skill.createdBy !== "agent" ? (
          <Button size="sm" variant="ghost" onClick={() => void change("adopt")}>
            Affida al manutentore
          </Button>
        ) : null}
        {!skill.pinned ? (
          <Button size="sm" variant="ghost" onClick={() => void change("archive")}>
            Archivia
          </Button>
        ) : null}
        {!skill.pinned ? (
          confirming ? (
            <Button size="sm" variant="destructive" onClick={() => void change("delete")}>
              Elimina davvero
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
              Elimina
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}

const TRIGGERS: Record<LearningReviewRun["trigger"], string> = {
  memory: "dopo 10 tuoi messaggi",
  skills: "dopo 10 azioni del Coordinatore",
  "memory+skills": "dopo 10 messaggi e 10 azioni",
  person: "chiesta da te",
  curator: "manutenzione",
};
const STATUS: Record<LearningReviewRun["status"], string> = { running: "In corso", completed: "Conclusa", failed: "Non riuscita", cancelled: "Interrotta" };

const plural = (n: number, one: string, many: string) => `${Math.max(0, n)} ${Math.max(0, n) === 1 ? one : many}`;

function ReviewsSection({ learning }: { learning: LearningView }) {
  const [focus, setFocus] = useState("");
  const running = learning.reviews.some((r) => r.status === "running");
  const { counters } = learning;
  return (
    <InspectorSection title="Revisioni dell'esperienza">
      <p className="mb-2 text-ui-sm text-muted-foreground">
        Prossima revisione della memoria tra {plural(counters.memoryInterval - counters.turnsSinceMemory, "tuo messaggio", "tuoi messaggi")}, delle skill tra{" "}
        {plural(counters.skillInterval - counters.itersSinceSkill, "azione", "azioni")} del Coordinatore.
      </p>
      <div className="mb-3 flex gap-2">
        <TextArea value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Su cosa concentrarsi (facoltativo)" className="min-h-9" />
        <Button size="sm" variant="outline" disabled={running} onClick={() => void act("learning:review", { focus }).then(() => setFocus(""))}>
          Rivedi ora
        </Button>
      </div>
      {learning.reviews.length === 0 ? <EmptyNote>Nessuna revisione finora.</EmptyNote> : null}
      <div className="space-y-1.5">
        {learning.reviews.slice(0, 10).map((run) => (
          <div key={run.id} className="rounded-lg bg-[var(--app-chat-code-surface)] px-2.5 py-2 text-ui-xs">
            <div className="flex gap-2">
              <span className="font-medium text-foreground/90">{STATUS[run.status]}</span>
              <span className="text-muted-foreground">{TRIGGERS[run.trigger]}</span>
              <span className="ml-auto text-muted-foreground">{formatDate(run.startedAt)}</span>
            </div>
            <p className="mt-1 text-muted-foreground">
              {run.actions.length ? run.actions.join(" · ") : run.status === "completed" ? "Niente da salvare." : ""}
              {run.error ? ` ${run.error}` : ""}
            </p>
            <p className="mt-0.5 text-muted-foreground/80">
              {run.toolCalls} chiamate{run.usedTokens !== null ? ` · ${run.usedTokens.toLocaleString("it-IT")} token` : ""}
              {run.model ? ` · ${run.model}` : ""}
            </p>
          </div>
        ))}
      </div>
    </InspectorSection>
  );
}

function CuratorSection({ learning }: { learning: LearningView }) {
  const { curator } = learning;
  return (
    <InspectorSection title="Manutenzione delle skill">
      <p className="mb-2 text-ui-sm text-muted-foreground">
        {curator.lastRunAt ? `Ultimo controllo ${formatDate(curator.lastRunAt)}.` : "Non ha ancora controllato."} {curator.lastRunSummary ?? ""}
        {curator.paused ? " In pausa." : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => void act("learning:curator", { action: "run" })}>
          Controlla ora
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void act("learning:curator", { action: "dryRun" })}>
          Anteprima
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void act("learning:curator", { action: curator.paused ? "resume" : "pause" })}>
          {curator.paused ? "Riprendi" : "Metti in pausa"}
        </Button>
        {curator.backups.length ? (
          <Button size="sm" variant="ghost" onClick={() => void act("learning:curator", { action: "rollback", backupId: curator.backups[0] })}>
            Torna alla copia del {curator.backups[0]!.slice(0, 10)}
          </Button>
        ) : null}
      </div>
    </InspectorSection>
  );
}

/** General practices: the Coordinator proposes them from evidence, only the person adopts or retires them (C15). */
function PracticesSection() {
  const practices = useUi((s) => s.app?.practices ?? []);
  return (
    <InspectorSection title={`Pratiche (${practices.length})`}>
      <p className="mb-2 text-ui-sm text-muted-foreground">
        Metodi generali nati da problemi reali. Contengono solo il metodo: codice e decisioni restano nel progetto di origine.
      </p>
      {practices.length === 0 ? <EmptyNote>Nessuna pratica proposta finora.</EmptyNote> : null}
      <div className="space-y-2">
        {practices.map((practice) => (
          <PracticeRow key={practice.id} practice={practice} />
        ))}
      </div>
    </InspectorSection>
  );
}

function PracticeRow({ practice }: { practice: PracticeView }) {
  const [retiring, setRetiring] = useState(false);
  const [reason, setReason] = useState("");
  const adopted = practice.adoptedVersion !== null;
  return (
    <div className="rounded-xl border border-[color:var(--color-border)] p-2.5 text-ui-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium text-foreground">{practice.title}</span>
        <span className="text-ui-xs text-muted-foreground">v{adopted ? practice.adoptedVersion : practice.version}</span>
        <span className="ml-auto">
          {adopted ? <Badge tone="success">Adottata</Badge> : practice.retiredHere ? <Badge tone="secondary">Ritirata</Badge> : <Badge tone="info">Proposta</Badge>}
        </span>
      </div>
      <p className="mt-1 text-foreground/90">{practice.method}</p>
      {practice.rationale ? <p className="mt-1 text-ui-xs text-muted-foreground">Perché: {practice.rationale}</p> : null}
      {practice.evidence.length ? <p className="mt-1 text-ui-xs text-muted-foreground">Prove: {practice.evidence.join("; ")}</p> : null}
      {!practice.fromThisProject ? <p className="mt-1 text-ui-xs text-muted-foreground">Nata in un altro progetto: verificane l'utilità qui prima di adottarla.</p> : null}
      {practice.retiredHere ? <p className="mt-1 text-ui-xs text-muted-foreground">Ritirata: {practice.retiredHere.reason}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {!adopted || (practice.adoptedVersion ?? 0) < practice.version ? (
          <Button size="sm" variant="outline" onClick={() => void act("practice:change", { action: "adopt", id: practice.id })}>
            {adopted ? `Passa alla v${practice.version}` : "Adotta in questo progetto"}
          </Button>
        ) : null}
        {adopted && (practice.adoptedVersion ?? 0) > 1 ? (
          <Button size="sm" variant="ghost" onClick={() => void act("practice:change", { action: "rollback", id: practice.id })}>
            Torna alla versione precedente
          </Button>
        ) : null}
        {adopted ? (
          <Button size="sm" variant="ghost" onClick={() => setRetiring(!retiring)}>
            Ritira
          </Button>
        ) : null}
      </div>
      {retiring ? (
        <div className="mt-2 space-y-2">
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Perché la ritiri" className="min-h-12" />
          <Button
            size="sm"
            variant="destructive"
            onClick={() => void act("practice:change", { action: "retire", id: practice.id, reason }).then(() => setRetiring(false))}
          >
            Ritira la pratica
          </Button>
        </div>
      ) : null}
    </div>
  );
}
