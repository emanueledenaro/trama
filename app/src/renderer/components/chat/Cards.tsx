import { IconChevronRight, IconInfoCircle, IconRosetteDiscountCheck, IconShieldCheck, IconTelescope } from "@tabler/icons-react";
import { useState } from "react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge, TextArea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { act, useUi } from "@/lib/store";
import { ACTION_LABELS } from "@/lib/labels";
import { ChatMarkdown } from "./ChatMarkdown";

function CardFrame({
  icon,
  title,
  aside,
  children,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("my-3 overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-[var(--card)]", className)}>
      <div className="flex items-center gap-2 px-3.5 pt-2.5 pb-1 text-ui">
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-3.5">{icon}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{title}</span>
        {aside}
      </div>
      <div className="px-3.5 pb-3">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <div className="text-ui-xs text-muted-foreground/70">{label}</div>
      <div className="mt-0.5 text-ui text-foreground/90">{children}</div>
    </div>
  );
}

export function StudyCard({ title, text, streaming }: { title: string; text: string; streaming: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <CardFrame
      icon={<IconTelescope stroke={1.8} />}
      title={title}
      aside={
        streaming ? (
          <span className="shimmer-text text-ui-sm">Il Coordinatore sta studiando il progetto</span>
        ) : (
          <button type="button" onClick={() => setOpen(!open)} className="sidebar-icon-button size-5" aria-label={open ? "Comprimi" : "Espandi"}>
            <IconChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </button>
        )
      }
    >
      {streaming && !text ? (
        <p className="text-ui text-muted-foreground">Lettura di codice, istruzioni, Patto e mandato…</p>
      ) : open ? (
        <ChatMarkdown text={text} />
      ) : (
        <p className="line-clamp-2 text-ui text-muted-foreground">{text}</p>
      )}
      {streaming ? (
        <div className="mt-2">
          <Button variant="outline" size="xs" onClick={() => void act("coordinator:interrupt", undefined)}>
            Interrompi
          </Button>
        </div>
      ) : null}
    </CardFrame>
  );
}

export function ContextNoticeCard({ title, detail }: { title: string; detail: string | null }) {
  return (
    <div className="my-3 flex items-start gap-2 rounded-xl bg-[var(--color-background-button-secondary)] px-3.5 py-2.5 text-ui">
      <IconInfoCircle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div>
        <div className="text-foreground/90">{title}</div>
        {detail ? <div className="text-ui-sm text-muted-foreground">{detail}</div> : null}
      </div>
    </div>
  );
}

export function MandateCard({ requestId }: { requestId: string }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const [revoking, setRevoking] = useState(false);
  const [reason, setReason] = useState("");
  const request = project.document.mandateRequests.find((r) => r.id === requestId);
  if (!request) return null;
  const moduleName = (id: string) => project.snapshot.modules.find((m) => m.id === id)?.name ?? id;
  const resolution = request.resolution;
  const hasMandate = project.document.mandate?.status === "granted";

  return (
    <CardFrame
      icon={<IconShieldCheck stroke={1.8} />}
      title="Mandato"
      aside={
        resolution ? (
          <Badge tone={resolution.kind === "revoked" ? "secondary" : "success"}>
            {resolution.kind === "granted" ? `Concesso · v${resolution.version}` : resolution.kind === "corrected" ? `Corretto · v${resolution.version}` : "Non concesso"}
          </Badge>
        ) : (
          <Badge tone="info">In attesa</Badge>
        )
      }
    >
      <p className="text-ui text-foreground/90">{request.reason}</p>
      <Field label="Obiettivi">
        <ul className="list-disc pl-4">
          {request.objectives.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
      </Field>
      {request.priorities.length ? <Field label="Priorità">{request.priorities.join(" · ")}</Field> : null}
      <Field label="Perimetro">{request.scopeModuleIds.map(moduleName).join(", ")}</Field>
      <Field label="Azioni autorizzate">{request.authorizedActions.map((a) => ACTION_LABELS[a]).join(" · ")}</Field>
      {request.limits.length ? <Field label="Limiti">{request.limits.join(" · ")}</Field> : null}
      {!resolution ? (
        revoking ? (
          <div className="mt-3 space-y-2">
            <TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo" aria-label="Motivo della revoca" />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={!reason.trim()}
                onClick={() => void act("mandate:revoke", { reason: reason.trim(), requestId })}
              >
                {hasMandate ? "Revoca il mandato" : "Non concedere"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRevoking(false)}>
                Annulla
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() =>
                void act("mandate:grant", {
                  requestId,
                  objectives: request.objectives,
                  priorities: request.priorities,
                  scopeModuleIds: request.scopeModuleIds,
                  authorizedActions: request.authorizedActions,
                  limits: request.limits,
                })
              }
            >
              {hasMandate ? "Accetta la proposta" : "Concedi"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setInspector({ kind: "mandate" })}>
              Correggi
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRevoking(true)}>
              {hasMandate ? "Revoca" : "Non concedere"}
            </Button>
          </div>
        )
      ) : null}
    </CardFrame>
  );
}

export function DecisionCard({ requestId }: { requestId: string }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const [choice, setChoice] = useState<number | null>(null);
  const [freeText, setFreeText] = useState("");
  const request = project.document.decisionRequests.find((r) => r.id === requestId);
  if (!request) return null;
  const outcome = request.outcome;

  return (
    <CardFrame
      icon={<IconRosetteDiscountCheck stroke={1.8} />}
      title="Decisione"
      aside={<Badge tone={request.category === "destructive" ? "destructive" : "info"}>{request.category === "destructive" ? "Caso distruttivo" : "Scelta di prodotto"}</Badge>}
    >
      <p className="text-ui font-medium text-foreground">{request.question}</p>
      <Field label="Caso concreto">{request.concreteCase}</Field>
      <div className="mt-3 space-y-1.5">
        {request.alternatives.map((alternative, index) => {
          const chosen = outcome ? outcome.alternativeIndex === index : choice === index;
          return (
            <button
              key={alternative.behavior}
              type="button"
              disabled={Boolean(outcome)}
              onClick={() => {
                setChoice(index);
                setFreeText("");
              }}
              className={cn(
                "block w-full rounded-lg border px-3 py-2 text-left transition-colors",
                chosen
                  ? "border-[color:var(--color-text-accent)] bg-[color-mix(in_srgb,var(--color-text-accent)_7%,transparent)]"
                  : "border-[color:var(--color-border)] hover:bg-[var(--color-background-button-secondary-hover)]",
                outcome && !chosen && "opacity-60",
              )}
            >
              <div className="text-ui text-foreground">{alternative.behavior}</div>
              <div className="mt-0.5 text-ui-sm text-muted-foreground">Esempio: {alternative.example}</div>
              {alternative.consequence ? <div className="mt-0.5 text-ui-sm text-muted-foreground">Conseguenza: {alternative.consequence}</div> : null}
            </button>
          );
        })}
      </div>
      {outcome ? (
        <div className="mt-3 flex items-center gap-2 text-ui-sm text-muted-foreground">
          <span>
            Decisione {outcome.decisionId} · versione {outcome.version}
          </span>
          <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "decision", id: outcome.decisionId })}>
            Apri nel Patto
          </button>
          {outcome.alternativeIndex === null ? <span className="truncate">· «{outcome.answer}»</span> : null}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <TextArea
            value={freeText}
            onChange={(event) => {
              setFreeText(event.target.value);
              if (event.target.value) setChoice(null);
            }}
            placeholder="Oppure rispondi con parole tue"
            aria-label="La tua decisione"
            className="min-h-12"
          />
          <Button
            size="sm"
            disabled={choice === null && !freeText.trim()}
            onClick={() =>
              void act("decision:answer", {
                requestId,
                alternativeIndex: choice,
                freeText: choice === null ? freeText.trim() : null,
              })
            }
          >
            Registra la decisione
          </Button>
        </div>
      )}
    </CardFrame>
  );
}
