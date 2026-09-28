import { IconFocus2, IconFolder, IconFolders } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { errorText, type FocusStartTarget, useUi } from "@/lib/store";

const OPTION =
  "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui text-foreground/89 transition-colors hover:bg-[var(--sidebar-accent)] aria-checked:bg-[var(--sidebar-accent)] aria-checked:text-foreground";

const sameTarget = (a: FocusStartTarget, b: FocusStartTarget) => a.kind === b.kind && (a.kind === "project" || (b.kind === "module" && a.moduleId === b.moduleId));

/**
 * Focus mode on a module or the whole project (F03): the person picks the target and the fixed point, as code-review
 * asks. Trama checks both before anything starts; a fixed point that does not exist or an empty diff shows here.
 */
export function FocusStartDialog() {
  const t = useT();
  const open = useUi((s) => s.dialog === "focusMode");
  const initial = useUi((s) => s.focusStart);
  const setDialog = useUi((s) => s.setDialog);
  const modules = useUi((s) => s.app?.project?.snapshot.modules ?? []);
  const [target, setTarget] = useState<FocusStartTarget>(initial);
  const [fixedPoint, setFixedPoint] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTarget(initial);
    setError(null);
    setOpening(false);
    let live = true;
    void window.trama.invoke("focusMode:fixedPoints", undefined).then(
      (refs) => {
        if (!live) return;
        setSuggestions(refs);
        setFixedPoint((current) => current || refs[0] || "");
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [open, initial]);

  const submit = async () => {
    if (!fixedPoint.trim() || opening) return;
    setOpening(true);
    setError(null);
    try {
      const auditId = await window.trama.invoke("focusMode:open", { target, fixedPoint });
      await window.trama.invoke("focusMode:enter", { auditId });
      setDialog(null);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setOpening(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => setDialog(value ? "focusMode" : null)}
      title={t("focus.title")}
      description={t("focus.start.description")}
      icon={<IconFocus2 className="size-4 text-muted-foreground" stroke={1.7} />}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => setDialog(null)}>
            {t("focus.start.cancel")}
          </Button>
          <Button size="sm" disabled={!fixedPoint.trim() || opening} onClick={() => void submit()}>
            {t("focus.start.submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-3 pt-2" data-testid="focus-start">
        <div>
          <Label>{t("focus.start.what")}</Label>
          <div className="-mx-2 flex max-h-44 flex-col gap-0.5 overflow-y-auto" role="radiogroup" aria-label={t("focus.start.what")}>
            <button type="button" role="radio" aria-checked={target.kind === "project"} className={OPTION} onClick={() => setTarget({ kind: "project" })}>
              <IconFolders className="size-4 shrink-0 text-muted-foreground" stroke={1.6} />
              <span className="min-w-0 flex-1 truncate">{t("focus.start.project")}</span>
            </button>
            {modules.map((module) => {
              const option: FocusStartTarget = { kind: "module", moduleId: module.id };
              return (
                <button
                  key={module.id}
                  type="button"
                  role="radio"
                  aria-checked={sameTarget(target, option)}
                  className={OPTION}
                  onClick={() => setTarget(option)}
                >
                  <IconFolder className="size-4 shrink-0 text-muted-foreground" stroke={1.6} />
                  <span className="min-w-0 flex-1 truncate">{t("focus.start.module", { name: module.name })}</span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">{module.relativePath}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <Label>{t("focus.start.fixedPoint")}</Label>
          <Input
            value={fixedPoint}
            onChange={(e) => {
              setFixedPoint(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            placeholder={t("focus.start.placeholder")}
            aria-label={t("focus.start.fixedPoint")}
            aria-invalid={error !== null}
            aria-describedby="focus-start-note"
            className="font-mono"
            autoFocus
          />
          {suggestions.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1" aria-label={t("focus.start.suggestions")}>
              {suggestions.map((ref) => (
                <button
                  key={ref}
                  type="button"
                  className={cn(
                    "rounded-md border border-[color:var(--color-border)] px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground",
                    ref === fixedPoint.trim() && "border-ring/60 text-foreground",
                  )}
                  onClick={() => {
                    setFixedPoint(ref);
                    setError(null);
                  }}
                >
                  {ref}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {error ? (
          <p className="text-ui-sm text-destructive" role="alert" data-testid="focus-start-error">
            {error}
          </p>
        ) : (
          <p className="text-ui-xs text-muted-foreground" id="focus-start-note">
            {t("focus.start.note")}
          </p>
        )}
      </div>
    </Dialog>
  );
}
