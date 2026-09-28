import { useEffect, useState } from "react";
import { type MandateAction, type MandateSnapshot, pendingMandateRequest } from "@shared/domain";
import { FixedBansField, MandateCard } from "@/components/chat/Cards";
import { Button } from "@/components/ui/button";
import { Badge, Label, TextArea } from "@/components/ui/field";
import { formatDate } from "@/lib/format";
import { ACTION_LABELS, DELEGABLE_ACTIONS } from "@/lib/labels";
import { act, useUi } from "@/lib/store";
import { EmptyNote, InspectorSection } from "./Inspector";
import { Sep } from "@/components/ui/sep";
import { AgentName } from "@/components/AgentIdentity";
import { workStoppedBy } from "@shared/mandate";

/** What a restriction took away, in one line. */
function restrictionText(restriction: NonNullable<MandateSnapshot["restriction"]>, moduleName: (id: string) => string): string {
  const parts = [
    restriction.removedModuleIds.length ? `tolti ${restriction.removedModuleIds.map(moduleName).join(", ")}` : null,
    restriction.removedActions.length ? `tolte ${restriction.removedActions.map((a) => ACTION_LABELS[a].toLowerCase()).join(", ")}` : null,
  ].filter(Boolean);
  return `Ristretto: ${parts.join("; ")}.`;
}

const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

export function MandateView() {
  const project = useUi((s) => s.app?.project)!;
  const { mandate, mandateRequests } = project.document;
  const pending = pendingMandateRequest({ mandateRequests });
  const source = pending ?? (mandate?.status === "granted" ? mandate : null);
  const [objectives, setObjectives] = useState("");
  const [priorities, setPriorities] = useState("");
  const [limits, setLimits] = useState("");
  const [scope, setScope] = useState<string[]>([]);
  const [actions, setActions] = useState<MandateAction[]>(["plan"]);
  const [revocation, setRevocation] = useState("");
  const [editing, setEditing] = useState(false);
  // Revoking asks for a reason and shows what stops before it takes effect.
  const [revoking, setRevoking] = useState(false);
  const stopping = revoking ? workStoppedBy(project.document, null) : [];
  // Restricting keeps the mandate and takes modules or actions away (issue #244).
  const [restricting, setRestricting] = useState(false);
  const [keptModules, setKeptModules] = useState<string[]>([]);
  const [keptActions, setKeptActions] = useState<MandateAction[]>([]);
  const moduleName = (id: string) => project.snapshot.modules.find((m) => m.id === id)?.name ?? id;
  const startRestricting = () => {
    setKeptModules(mandate?.scopeModuleIds ?? []);
    setKeptActions(mandate?.authorizedActions ?? []);
    setRestricting(true);
  };
  const narrower =
    mandate?.status === "granted" &&
    keptModules.length > 0 &&
    keptActions.length > 0 &&
    (keptModules.length < mandate.scopeModuleIds.length || keptActions.length < mandate.authorizedActions.length);

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
              {mandate.status === "granted" ? `Mandato v${mandate.version}, ${mandate.scopeModuleIds.length} moduli` : "Mandato revocato"}
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
            <p>{mandate.restriction ? `Ristretto il ${formatDate(mandate.grantedAt)}.` : `Concesso il ${formatDate(mandate.grantedAt)}.`}</p>
            {mandate.restriction ? <p className="text-ui-sm text-muted-foreground" data-testid="mandate-restriction">{restrictionText(mandate.restriction, moduleName)}</p> : null}
            <div className="text-ui-sm text-muted-foreground">
              Obiettivi
              <ul className="list-disc pl-4 text-foreground/90">
                {mandate.objectives.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </div>
            <div className="text-ui-sm text-muted-foreground">
              Azioni
              <ul className="list-disc pl-4 text-foreground/90">
                {mandate.authorizedActions.map((a) => (
                  <li key={a}>{ACTION_LABELS[a]}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {/* Every mandate, also one granted before the fixed bans existed, excludes them (issue #244). */}
        <FixedBansField />
      </InspectorSection>
      {mandate?.status === "granted" ? (
        <InspectorSection
          title="Restringi il mandato"
          aside={!restricting ? <Button size="xs" variant="ghost" onClick={startRestricting}>Restringi</Button> : null}
        >
          {restricting ? (
            <div className="space-y-3" data-testid="mandate-restrict">
              <p className="text-ui-sm text-muted-foreground">Togli i moduli o le azioni che il Coordinatore non deve più usare. Il mandato resta in vigore; la restrizione vale dal suo prossimo turno.</p>
              <div>
                <Label>Moduli che restano</Label>
                <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-lg border border-input p-1">
                  {mandate.scopeModuleIds.map((id) => (
                    <label key={id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-ui hover:bg-[var(--sidebar-accent)]">
                      <input
                        type="checkbox"
                        className="accent-[var(--color-text-accent)]"
                        checked={keptModules.includes(id)}
                        onChange={(e) => setKeptModules(e.target.checked ? [...keptModules, id] : keptModules.filter((m) => m !== id))}
                      />
                      <span className="min-w-0 flex-1 truncate">{moduleName(id)}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <Label>Azioni che restano</Label>
                <div className="flex flex-col gap-1">
                  {mandate.authorizedActions.map((action) => (
                    <label key={action} className="flex cursor-pointer items-center gap-2 text-ui">
                      <input
                        type="checkbox"
                        className="accent-[var(--color-text-accent)]"
                        checked={keptActions.includes(action)}
                        onChange={(e) => setKeptActions(e.target.checked ? [...keptActions, action] : keptActions.filter((a) => a !== action))}
                      />
                      {ACTION_LABELS[action]}
                    </label>
                  ))}
                </div>
              </div>
              <div className="cta-row">
                <Button size="sm" variant="ghost" onClick={() => setRestricting(false)}>
                  Annulla
                </Button>
                <Button
                  size="sm"
                  disabled={!narrower}
                  onClick={() => void act("mandate:restrict", { scopeModuleIds: keptModules, authorizedActions: keptActions }).then(() => setRestricting(false))}
                >
                  Restringi il mandato
                </Button>
              </div>
            </div>
          ) : (
            <EmptyNote>Puoi togliere moduli o azioni senza revocare il mandato. Allargarlo resta una correzione.</EmptyNote>
          )}
        </InspectorSection>
      ) : null}
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
              <TextArea value={objectives} onChange={(e) => setObjectives(e.target.value)} aria-label="Obiettivi" />
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
            <div className="cta-row">
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
          {revoking ? (
            <div className="space-y-2" data-testid="mandate-revoke-confirm">
              <TextArea
                value={revocation}
                onChange={(e) => setRevocation(e.target.value)}
                placeholder="Perché lo revochi? Il Coordinatore legge il motivo."
                aria-label="Motivo della revoca"
                className="min-h-12"
                autoFocus
              />
              <p className="text-ui-sm text-muted-foreground">
                Senza mandato il Coordinatore legge e propone, ma non agisce.
                {stopping.length ? " Si fermano questi lavori:" : " Nessun lavoro in corso si ferma."}
              </p>
              {stopping.length ? (
                <ul className="list-disc space-y-0.5 pl-4 text-ui-sm text-foreground/90">
                  {stopping.map(({ specialist, assignment }) => (
                    <li key={assignment.id} className="break-words">
                      <AgentName agent={specialist} />
                      <Sep />
                      {assignment.objective}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="cta-row">
                <Button size="sm" variant="ghost" onClick={() => setRevoking(false)}>
                  Annulla
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={!revocation.trim()}
                  onClick={() =>
                    void act("mandate:revoke", { reason: revocation.trim() }).then(() => {
                      setRevocation("");
                      setRevoking(false);
                    })
                  }
                >
                  Revoca il mandato
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <EmptyNote>La revoca toglie il mandato in vigore e ferma il lavoro che copre. Una proposta del Coordinatore si rifiuta dalla sua scheda.</EmptyNote>
              <div className="cta-row">
                <Button size="sm" variant="outline" onClick={() => setRevoking(true)}>
                  Revoca il mandato
                </Button>
              </div>
            </div>
          )}
        </InspectorSection>
      ) : null}
      {mandate && mandate.history.length ? (
        <InspectorSection title="Versioni precedenti">
          <ol className="space-y-1.5 text-ui-sm text-muted-foreground">
            {[...mandate.history].reverse().map((snapshot) => (
              <li key={snapshot.version}>
                v{snapshot.version}<Sep />{formatDate(snapshot.grantedAt)}<Sep />{snapshot.restriction ? restrictionText(snapshot.restriction, moduleName) : snapshot.objectives.join(", ")}
              </li>
            ))}
          </ol>
        </InspectorSection>
      ) : null}
    </>
  );
}
