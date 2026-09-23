import { IconArrowLeft } from "@tabler/icons-react";
import { useState } from "react";
import type { Specialist } from "@shared/domain";
import { ASSIGNMENT_STATUS, AssignmentCard, CandidateCard, TeamProposalCard } from "@/components/chat/Cards";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Badge, TextArea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { act, useUi } from "@/lib/store";
import { EmptyNote, InspectorSection } from "./Inspector";

const STATUS_LABEL: Record<Specialist["status"], string> = {
  available: "libero",
  working: "al lavoro",
  stopping: "in arresto",
  stopped: "fermato",
  removed: "fuori dal team",
};

export function StatusDot({ status }: { status: Specialist["status"] }) {
  if (status === "working" || status === "stopping") return <Spinner />;
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        status === "available" && "bg-success",
        status === "stopped" && "bg-warning",
        status === "removed" && "bg-muted-foreground/40",
      )}
    />
  );
}

export function TeamView() {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const team = project.document.team;
  const pending = team.proposals.find((p) => !p.resolution);
  const members = team.specialists.filter((s) => s.status !== "removed");
  const former = team.specialists.filter((s) => s.status === "removed");
  return (
    <>
      <InspectorSection title="Il team del progetto">
        <p className="text-ui-sm text-muted-foreground">
          Il Coordinatore propone il team alla fine dello studio. Solo la tua risposta crea gli specialisti; poi il Coordinatore lo cambia entro il mandato.
        </p>
      </InspectorSection>
      {pending ? (
        <InspectorSection title="Proposta in attesa">
          <TeamProposalCard proposalId={pending.id} />
        </InspectorSection>
      ) : null}
      <InspectorSection title={`Specialisti (${members.length})`}>
        {members.length === 0 ? <EmptyNote>{team.confirmedAt ? "Il team non ha specialisti attivi." : "Nessun team confermato."}</EmptyNote> : null}
        <div className="-mx-2 flex flex-col gap-0.5">
          {members.map((specialist) => (
            <button
              key={specialist.id}
              type="button"
              onClick={() => setInspector({ kind: "specialist", id: specialist.id })}
              className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--sidebar-accent)]"
            >
              <span className="mt-1.5 flex w-3 justify-center">
                <StatusDot status={specialist.status} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-ui text-foreground">
                  {specialist.name} <span className="text-muted-foreground">· {specialist.competence}</span>
                </span>
                <span className="block truncate text-ui-sm text-muted-foreground">
                  {STATUS_LABEL[specialist.status]} · {specialist.lastUpdate}
                </span>
              </span>
            </button>
          ))}
        </div>
      </InspectorSection>
      {former.length ? (
        <InspectorSection title="Usciti dal team">
          {former.map((s) => (
            <p key={s.id} className="text-ui-sm text-muted-foreground">
              {s.name} · {s.removal?.reason}
            </p>
          ))}
        </InspectorSection>
      ) : null}
    </>
  );
}

export function SpecialistView({ id }: { id: string }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const focusComposer = useUi((s) => s.focusComposer);
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState("");
  const specialist = project.document.team.specialists.find((s) => s.id === id);
  if (!specialist) return <div className="p-4"><EmptyNote>Specialista non trovato.</EmptyNote></div>;
  const current = specialist.assignments.at(-1);
  const busy = current && ["preparing", "running", "stopRequested"].includes(current.status);
  return (
    <>
      <div className="px-4 pt-3">
        <button type="button" className="inline-flex items-center gap-1 text-ui-sm text-muted-foreground hover:text-foreground" onClick={() => setInspector({ kind: "team" })}>
          <IconArrowLeft className="size-3.5" /> Team
        </button>
        <div className="mt-2 flex items-center gap-2">
          <h3 className="text-ui-lg font-medium text-foreground">{specialist.name}</h3>
          <Badge>{specialist.id}</Badge>
          <span className="ml-auto flex items-center gap-1.5 text-ui-sm text-muted-foreground">
            <StatusDot status={specialist.status} /> {STATUS_LABEL[specialist.status]}
          </span>
        </div>
        <p className="mt-0.5 text-ui text-muted-foreground">{specialist.competence}</p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="outline" onClick={() => focusComposer()}>
            Vai alla conversazione
          </Button>
          {specialist.status !== "removed" && !busy ? (
            <Button size="sm" variant="ghost" onClick={() => setRemoving(!removing)}>
              Togli dal team
            </Button>
          ) : null}
        </div>
        {removing ? (
          <div className="mt-2 space-y-2">
            <TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo" className="min-h-12" />
            <Button
              size="sm"
              variant="destructive"
              disabled={!reason.trim()}
              onClick={() => void act("specialist:remove", { specialistId: specialist.id, reason: reason.trim() }).then(() => setRemoving(false))}
            >
              Togli {specialist.name}
            </Button>
          </div>
        ) : null}
      </div>
      <InspectorSection title="Perché è nel team">
        <p className="text-ui text-foreground/90">{specialist.reason}</p>
        <p className="mt-1 text-ui-xs text-muted-foreground">
          {specialist.origin === "teamProposal" ? "Dalla proposta confermata" : "Aggiunto dal Coordinatore"} · {formatRelativeTime(specialist.createdAt)}
        </p>
      </InspectorSection>
      {project.document.candidates.some((c) => c.specialistId === specialist.id) ? (
        <InspectorSection title="Candidati">
          {project.document.candidates
            .filter((c) => c.specialistId === specialist.id)
            .reverse()
            .map((c) => (
              <CandidateCard key={c.id} candidateId={c.id} />
            ))}
        </InspectorSection>
      ) : null}
      <InspectorSection title={`Incarichi (${specialist.assignments.length})`}>
        {specialist.assignments.length === 0 ? <EmptyNote>Nessun incarico.</EmptyNote> : null}
        {[...specialist.assignments].reverse().map((assignment) =>
          assignment.id === current?.id ? (
            <AssignmentCard key={assignment.id} assignmentId={assignment.id} />
          ) : (
            <div key={assignment.id} className="flex items-center gap-2 py-1 text-ui-sm">
              <span className="font-mono text-[11px] text-muted-foreground">{assignment.id}</span>
              <span className="min-w-0 flex-1 truncate text-foreground/90">{assignment.objective}</span>
              <Badge tone={ASSIGNMENT_STATUS[assignment.status].tone}>{ASSIGNMENT_STATUS[assignment.status].label}</Badge>
            </div>
          ),
        )}
      </InspectorSection>
    </>
  );
}
