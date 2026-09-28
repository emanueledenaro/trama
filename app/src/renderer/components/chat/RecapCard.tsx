import { IconHourglass, IconListDetails } from "@tabler/icons-react";
import type { RecapFact, RecapNeed } from "@shared/domain";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import { useWaiting } from "@/components/WaitingView";
import { formatTime } from "@/lib/format";
import { useUi } from "@/lib/store";
import { CardFrame, Field } from "./Cards";

/**
 * The Coordinator's recap in the chat (A03): the milestones, what it did, what it does, what it needs from the person.
 * Trama wrote it from the records and the card shows it as written; only the items of "Aspetta te" follow the present,
 * so an item already answered no longer opens.
 */

/** A line of "Cosa ho fatto": the issue or pull request it names opens in the inspector. */
function FactLine({ fact }: { fact: RecapFact }) {
  const setInspector = useUi((s) => s.setInspector);
  const marker = fact.number === null ? -1 : fact.text.indexOf(`#${fact.number}`);
  if (marker < 0) return <li className="break-words">{fact.text}</li>;
  const token = `#${fact.number}`;
  return (
    <li className="break-words">
      {fact.text.slice(0, marker)}
      <button
        type="button"
        className="text-[var(--color-text-accent)] underline-offset-2 hover:underline"
        onClick={() => setInspector({ kind: "issue", number: fact.number! })}
      >
        {token}
      </button>
      {fact.text.slice(marker + token.length)}
    </li>
  );
}

function NeedRow({ need, waiting }: { need: RecapNeed; waiting: boolean }) {
  const setInspector = useUi((s) => s.setInspector);
  return (
    <li className="cta-row py-1" data-testid="recap-need" data-waiting={waiting ? "true" : "false"}>
      <span className="mr-auto flex min-w-0 flex-1 items-start gap-2">
        <IconHourglass className="mt-0.5 size-3.5 shrink-0 text-[var(--color-text-accent)]" stroke={1.8} />
        <span className="min-w-0 break-words">
          <span className="text-foreground">{need.label}</span>
          <Sep />
          <span className="text-muted-foreground">{need.title}</span>
        </span>
      </span>
      {waiting ? (
        <Button size="xs" variant="outline" onClick={() => setInspector({ kind: "waiting", key: need.key })}>
          Apri in Aspetta te
        </Button>
      ) : (
        <Badge tone="secondary">Non aspetta più</Badge>
      )}
    </li>
  );
}

export function RecapCard({ recapId, title }: { recapId: string; title: string }) {
  const recap = useUi((s) => s.app?.project?.document.recap?.recaps.find((r) => r.id === recapId) ?? null);
  const waiting = useWaiting();
  if (!recap) {
    return (
      <CardFrame icon={<IconListDetails stroke={1.8} />} title={title}>
        <p className="text-ui text-muted-foreground">Questo riepilogo non è più conservato. Le mosse restano in Attività.</p>
      </CardFrame>
    );
  }
  const open = new Set(waiting.map((item) => item.key));
  return (
    <CardFrame
      icon={<IconListDetails stroke={1.8} />}
      title={title}
      anchor="recap"
      aside={<span className="shrink-0 text-ui-xs text-muted-foreground">{formatTime(recap.at)}</span>}
    >
      <div data-testid="recap-card" data-reason={recap.reason}>
        {recap.milestones.length ? (
          <Field label={recap.milestones.length === 1 ? "Traguardo" : "Traguardi"}>
            <ul className="list-disc space-y-0.5 pl-4" data-testid="recap-milestones">
              {recap.milestones.map((text) => (
                <li key={text} className="break-words">
                  {text}
                </li>
              ))}
            </ul>
          </Field>
        ) : null}
        <Field label="Cosa ho fatto">
          {recap.done.length ? (
            <ul className="list-disc space-y-0.5 pl-4" data-testid="recap-done">
              {recap.done.map((fact, index) => (
                <FactLine key={`${index}-${fact.text}`} fact={fact} />
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground" data-testid="recap-done">
              Niente di nuovo dall'ultimo riepilogo.
            </p>
          )}
        </Field>
        <Field label="Cosa faccio">
          <p data-testid="recap-doing">{recap.doing}</p>
        </Field>
        <Field label="Cosa mi serve da te">
          {recap.needs.length ? (
            <ul className="divide-y divide-[color:var(--app-surface-divider)]" data-testid="recap-needs">
              {recap.needs.map((need) => (
                <NeedRow key={need.key} need={need} waiting={open.has(need.key)} />
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground" data-testid="recap-needs">
              Niente: per ora vado avanti da solo.
            </p>
          )}
        </Field>
      </div>
    </CardFrame>
  );
}
