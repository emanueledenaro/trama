import { useEffect, useState } from "react";
import type { Candidate, InterfaceShot } from "@shared/domain";
import { Spinner } from "@/components/Spinner";
import { act } from "@/lib/store";

const SIDE: Record<InterfaceShot["side"], string> = { before: "Prima", after: "Dopo" };
const THEME: Record<InterfaceShot["theme"], string> = { light: "chiaro", dark: "scuro" };

/** One screenshot, read from Trama's data folder when the card shows it. */
function Shot({ candidateId, index, shot }: { candidateId: string; index: number; shot: InterfaceShot | undefined }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!shot) return;
    let live = true;
    void act("candidate:shot", { candidateId, index }).then((data) => {
      if (live && data) setUrl(data);
    });
    return () => {
      live = false;
    };
  }, [candidateId, index, shot]);
  return (
    <figure className="min-w-0" data-testid="interface-shot" data-side={shot?.side} data-theme={shot?.theme}>
      <div className="flex aspect-[16/10] items-center justify-center overflow-hidden rounded-md border border-[color:var(--color-border)] bg-[var(--app-chat-code-surface)]">
        {shot ? (
          url ? (
            <img src={url} alt={`${SIDE[shot.side]}, tema ${THEME[shot.theme]}: ${shot.name}`} className="size-full object-contain" />
          ) : (
            <Spinner />
          )
        ) : (
          <span className="px-2 text-center text-ui-xs text-muted-foreground">Nessuna schermata</span>
        )}
      </div>
    </figure>
  );
}

/**
 * The screenshots of a candidate that changes the interface (issue #247): for each screen, before and after side by
 * side, in light and in dark. While Trama captures them, and when it cannot, the field says so.
 */
export function InterfaceShotsField({ candidate }: { candidate: Candidate }) {
  const shots = candidate.interfaceShots;
  const current = shots?.snapshotId === candidate.snapshotId ? shots : null;
  if (!current || current.status === "capturing") {
    return (
      <p className="flex items-center gap-1.5 text-ui-sm text-muted-foreground" data-testid="interface-shots" data-status="capturing">
        <Spinner /> Trama sta facendo le schermate prima e dopo, in chiaro e in scuro.
      </p>
    );
  }
  if (current.status !== "ready") {
    return (
      <p className="text-ui-sm text-muted-foreground" data-testid="interface-shots" data-status={current.status}>
        {current.reason}
      </p>
    );
  }
  const names = [...new Set(current.shots.map((s) => s.name))];
  const find = (name: string, side: InterfaceShot["side"], theme: InterfaceShot["theme"]) => {
    const index = current.shots.findIndex((s) => s.name === name && s.side === side && s.theme === theme);
    return { index, shot: index >= 0 ? current.shots[index] : undefined };
  };
  return (
    <div className="space-y-3" data-testid="interface-shots" data-status="ready">
      {names.map((name) => (
        <div key={name}>
          <p className="mb-1 font-mono text-[11.5px] text-muted-foreground">{name}</p>
          <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 text-ui-xs text-muted-foreground">
            <span />
            <span>{SIDE.before}</span>
            <span>{SIDE.after}</span>
            {(["light", "dark"] as const).map((theme) => (
              <div key={theme} className="contents">
                <span className="capitalize">{THEME[theme]}</span>
                {(["before", "after"] as const).map((side) => {
                  const { index, shot } = find(name, side, theme);
                  return <Shot key={side} candidateId={candidate.id} index={index} shot={shot} />;
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
      {current.reason ? <p className="text-ui-xs text-muted-foreground">{current.reason}</p> : null}
    </div>
  );
}
