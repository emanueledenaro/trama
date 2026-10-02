import {
  IconBriefcase,
  IconFileDiff,
  IconGitBranch,
  IconListCheck,
  IconRosetteDiscountCheck,
  IconShieldCheck,
  IconUsersGroup,
} from "@/components/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import type { CandidateState } from "@shared/domain";
import { type SettledCard, settledCard } from "@shared/settledCards";
import type { TimelineRow } from "@shared/timeline";
import { Badge } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import { useT, withNodes, useLanguage } from "@/lib/i18n";
import { REVEAL_EVENT } from "@/lib/nextStep";
import { useUi } from "@/lib/store";
import { ReferenceText } from "./ReferenceText";
import { DisclosureChevron } from "./WorkSteps";
import { foldLine, FOLD_SHEET, FoldCard, InFold } from "./Fold";
import { cn } from "@/lib/cn";

function lineIcon(row: TimelineRow) {
  if (row.kind === "grillingRound") return <IconListCheck stroke={1.8} />;
  if (row.kind !== "card") return null;
  switch (row.cardKind) {
    case "decision":
      return <IconRosetteDiscountCheck stroke={1.8} />;
    case "mandate":
      return <IconShieldCheck stroke={1.8} />;
    case "teamProposal":
      return <IconUsersGroup stroke={1.8} />;
    case "plan":
      return <IconListCheck stroke={1.8} />;
    case "conflict":
      return <IconGitBranch stroke={1.8} />;
    case "assignment":
      return <IconBriefcase stroke={1.8} />;
    case "candidate":
      return <IconFileDiff stroke={1.8} />;
    default:
      return null;
  }
}

/** The settled line of a row, recomputed only when the records it reads change. */
function useSettled(row: TimelineRow): SettledCard | null {
  const t = useT();
  const project = useUi((s) => s.app?.project);
  const document = project?.document;
  const reports = project?.candidateReports;
  const others = project?.presence?.others;
  const language = useLanguage();
  return useMemo(() => {
    if (!document) return null;
    const candidateStates: Record<string, CandidateState> = {};
    for (const [id, report] of Object.entries(reports ?? {})) candidateStates[id] = report.state;
    return settledCard(t, document, row, { candidateStates, colleagues: (others ?? []).map((o) => o.record) });
  }, [document, reports, others, row]);
}

/**
 * A card that asks nothing more of the person, as one line of the chat (issue #271): the title, the subject, the
 * answer and how it ended. The line opens the full card, and so does a link or a next step that brings it into view.
 * A card still open stays whole.
 */
export function SettledOr({ row, children }: { row: TimelineRow; children: React.ReactNode }) {
  const t = useT();
  const settled = useSettled(row);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const anchor = ref.current?.closest("[data-anchors]");
    if (!anchor) return;
    const reveal = () => setOpen(true);
    anchor.addEventListener(REVEAL_EVENT, reveal);
    return () => anchor.removeEventListener(REVEAL_EVENT, reveal);
  }, [settled !== null]);
  if (!settled) return <>{children}</>;
  return (
    <div ref={ref} className={FOLD_SHEET} data-testid="settled-card" data-open={open || undefined}>
      <FoldCard open={open}>
        {/* The line is not a button: the subject's references are links of their own. */}
        <div
          onClick={() => setOpen(!open)}
          className={cn("group/settled cursor-pointer", foldLine(open))}
        >
          <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-3.5">{lineIcon(row)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate">
              <span className="text-foreground">
                {/* The title names its record, the id on hover (issue #270); the line itself opens the card. */}
                <ReferenceText text={settled.title} links={false} />
              </span>
              <Sep />
              <span className="text-muted-foreground">
                <ReferenceText text={settled.subject} />
              </span>
            </span>
            {settled.answer ? (
              <span className="block truncate text-ui-sm text-foreground/85" data-testid="settled-answer">
                {withNodes(t("chat.settled.chose"), { answer: <ReferenceText text={settled.answer} /> })}
              </span>
            ) : null}
          </span>
          <Badge tone={settled.outcome.tone}>{settled.outcome.label}</Badge>
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? t("chat.settled.close", { title: settled.title }) : t("chat.settled.open", { title: settled.title })}
            onClick={(event) => {
              event.stopPropagation();
              setOpen(!open);
            }}
            className="sidebar-icon-button size-5 shrink-0"
          >
            <DisclosureChevron open={open} />
          </button>
        </div>
        {open ? <InFold.Provider value={true}>{children}</InFold.Provider> : null}
      </FoldCard>
    </div>
  );
}
