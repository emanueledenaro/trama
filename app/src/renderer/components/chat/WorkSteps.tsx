// Derived from third-party MIT code; see THIRD_PARTY_NOTICES.md.
import {
  IconAlertTriangle,
  IconBolt,
  IconBrain,
  IconChevronRight,
  IconFileText,
  IconShieldLock,
  IconTerminal2,
  IconTool,
} from "@tabler/icons-react";
import { useState } from "react";
import { isReadOutsideScopeTitle } from "@shared/codex";
import { readableFailure } from "@shared/providerFailure";
import { formatDuration } from "@shared/timeline";
import type { TechnicalStep, WorkRow } from "@shared/technicalSteps";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/store";
import { AgentName } from "@/components/AgentIdentity";
import { ReferenceText } from "./ReferenceText";
import { useT } from "@/lib/i18n";

/**
 * The steps of a turn of work (issue #271): the chat names the turn in one line, Activity lists its steps. Shared by
 * both, so the line and the entry in Activity say the same.
 */

export function DisclosureChevron({ open }: { open: boolean }) {
  return (
    <IconChevronRight
      className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out", open && "rotate-90 text-muted-foreground/70")}
      stroke={1.8}
    />
  );
}

function stepIcon(step: TechnicalStep) {
  const { title, tone } = step;
  if (isReadOutsideScopeTitle(title)) return <IconShieldLock className="text-destructive" />;
  if (tone === "error") return <IconAlertTriangle className="text-destructive" />;
  if (title.startsWith("Strumento") || title.includes(":")) return <IconTool />;
  if (title === "Ragionamento") return <IconBrain />;
  if (title.startsWith("Modifica")) return <IconFileText />;
  if (title === "Messaggio inviato al Coordinatore" || title.startsWith("Nota")) return <IconBolt />;
  return <IconTerminal2 />;
}

function StepRow({ step }: { step: TechnicalStep }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { title } = step;
  // A failed turn or assignment never shows a provider's JSON body, also in records written before P10.
  const details = step.tone === "error" && /non (?:è )?riuscit|in attesa del provider/i.test(title) ? step.details.map((detail) => readableFailure(t, detail)) : step.details;
  const isCommand = !title.includes(" ") || /^(git|ls|cat|rg|sed|grep|find|swift|npm|node|bun)\b/.test(title);
  return (
    <li className="group/tool-row" data-testid="technical-step" data-count={step.count}>
      <button
        type="button"
        disabled={!details.length}
        onClick={() => setOpen(!open)}
        className="flex w-full min-w-0 items-center gap-1.5 text-left text-muted-foreground transition-colors group-hover/tool-row:text-foreground disabled:cursor-default"
      >
        <span className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-3.5 [&>svg]:stroke-[1.8]">{stepIcon(step)}</span>
        <span className={cn("min-w-0 truncate leading-5", isCommand && "font-mono text-chat-code")}>{isCommand ? title : <ReferenceText text={title} links={false} />}</span>
        {step.count > 1 ? <span className="shrink-0 text-ui-xs text-muted-foreground/70 tabular-nums">×{step.count}</span> : null}
        {details.length ? <DisclosureChevron open={open} /> : null}
      </button>
      {open && details.length ? (
        <div className="mt-1 mb-1.5 ml-5.5 space-y-1.5 rounded-lg bg-[var(--app-chat-code-surface)] px-2.5 py-1.5 text-ui-xs whitespace-pre-wrap break-words text-muted-foreground">
          {details.map((detail, index) => (
            <div key={index} className={cn(index > 0 && "border-t border-[color:var(--app-surface-divider)] pt-1.5")}>
              <ReferenceText text={detail} />
            </div>
          ))}
        </div>
      ) : null}
    </li>
  );
}

/** The steps of a turn, grouped: without empty notes, with a run of the same step as one entry. */
export function StepList({ steps }: { steps: TechnicalStep[] }) {
  return (
    <ul className="space-y-1 text-ui-sm" data-testid="technical-steps">
      {steps.map((step) => (
        <StepRow key={step.id} step={step} />
      ))}
    </ul>
  );
}

/** The developer whose turn it is; null for the Coordinator's own turn. */
export function useWorkSpecialist(row: WorkRow) {
  return useUi((s) =>
    row.assignmentId ? (s.app?.project?.document.team.specialists.find((sp) => sp.assignments.some((a) => a.id === row.assignmentId)) ?? null) : null,
  );
}

/** Who worked and for how long, as the chat line and Activity both say it. */
export function WorkLabel({ row, avatar = true }: { row: WorkRow; avatar?: boolean }) {
  const t = useT();
  const specialist = useWorkSpecialist(row);
  // The specialist's identity leads the label (W15): avatar, name and tag in its color. A row of Activity shows the
  // avatar in its own column, so the label leaves it out there.
  const who = specialist ? <AgentName agent={specialist} avatar={avatar} size={32} className="mr-1" /> : null;
  const label = row.running
    ? specialist ? <>{who}sta lavorando</> : "Il Coordinatore sta lavorando"
    : row.durationMs !== null
      ? specialist ? <>{who}ha lavorato per {formatDuration(t, row.durationMs)}</> : `Ha lavorato per ${formatDuration(t, row.durationMs)}`
      : specialist
        ? <>{who}attività</>
        : "Attività";
  return <span className={cn(row.running && "shimmer-text")}>{label}</span>;
}
