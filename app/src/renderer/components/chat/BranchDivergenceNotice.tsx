import { IconChevronDown, IconGitBranch } from "@tabler/icons-react";
import { useState } from "react";
import { divergenceQuestion, divergenceSummary } from "@shared/conflictScope";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/store";
import { useT } from "@/lib/i18n";

/**
 * The divergence of the project's branch from the default branch on GitHub (U02), said once for the whole project and
 * visible in every dialog, instead of the same conflict on every candidate. The way out is the Coordinator's work within
 * the mandate: the action puts the question in the composer and nothing leaves until the person sends it.
 */
export function BranchDivergenceNotice() {
  const t = useT();
  const divergence = useUi((s) => s.app?.project?.document.branchDivergence ?? null);
  const askCoordinator = useUi((s) => s.askCoordinator);
  const [open, setOpen] = useState(false);
  if (!divergence) return null;
  const files = divergence.conflictingFiles;
  return (
    <section aria-label="Avviso sul branch del progetto" className="chat-surface-divider shrink-0 px-3 sm:px-5" data-testid="branch-divergence">
      <div className="mx-auto flex w-full max-w-[var(--app-chat-max-width)] min-w-0 flex-col px-1 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex min-w-[12rem] flex-1 items-start gap-2">
            <IconGitBranch className="mt-0.5 size-4 shrink-0 text-warning" stroke={1.8} />
            <p className="min-w-0 text-ui-sm text-foreground/90" data-testid="branch-divergence-text">
              {divergenceSummary(t, divergence)}
            </p>
          </div>
          <div className="cta-row ml-auto">
            <Button size="xs" variant="ghost" aria-expanded={open} aria-controls="branch-divergence-files" onClick={() => setOpen(!open)}>
              {files.length === 1 ? "Mostra il file" : `Mostra i ${files.length} file`}
              <IconChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
            </Button>
            <Button size="xs" onClick={() => askCoordinator(divergenceQuestion(t, divergence))}>
              Chiedi al Coordinatore come riallineare
            </Button>
          </div>
        </div>
        {open ? (
          <div id="branch-divergence-files" className="mt-1.5 flex max-h-[30vh] flex-wrap gap-1 overflow-y-auto pl-6" data-testid="branch-divergence-files">
            {files.map((file) => (
              <span key={file} className="rounded-md bg-[var(--color-background-button-secondary)] px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {file}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
