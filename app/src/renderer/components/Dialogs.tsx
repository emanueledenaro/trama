import { cn } from "@/lib/cn";
import { useState } from "react";
import { parseRepositoryInput } from "@shared/onboarding";
import { Button, FilledScope } from "@/components/ui/button";
import { Input, Label, TextArea } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { SearchPalette } from "@/components/SearchPalette";
import { FocusStartDialog } from "@/components/focus/FocusStartDialog";
import { useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";

/**
 * The actions of a dialog: on the right, the primary last. The window has one filled button, the one of Aspetta te
 * (ADR 0018), so a dialog draws its primary as an outline.
 */
function DialogActions({ children }: { children: React.ReactNode }) {
  return (
    <FilledScope allowed={false}>
      <div className="cta-row">{children}</div>
    </FilledScope>
  );
}

function CreateProjectDialog() {
  const t = useT();
  const open = useUi((s) => s.dialog === "createProject");
  const setDialog = useUi((s) => s.setDialog);
  const [name, setName] = useState("");
  const [idea, setIdea] = useState("");
  // The private repository on GitHub, on by default once GitHub CLI is connected (2 October 2026).
  const ghReady = useUi((s) => s.app?.gitHubCli.status === "ready");
  const [github, setGithub] = useState<boolean | null>(null);
  const withGithub = ghReady && (github ?? true);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => setDialog(value ? "createProject" : null)}
      title={t("dialogs.create.title")}
      description={t("dialogs.create.description")}
      footer={
        <DialogActions>
          <Button variant="ghost" onClick={() => setDialog(null)}>
            {t("dialogs.cancel")}
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={() =>
              void act("project:create", { name, idea, github: withGithub }).then(() => {
                setName("");
                setIdea("");
                setDialog(null);
              })
            }
          >
            {t("dialogs.chooseFolder")}
          </Button>
        </DialogActions>
      }
    >
      <div className="space-y-4 pt-2">
        <div>
          <Label>{t("dialogs.create.name")}</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <Label>{t("dialogs.create.idea")}</Label>
          <TextArea value={idea} onChange={(e) => setIdea(e.target.value)} />
        </div>
        <label className={cn("flex items-start gap-2 text-ui", ghReady ? "cursor-pointer" : "text-muted-foreground")} data-testid="create-github">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-[var(--color-text-accent)]"
            checked={withGithub}
            disabled={!ghReady}
            onChange={(e) => setGithub(e.target.checked)}
          />
          <span>
            {t("dialogs.create.github")}
            <span className="block text-ui-xs text-muted-foreground">{t(ghReady ? "dialogs.create.githubHint" : "dialogs.create.githubOff")}</span>
          </span>
        </label>
      </div>
    </Dialog>
  );
}

/** Clones a GitHub repository into a folder the person picks, then opens it (B02). */
function CloneProjectDialog() {
  const t = useT();
  const open = useUi((s) => s.dialog === "cloneProject");
  const setDialog = useUi((s) => s.setDialog);
  const gh = useUi((s) => s.app?.gitHubCli.status ?? "unknown");
  const [repository, setRepository] = useState("");
  const parsed = parseRepositoryInput(repository);
  const submit = () => {
    if (!parsed) return;
    setDialog(null);
    void act("project:clone", { repository: parsed }).then(() => setRepository(""));
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => setDialog(value ? "cloneProject" : null)}
      title={t("dialogs.clone.title")}
      description={t("dialogs.clone.description")}
      footer={
        <DialogActions>
          <Button variant="ghost" onClick={() => setDialog(null)}>
            {t("dialogs.cancel")}
          </Button>
          <Button disabled={!parsed} onClick={submit}>
            {t("dialogs.chooseFolder")}
          </Button>
        </DialogActions>
      }
    >
      <div className="space-y-4 pt-2">
        <div>
          <Label>{t("dialogs.clone.repository")}</Label>
          <Input
            value={repository}
            onChange={(e) => setRepository(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder={t("dialogs.clone.placeholder")}
            aria-invalid={repository.trim() !== "" && !parsed}
            autoFocus
          />
        </div>
        {/* An invalid repository is an error: it reads in the system red. */}
        <p className={repository.trim() && !parsed ? "text-ui-xs text-destructive" : "text-ui-xs text-muted-foreground"} data-testid="clone-hint">
          {repository.trim() && !parsed ? t("dialogs.clone.invalid") : gh === "ready" ? t("dialogs.clone.ghReady") : t("dialogs.clone.ghMissing")}
        </p>
      </div>
    </Dialog>
  );
}

export function Dialogs() {
  return (
    <>
      <CreateProjectDialog />
      <CloneProjectDialog />
      <SearchPalette />
      <FocusStartDialog />
    </>
  );
}
