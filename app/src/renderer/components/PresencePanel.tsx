import { IconGitBranch } from "@tabler/icons-react";
import { isAgentColor } from "@shared/identity";
import { freshnessLabel, type PresenceEntry, type PresenceView } from "@shared/presence";
import { AgentName } from "@/components/AgentIdentity";
import { Toggle } from "@/components/settings/SettingsView";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { act } from "@/lib/store";

/**
 * The presence of the open project (G01): the consent switch with its pause, in Impostazioni and in Gruppo
 * (decision 6), and the picture of who works on what, with names, branches and paths only (decision 1).
 */

export function presenceStatusLine(view: PresenceView | null | undefined): string {
  if (!view) return "Trama sta leggendo la presenza.";
  if (view.mode === "local") return "Senza remoto la presenza mostra solo te e i tuoi agenti, su questo computer.";
  const consent = view.consent;
  if (consent?.choice === "shared" && consent.paused) return "In pausa: i colleghi vedono solo quando ti hanno visto l'ultima volta.";
  if (consent?.choice === "shared" && view.canShare === false) return "Hai solo la lettura: vedi i colleghi senza condividere la tua presenza.";
  if (consent?.choice === "shared") return "Condividi branch, percorsi dei file toccati e lavoro in corso, mai il contenuto dei file.";
  return "Non condividi la tua presenza: vedi quella dei colleghi che la condividono.";
}

export function PresenceControls({ view, consentChoice }: { view: PresenceView | null | undefined; consentChoice: "shared" | "declined" | null }) {
  const sharing = consentChoice === "shared";
  const paused = sharing && Boolean(view?.consent?.paused);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {sharing ? (
        <Button size="xs" variant="ghost" onClick={() => void act("presence:pause", { paused: !paused })}>
          {paused ? "Riprendi" : "Metti in pausa"}
        </Button>
      ) : null}
      <Toggle label="Condividi la presenza" checked={sharing} onChange={(share) => void act("presence:consent", { share, proposal: null })} />
    </div>
  );
}

function Person({ entry }: { entry: PresenceEntry }) {
  const record = entry.record;
  const now = new Date();
  return (
    <div className="px-2 py-1.5" data-testid="presence-entry">
      <div className="flex items-center gap-2 text-ui">
        <span className="min-w-0 flex-1 truncate text-foreground/90">
          {entry.self ? `${record.name} (tu)` : record.name}
        </span>
        <Badge tone={entry.status === "active" ? "success" : "secondary"}>{freshnessLabel(entry, now)}</Badge>
      </div>
      {record.activeBranch ? (
        <div className="mt-0.5 flex items-center gap-1 text-ui-xs text-muted-foreground">
          <IconGitBranch className="size-3 shrink-0" stroke={1.8} />
          <span className="min-w-0 truncate">
            <span className="font-mono">{record.activeBranch}</span>
            {record.alsoOn.length ? `, anche su ${record.alsoOn.slice(0, 3).join(", ")}` : ""}
          </span>
        </div>
      ) : null}
      {record.task ? <div className="mt-0.5 truncate text-ui-xs text-muted-foreground">{record.task.title}</div> : null}
      {record.files.length ? (
        <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground" title={record.files.join("\n")}>
          {record.files.slice(0, 3).join(", ")}
          {record.files.length > 3 ? ` e altri ${record.files.length - 3}` : ""}
        </div>
      ) : null}
      {record.agents.map((agent) => (
        <div key={agent.id} className="mt-1 ml-3 flex items-center gap-1.5 text-ui-xs text-muted-foreground">
          <AgentName agent={{ name: agent.name, color: isAgentColor(agent.color) ? agent.color : "blue", tag: agent.tag, competence: agent.tag }} />
          {agent.branch ? <span className="truncate font-mono">{agent.branch}</span> : null}
        </div>
      ))}
    </div>
  );
}

export function PresenceList({ view }: { view: PresenceView | null | undefined }) {
  if (!view) return null;
  return (
    <div data-testid="presence-list">
      {view.self ? <Person entry={view.self} /> : null}
      {view.others.map((entry) => (
        <Person key={entry.record.user} entry={entry} />
      ))}
      {view.mode !== "local" && !view.others.length ? <p className="px-2 py-1 text-ui-xs text-muted-foreground">Nessun collega condivide la presenza.</p> : null}
    </div>
  );
}
