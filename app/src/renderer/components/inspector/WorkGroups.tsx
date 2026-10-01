import { IconChevronDown, IconChevronRight } from "@/components/icons";
import { useState } from "react";

/** A row of a Lavoro list, the part of it that opens the detail, and its second line. */
export const ROW = "flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-[var(--sidebar-accent)]";
/** The part of a row that opens its detail, next to the row's own actions (never a button inside a button). */
export const ROW_MAIN = "flex min-w-0 flex-1 items-start gap-2 rounded-sm text-left outline-none focus-visible:ring-1 focus-visible:ring-ring";
export const META = "block truncate text-ui-xs text-muted-foreground";

/**
 * The groups inside a section of Lavoro: a small label with its count over rows that stay open, and a fold for what is
 * history or superseded, closed until the person opens it. One style, so slices and candidates read alike.
 */
export function GroupLabel({ label, count }: { label: string; count?: number }) {
  return (
    <h4 className="flex items-center gap-1.5 px-2 pt-2 pb-0.5 text-ui-xs font-medium text-muted-foreground first:pt-0.5">
      <span className="min-w-0 truncate">{label}</span>
      {count !== undefined ? <span className="shrink-0 font-normal tabular-nums text-muted-foreground/70">{count}</span> : null}
    </h4>
  );
}

/** A folded group inside a section: archived goals, done slices, replaced candidates, the branches on GitHub, the news. */
export function Fold({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid={testId} data-open={open ? "true" : "false"}>
      <button
        type="button"
        aria-expanded={open}
        className="flex h-7 w-full items-center gap-1 rounded-md px-2 text-left text-ui-sm text-muted-foreground hover:bg-[var(--sidebar-accent)] hover:text-foreground"
        onClick={() => setOpen(!open)}
      >
        {open ? <IconChevronDown className="size-3.5 shrink-0" stroke={1.8} /> : <IconChevronRight className="size-3.5 shrink-0" stroke={1.8} />}
        {label}
      </button>
      {open ? <div className="pl-2">{children}</div> : null}
    </div>
  );
}
