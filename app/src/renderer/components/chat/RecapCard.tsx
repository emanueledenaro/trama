import { IconChevronRight, IconHourglass, IconListDetails } from "@tabler/icons-react";
import type { RecapFact, RecapNeed } from "@shared/domain";
import { Badge } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import { useWaiting } from "@/components/WaitingView";
import { formatTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useUi } from "@/lib/store";
import { CardFrame, Field } from "./Cards";
import { ReferenceText } from "./ReferenceText";
import { DelegatedChoices } from "./Delegation";

/**
 * The Coordinator's recap in the chat (A03): the milestones, what it did, what it does, what it needs from the person.
 * Trama wrote it from the records and the card shows it as written; only the items of "Aspetta te" follow the present,
 * so an item already answered no longer opens.
 */

/** A line of "Cosa ho fatto": the issue or pull request it names opens in the inspector. */
function FactLine({ fact }: { fact: RecapFact }) {
  const setInspector = useUi((s) => s.setInspector);
  const marker = fact.number === null ? -1 : fact.text.indexOf(`#${fact.number}`);
  if (marker < 0) {
    return (
      <li className="break-words">
        <ReferenceText text={fact.text} />
      </li>
    );
  }
  const token = `#${fact.number}`;
  return (
    <li className="break-words">
      <ReferenceText text={fact.text.slice(0, marker)} />
      <button
        type="button"
        className="text-[var(--color-text-accent)] underline-offset-2 hover:underline"
        onClick={() => setInspector({ kind: "issue", number: fact.number! })}
      >
        {token}
      </button>
      <ReferenceText text={fact.text.slice(marker + token.length)} />
    </li>
  );
}

function NeedRow({ need, waiting }: { need: RecapNeed; waiting: boolean }) {
  const t = useT();
  const setInspector = useUi((s) => s.setInspector);
  const text = (
    <span className="min-w-0 flex-1 break-words">
      <span className="text-foreground">{need.label}</span>
      <Sep />
      <span className="text-muted-foreground">
        <ReferenceText text={need.title} links={!waiting} />
      </span>
    </span>
  );
  return (
    <li className="py-1" data-testid="recap-need" data-waiting={waiting ? "true" : "false"}>
      {waiting ? (
        // The whole line opens the item in Aspetta te (issue #338).
        <button
          type="button"
          title={t("waiting.reference.open")}
          className="group flex w-full items-start gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-[var(--color-background-button-secondary-hover)] focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
          onClick={() => setInspector({ kind: "waiting", key: need.key })}
        >
          <IconHourglass className="mt-0.5 size-3.5 shrink-0 text-[var(--color-text-accent)]" stroke={1.8} />
          <span className="sr-only">{t("waiting.reference.open")}: </span>
          {text}
          <IconChevronRight aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-foreground" stroke={1.8} />
        </button>
      ) : (
        <div className="cta-row">
          <span className="mr-auto flex min-w-0 flex-1 items-start gap-2">
            <IconHourglass className="mt-0.5 size-3.5 shrink-0 text-[var(--color-text-accent)]" stroke={1.8} />
            {text}
          </span>
          <Badge tone="secondary">Non aspetta più</Badge>
        </div>
      )}
    </li>
  );
}

export function RecapCard({ recapId, title }: { recapId: string; title: string }) {
  const t = useT();
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
                  <ReferenceText text={text} />
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
        {recap.delegated?.length ? (
          <Field label={t("recap.delegated.title")}>
            <DelegatedChoices choices={recap.delegated} />
          </Field>
        ) : null}
        <Field label="Cosa faccio">
          <p data-testid="recap-doing">
            <ReferenceText text={recap.doing} />
          </p>
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
