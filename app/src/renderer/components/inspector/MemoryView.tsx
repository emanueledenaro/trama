import { useState } from "react";
import { MEMORY_BYTE_LIMIT, type PracticeView } from "@shared/domain";
import { Button } from "@/components/ui/button";
import { Badge, TextArea } from "@/components/ui/field";
import { formatDate } from "@/lib/format";
import { act, useUi } from "@/lib/store";
import { EmptyNote, InspectorSection } from "./Inspector";

export function MemoryView() {
  const memory = useUi((s) => s.app?.project?.document.coordinator.memory)!;
  const bytes = new TextEncoder().encode(memory.text).length;
  return (
    <>
      <InspectorSection title="Cosa conserva">
        <p className="text-ui-sm text-muted-foreground">
          Il Coordinatore scrive qui i fatti del progetto e le tue scelte che devono sopravvivere a una finestra di contesto più corta. Ogni scrittura sostituisce l'intero testo.
        </p>
        <p className="mt-2 text-ui-sm text-muted-foreground">
          {memory.revision
            ? `Revisione ${memory.revision} · ${memory.updatedAt ? formatDate(memory.updatedAt) : ""} · ${bytes} di ${MEMORY_BYTE_LIMIT} byte`
            : `0 di ${MEMORY_BYTE_LIMIT} byte`}
        </p>
      </InspectorSection>
      <InspectorSection title="Memoria">
        {memory.text ? (
          <pre className="rounded-xl bg-[var(--app-chat-code-surface)] p-3 font-sans text-ui whitespace-pre-wrap text-foreground/90">{memory.text}</pre>
        ) : (
          <EmptyNote>Il Coordinatore non ha ancora scritto la sua memoria.</EmptyNote>
        )}
      </InspectorSection>
      <PracticesSection />
    </>
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
