import { IconCopy, IconGitPullRequest, IconMessage } from "@tabler/icons-react";
import { useState } from "react";
import { colleagueLabel, colleagueMessage, linesLabel, OVERLAP_LABEL, type OverlapItem, type OverlapLevel, type OverlapMark, overlapSummary } from "@shared/overlap";
import { Button } from "@/components/ui/button";
import { Badge, TextArea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { errorText, useUi } from "@/lib/store";

/**
 * Overlap warnings (G03): the three levels of decision 3 and the message to the colleague of decision 10. Trama
 * prepares the message; only the person sends it, as a comment on the colleague's pull request or by copying it.
 * Nothing here stops the work.
 */

const LEVEL_TONE = { module: "info", file: "warning", conflict: "destructive" } as const;

export function OverlapBadge({ level }: { level: OverlapLevel }) {
  return <Badge tone={LEVEL_TONE[level]}>{OVERLAP_LABEL[level]}</Badge>;
}

const MARK_TEXT: Record<OverlapMark["level"], string> = {
  touched: "Toccato da",
  module: "Stesso modulo di",
  file: "Stesso file di",
  conflict: "Conflitto con",
};

const MARK_DOT: Record<OverlapMark["level"], string> = {
  touched: "bg-muted-foreground/45",
  module: "bg-info",
  file: "bg-warning",
  conflict: "bg-destructive",
};

/** The sign on a module or a file of the map: who else works there, and how it meets the person's work. */
export function OverlapMarkSign({ mark }: { mark: OverlapMark | undefined }) {
  if (!mark) return null;
  const text = `${MARK_TEXT[mark.level]} ${mark.people.join(", ")}`;
  return (
    <span className="inline-flex max-w-[45%] shrink-0 items-center gap-1 text-ui-xs text-muted-foreground" title={text} data-overlap={mark.level}>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", MARK_DOT[mark.level])} />
      <span className="truncate">{mark.people.join(", ")}</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}

/** The person's name and the branch of the side of the work the item is about, for the message. */
function useSelfSide(item: OverlapItem): { name: string; branch: string | null } {
  const self = useUi((s) => s.app?.project?.presence?.self?.record ?? null);
  const agent = item.mine ? self?.agents.find((a) => a.name === item.mine) : null;
  return { name: self?.name ?? "io", branch: item.mine ? (agent?.branch ?? null) : (self?.activeBranch ?? null) };
}

/** Decision 10: the message ready to edit, sent only by the person. */
export function ColleagueMessage({ item, onClose }: { item: OverlapItem; onClose: () => void }) {
  const self = useSelfSide(item);
  const canComment = useUi((s) => Boolean(s.app?.project?.github.repository && s.app.project.github.status === "ready"));
  const [text, setText] = useState(() => colleagueMessage(item, self));
  const [done, setDone] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const pull = canComment ? item.pullRequest : null;
  const copy = () => void navigator.clipboard.writeText(text).then(() => setDone("Messaggio copiato: incollalo nel canale del team."));
  const send = () => {
    if (!pull) return;
    setSending(true);
    // Said sent only when GitHub accepted it; a failure shows in the toast and the text stays.
    window.trama
      .invoke("presence:commentPullRequest", { number: pull.number, body: text })
      .then(
        () => setDone(`Commento inviato sulla pull request #${pull.number}.`),
        (error) => useUi.getState().setToast(errorText(error)),
      )
      .finally(() => setSending(false));
  };
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-[color:var(--color-border)] p-2.5" data-testid="colleague-message">
      <p className="text-ui-xs text-muted-foreground">
        {pull
          ? `Trama ha preparato un commento per la pull request #${pull.number} di ${item.colleague.name}. Parte solo se lo invii tu.`
          : `Trama ha preparato un messaggio per ${item.colleague.name}. Copialo nel canale del team, se ti va.`}
      </p>
      <TextArea aria-label={`Messaggio per ${item.colleague.name}`} rows={6} value={text} onChange={(event) => setText(event.target.value)} />
      {done ? <p className="text-ui-xs text-success" data-testid="colleague-message-done">{done}</p> : null}
      <div className="cta-row">
        <Button size="xs" variant="ghost" onClick={onClose}>
          Chiudi
        </Button>
        {pull ? (
          <>
            <Button size="xs" variant="outline" onClick={copy}>
              <IconCopy /> Copia
            </Button>
            <Button size="xs" disabled={sending || !text.trim()} onClick={send}>
              <IconGitPullRequest /> Commenta la PR #{pull.number}
            </Button>
          </>
        ) : (
          <Button size="xs" disabled={!text.trim()} onClick={copy}>
            <IconCopy /> Copia il messaggio
          </Button>
        )}
      </div>
    </div>
  );
}

/** Files with the lines in conflict, when the probe found them. */
function FileList({ item }: { item: OverlapItem }) {
  if (item.level === "module" || !item.files.length) return null;
  return (
    <ul className="mt-1 flex flex-wrap gap-1" aria-label="File in comune">
      {item.files.slice(0, 8).map((file) => (
        <li key={file} className="rounded-md bg-[var(--color-background-button-secondary)] px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {file}
          {item.lines[file]?.length ? <span className="font-sans">, {linesLabel(item.lines[file]!)}</span> : null}
        </li>
      ))}
      {item.files.length > 8 ? <li className="text-ui-xs text-muted-foreground">e altri {item.files.length - 8}</li> : null}
    </ul>
  );
}

/** One overlap: its level, the summary, the files and, on request, the message to the colleague. */
export function OverlapRow({ item, detailed = true }: { item: OverlapItem; detailed?: boolean }) {
  const [writing, setWriting] = useState(false);
  return (
    <div className="py-1.5" data-testid="overlap-item" data-level={item.level}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <OverlapBadge level={item.level} />
        <span className="min-w-0 flex-1 text-ui-sm text-foreground/90">{overlapSummary(item)}</span>
        {item.level !== "module" && !writing ? (
          <div className="cta-row ml-auto">
            <Button size="xs" variant="outline" onClick={() => setWriting(true)}>
              <IconMessage /> Scrivi a {item.colleague.name}
            </Button>
          </div>
        ) : null}
      </div>
      {detailed ? <FileList item={item} /> : null}
      {detailed && item.colleague.branch ? (
        <p className="mt-0.5 text-ui-xs text-muted-foreground">
          {colleagueLabel(item.colleague)} è su <span className="font-mono">{item.colleague.branch}</span>
          {item.colleague.task ? `, per "${item.colleague.task.title}"` : ""}
          {item.pullRequest ? `, pull request #${item.pullRequest.number}` : ""}.
        </p>
      ) : null}
      {writing ? <ColleagueMessage item={item} onClose={() => setWriting(false)} /> : null}
    </div>
  );
}
