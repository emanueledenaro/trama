import { IconCircleCheck, IconLock, IconPlayerSkipForward } from "@tabler/icons-react";
import type { StepState, StepStatus } from "@shared/onboarding";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";

export const STATUS_LABEL: Record<StepStatus, string> = {
  done: "Fatto",
  pending: "Da fare",
  checking: "Verifica in corso",
  skipped: "Saltato",
  blocked: "Non disponibile",
};

export function StepIcon({ status, index, current }: { status: StepStatus; index: number; current: boolean }) {
  if (status === "done") return <IconCircleCheck className="size-4 text-success" stroke={1.8} aria-hidden />;
  if (status === "checking") return <Spinner className="size-3.5" />;
  if (status === "skipped") return <IconPlayerSkipForward className="size-3.5 text-muted-foreground/70" stroke={1.8} aria-hidden />;
  if (status === "blocked") return <IconLock className="size-3.5 text-muted-foreground/70" stroke={1.8} aria-hidden />;
  return (
    <span
      className={cn(
        "flex size-4 items-center justify-center rounded-full border text-[10px] leading-none",
        current ? "border-[color:var(--color-text-accent)] text-[var(--color-text-accent)]" : "border-[color:var(--color-border-heavy)] text-muted-foreground",
      )}
    >
      {index + 1}
    </span>
  );
}

/** One step with its real state; the detail says what Trama observed or what is missing. */
export function StepRow({
  step,
  index,
  current,
  expanded,
  onToggle,
  children,
}: {
  step: StepState;
  index: number;
  current: boolean;
  expanded: boolean;
  onToggle?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <li
      data-step={step.id}
      data-status={step.status}
      className={cn("rounded-lg transition-colors", expanded && "bg-[var(--color-background-button-secondary)]")}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={!onToggle}
        aria-expanded={onToggle ? expanded : undefined}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-ui disabled:cursor-default"
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          <StepIcon status={step.status} index={index} current={current} />
        </span>
        <span className={cn("min-w-0 flex-1 truncate", step.status === "done" ? "text-foreground/75" : "text-foreground")}>{step.title}</span>
        {step.optional ? <span className="shrink-0 text-ui-xs text-muted-foreground/70">facoltativo</span> : null}
        <span className={cn("shrink-0 text-ui-xs", step.status === "done" ? "text-success" : "text-muted-foreground")}>{STATUS_LABEL[step.status]}</span>
      </button>
      {expanded ? (
        <div className="px-2.5 pb-2.5 pl-9">
          <p className="text-ui-sm text-muted-foreground">{step.detail}</p>
          {children ? <div className="cta-row mt-2">{children}</div> : null}
        </div>
      ) : null}
    </li>
  );
}
