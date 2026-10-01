import { IconChevronDown, IconGitBranch } from "@/components/icons";
import { useState } from "react";
import { divergenceQuestion, divergenceSummary } from "@shared/conflictScope";
import type { BranchDivergence } from "@shared/domain";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { useUi } from "@/lib/store";

/**
 * The divergence of the project's branch from the default branch on GitHub (U02), said once for the whole project
 * instead of the same conflict on every candidate. The status bar counts the files in conflict and opens this panel
 * (issue #330) with the files already shown, one click from the bar (issue #332). The way out is the Coordinator's work within the mandate: the action puts the question in the
 * composer and nothing leaves until the person sends it.
 */
export function BranchDivergencePanel({ divergence, onDone, filesOpen = false }: { divergence: BranchDivergence; onDone: () => void; filesOpen?: boolean }) {
  const t = useT();
  const askCoordinator = useUi((s) => s.askCoordinator);
  const [open, setOpen] = useState(filesOpen);
  const files = divergence.conflictingFiles;
  return (
    <section aria-label={t("workbench.status.divergence")} className="flex min-w-0 flex-col p-3" data-testid="branch-divergence">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex min-w-[12rem] flex-1 items-start gap-2">
          <IconGitBranch className="mt-0.5 size-4 shrink-0 text-warning" stroke={1.8} />
          <p className="min-w-0 text-ui-sm text-foreground/90" data-testid="branch-divergence-text">
            {divergenceSummary(t, divergence)}
          </p>
        </div>
        <div className="cta-row ml-auto">
          {/* Issue #338: showing the files is secondary, an icon with its name; asking is the panel's primary, text, last. */}
          <IconButton
            label={t("divergence.showFiles", { count: files.length })}
            icon={<IconChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />}
            aria-expanded={open}
            aria-controls="branch-divergence-files"
            onClick={() => setOpen(!open)}
          />
          <Button
            size="xs"
            onClick={() => {
              askCoordinator(divergenceQuestion(t, divergence));
              onDone();
            }}
          >
            {t("divergence.ask")}
          </Button>
        </div>
      </div>
      {open ? (
        <div id="branch-divergence-files" className="mt-1.5 flex max-h-[30vh] flex-wrap gap-1 overflow-y-auto pl-6" data-testid="branch-divergence-files">
          {files.map((file) => (
            <span key={file} className="max-w-full rounded-md bg-[var(--color-background-button-secondary)] px-1.5 py-0.5 font-mono text-[11px] break-all text-muted-foreground">
              {file}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
