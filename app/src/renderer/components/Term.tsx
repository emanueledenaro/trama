import type * as React from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { useLanguage, useT } from "@/lib/i18n";
import { type InterfaceTerm, TERM_KEYS, splitAtTerm } from "@shared/interfaceTerms";

/**
 * A word of the interface that a new person may not know, with its definition in one sentence on hover or focus.
 * Use it where the term first appears in a view; the definitions are in the catalogs and come from CONTEXT.md.
 * `children` is the text as the surrounding sentence writes it ("fette", "il mandato"); without it the term's own name shows.
 */
export function Term({ term, children, className, inControl = false }: { term: InterfaceTerm; children?: React.ReactNode; className?: string; inControl?: boolean }) {
  const t = useT();
  return (
    <Tooltip label={t(TERM_KEYS[term].hint)}>
      <span
        // A keyboard reaches the definition too; the dotted line says that the word explains itself. Inside a button
        // or a tab the control itself takes the focus, and the definition shows on hover.
        tabIndex={inControl ? undefined : 0}
        data-term={term}
        className={cn("cursor-help underline decoration-dotted decoration-from-font underline-offset-2 outline-none focus-visible:rounded-sm focus-visible:ring-1 focus-visible:ring-ring", className)}
      >
        {children ?? t(TERM_KEYS[term].name)}
      </span>
    </Tooltip>
  );
}

/**
 * A text already translated, with the first appearance of a term marked as a Term. A text that does not have the term
 * (a language that says it another way) shows as it is, without the definition.
 */
export function Glossed({ term, children, inControl = false }: { term: InterfaceTerm; children: string; inControl?: boolean }) {
  const language = useLanguage();
  const parts = splitAtTerm(language, term, children);
  if (!parts) return <>{children}</>;
  return (
    <>
      {parts[0]}
      <Term term={term} inControl={inControl}>
        {parts[1]}
      </Term>
      {parts[2]}
    </>
  );
}
