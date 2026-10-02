import { createContext } from "react";
import type * as React from "react";
import { cn } from "@/lib/cn";

/**
 * A chat line that opens in place (a settled card, a requested action, a context rollover). Closed, the line is one
 * row with its hover. Open, the line and what it opens are one card: the line is the card's header, so nothing is
 * drawn twice and no second box appears under the first (person's note of 1 October 2026).
 */
export const FOLD_SHEET = "my-2";

/** The card the open line and what it opens make together; closed, it draws nothing. */
export function FoldCard({ open, children }: { open: boolean; children: React.ReactNode }) {
  return <div className={cn(open && "chat-card overflow-hidden p-1")}>{children}</div>;
}

/** The line: the hover marks it only while it is a row of its own; open, it is the header of the card. */
export const foldLine = (open: boolean) =>
  cn(
    "flex w-full min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left text-ui transition-colors",
    !open && "hover:bg-[var(--color-background-button-secondary-hover)]",
  );

/** What the line opens, aligned with the line's icon. */
export const FOLD_BODY = "px-1.5 pt-1 pb-2";

/** Inside an open line a card drops its own frame and header: the line already names it and says how it ended. */
export const InFold = createContext(false);
