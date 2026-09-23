import { useEffect, useState } from "react";
import type { MandateAction } from "@shared/domain";
import { MandateCard } from "@/components/chat/Cards";
import { Button } from "@/components/ui/button";
import { Badge, Label, TextArea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { ACTION_LABELS, DELEGABLE_ACTIONS } from "@/lib/labels";
import { act, useUi } from "@/lib/store";
import { EmptyNote, InspectorSection } from "./Inspector";

const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

export function MandateView() {
  const project = useUi((s) => s.app?.project)!;
  const { mandate, mandateRequests } = project.document;
  const pending = mandateRequests.find((r) => !r.resolution) ?? null;
  const source = pending ?? (mandate?.status === "granted" ? mandate : null);
  const [objectives, setObjectives] = useState("");
  const [priorities, setPriorities] = useState("");
  const [limits, setLimits] = useState("");
  const [scope, setScope] = useState<string[]>([]);
  const [actions, setActions] = useState<MandateAction[]>(["plan"]);
  const [revocation, setRevocation] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setObjectives(source?.objectives.join("\n") ?? "");
    setPriorities(source?.priorities.join("\n") ?? "");
    setLimits(source?.limits.join("\n") ?? "");
    setScope(source?.scopeModuleIds ?? []);
    setActions(source?.authorizedActions ?? ["plan"]);
    setEditing(Boolean(pending));
  }, [source?.objectives.join("|"), pending?.id]);

  const valid = lines(objectives).length > 0 && scope.length > 0 && actions.length > 0;
  const grant = () =>
    act("mandate:grant", {
      requestId: pending?.id ?? null,
      objectives: lines(objectives),
      priorities: lines(priorities),
      scopeModuleIds: scope,
      authorizedActions: actions,
      limits: lines(limits),
    }).then(() => setEditing(false));

  return (
    <>
      <InspectorSection
        title="Stato"
        aside={
          mandate ? (
            <Badge tone={mandate.status === "granted" ? "success" : "secondary"}>
              {mandate.status === "granted" ? `Mandato v${mandate.version} · ${mandate.scopeModuleIds.length} moduli` : "Mandato revocato"}
            </Badge>
          ) : null
        }
      >
        {!mandate ? (
          <EmptyNote>Nessun mandato concesso. Senza mandato il Coordinatore legge e propone, ma non agisce.</EmptyNote>
        ) : mandate.status === "revoked" ? (
          <p className="text-ui text-foreground/90">Revocato: {mandate.revocation?.reason}</p>
        ) : (
          <div className="space-y-1.5 text-ui text-foreground/90">
            <p>Concesso il {formatDate(mandate.grantedAt)}.</p>
            <p className="text-ui-sm text-muted-foreground">Obiettivi: {mandate.objectives.join(" · ")}</p>
            <p className="text-ui-sm text-muted-foreground">Azioni: {mandate.authorizedActions.map((a) => ACTION_LABELS[a]).join(" · ")}</p>
          </div>
        )}
      </InspectorSection>
      {pending ? (
        <InspectorSection title="Proposta del Coordinatore">
          <MandateCard requestId={pending.id} />
        </InspectorSection>
      ) : null}
      <InspectorSection
        title={mandate?.status === "granted" ? "Correggi il mandato" : "Concedi un mandato"}
        aside={!editing ? <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>{mandate?.status === "granted" ? "Correggi" : "Scrivi"}</Button> : null}
      >
        {editing ? (
          <div className="space-y-3">
            <div>
              <Label>Obiettivi, uno per riga</Label>
              <TextArea value={objectives} onChange={(e) => setObjectives(e.target.value)} />
            </div>
            <div>
              <Label>Priorità</Label>
              <TextArea value={priorities} onChange={(e) => setPriorities(e.target.value)} className="min-h-12" />
            </div>
            <div>
              <Label>Perimetro</Label>
              <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-lg border border-input p-1">
                {project.snapshot.modules.map((module) => (
                  <label key={module.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-ui hover:bg-[var(--sidebar-accent)]">
                    <input
                      type="checkbox"
                      className="accent-[var(--color-text-accent)]"
                      checked={scope.includes(module.id)}
                      onChange={(e) => setScope(e.target.checked ? [...scope, module.id] : scope.filter((id) => id !== module.id))}
                    />
                    <span className="min-w-0 flex-1 truncate">{module.name}</span>
                    <span className="truncate font-mono text-[10.5px] text-muted-foreground">{module.relativePath}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label>Azioni autorizzate</Label>
              <div className="flex flex-col gap-1">
                {DELEGABLE_ACTIONS.map((action) => (
                  <label key={action} className="flex cursor-pointer items-center gap-2 text-ui">
                    <input
                      type="checkbox"
                      className="accent-[var(--color-text-accent)]"
                      checked={actions.includes(action)}
                      onChange={(e) => setActions(e.target.checked ? [...actions, action] : actions.filter((a) => a !== action))}
                    />
                    {ACTION_LABELS[action]}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-ui-xs text-muted-foreground">Nuove funzioni e compromessi restano sempre alla persona.</p>
            </div>
            <div>
              <Label>Limiti</Label>
              <TextArea value={limits} onChange={(e) => setLimits(e.target.value)} className="min-h-12" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={!valid} onClick={() => void grant()}>
                {mandate?.status === "granted" ? "Salva correzione" : "Concedi mandato"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Annulla
              </Button>
            </div>
          </div>
        ) : (
          <EmptyNote>Il mandato definisce obiettivi, perimetro e azioni che il Coordinatore può svolgere senza chiedere.</EmptyNote>
        )}
      </InspectorSection>
      {mandate?.status === "granted" ? (
        <InspectorSection title="Revoca">
          <TextArea value={revocation} onChange={(e) => setRevocation(e.target.value)} placeholder="Motivo della revoca" className="min-h-12" />
          <Button
            size="sm"
            variant="destructive"
            className={cn("mt-2")}
            disabled={!revocation.trim()}
            onClick={() => void act("mandate:revoke", { reason: revocation.trim(), requestId: null }).then(() => setRevocation(""))}
          >
            Revoca mandato
          </Button>
        </InspectorSection>
      ) : null}
      {mandate && mandate.history.length ? (
        <InspectorSection title="Versioni precedenti">
          <ol className="space-y-1.5 text-ui-sm text-muted-foreground">
            {[...mandate.history].reverse().map((snapshot) => (
              <li key={snapshot.version}>
                v{snapshot.version} · {formatDate(snapshot.grantedAt)} · {snapshot.objectives.join(" · ")}
              </li>
            ))}
          </ol>
        </InspectorSection>
      ) : null}
    </>
  );
}
