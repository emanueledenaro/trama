import { IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react";
import { presenceLines, type PresenceView } from "@shared/presence";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { act } from "@/lib/store";

/**
 * The presence of the open project (G01): the consent switch with its pause, in Impostazioni and in Gruppo
 * (decision 6). The picture of who works on what is in the Gruppo view (G02).
 */

/** What the person does with the presence and why sharing does not work, one sentence each and never the same twice. */
export function PresenceStatus({ view }: { view: PresenceView | null | undefined }) {
  const t = useT();
  const [status, message] = presenceLines(t, view);
  return (
    <>
      {status}
      {message ? <span className="mt-1 block text-foreground/80">{message}</span> : null}
    </>
  );
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
  const t = useT();
  const sharing = consentChoice === "shared";
  const paused = sharing && Boolean(view?.consent?.paused);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {sharing ? (
        // Issue #338: "Sospendi la presenza" names what it pauses; both moves are icon and text.
        <Button size="xs" variant="ghost" onClick={() => void act("presence:pause", { paused: !paused })}>
          {paused ? <IconPlayerPlay /> : <IconPlayerPause />}
          {paused ? t("settings.presence.resume") : t("settings.presence.pause")}
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
