import type { PresenceView } from "@shared/presence";
import { Toggle } from "@/components/settings/SettingsView";
import { Button } from "@/components/ui/button";
import { act } from "@/lib/store";

/**
 * The presence of the open project (G01): the consent switch with its pause, in Impostazioni and in Gruppo
 * (decision 6). The picture of who works on what is in the Gruppo view (G02).
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

export function PresenceControls({
  view,
  consentChoice,
  showLabel = false,
}: {
  view: PresenceView | null | undefined;
  consentChoice: "shared" | "declined" | null;
  /** Writes the switch's name next to it, where no row label names it. */
  showLabel?: boolean;
}) {
  const sharing = consentChoice === "shared";
  const paused = sharing && Boolean(view?.consent?.paused);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {sharing ? (
        <Button size="xs" variant="ghost" onClick={() => void act("presence:pause", { paused: !paused })}>
          {paused ? "Riprendi" : "Metti in pausa"}
        </Button>
      ) : null}
      {showLabel ? (
        <span aria-hidden className="text-ui-sm text-foreground/80">
          Condividi la presenza
        </span>
      ) : null}
      <Toggle label="Condividi la presenza" checked={sharing} onChange={(share) => void act("presence:consent", { share, proposal: null })} />
    </div>
  );
}
