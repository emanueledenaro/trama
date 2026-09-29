import { IconArrowLeft, IconExternalLink, IconFileText, IconFocus2, IconFolder, IconMessageCircle, IconShieldCheck } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { act, useUi } from "@/lib/store";
import { moduleQuestion } from "@/lib/askCoordinator";
import { OverlapMarkSign, OverlapRow } from "@/components/OverlapNotice";
import { Tooltip } from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n";
import { DisclosureSection, EmptyNote, InspectorSection } from "./Inspector";

const ROW =
  "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-ui text-foreground/89 transition-colors hover:bg-[var(--sidebar-accent)]";

/**
 * The modules of the project (issue #334): the map of today as the Moduli section of Mandato. Each module says whether
 * it is in the mandate and who works on it now; a module opens its detail.
 */
export function ModulesList() {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const openFocusStart = useUi((s) => s.openFocusStart);
  const { snapshot } = project;
  const marks = project.overlaps?.modules ?? {};
  const mandate = project.document.mandate;
  const inMandate = new Set(mandate?.status === "granted" ? mandate.scopeModuleIds : []);
  return (
    <div data-testid="modules">
      <p className="text-ui-sm text-foreground/90">
        {t("rules.modules.structure", {
          name: project.isDemo ? t("rules.modules.demoName") : snapshot.name,
          files: snapshot.totalFileCount,
          modules: snapshot.modules.length,
        })}
      </p>
      <p className="mt-1 text-ui-xs text-muted-foreground">{t("rules.modules.folders")}</p>
      {Object.keys(marks).length ? (
        <p className="mt-1 text-ui-xs text-muted-foreground" data-testid="map-overlap-legend">
          {t("rules.modules.overlapLegend")}
        </p>
      ) : null}
      {snapshot.warnings.length ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-ui-sm text-warning">
          {snapshot.warnings.slice(0, 5).map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      <div className="cta-row mt-3">
        <Button size="sm" variant="outline" className="max-w-full" title={t("focus.openProject")} onClick={() => openFocusStart({ kind: "project" })}>
          <IconFocus2 stroke={1.8} /> <span className="truncate">{t("focus.openProject")}</span>
        </Button>
      </div>
      {snapshot.modules.length === 0 ? <EmptyNote>{t("rules.modules.empty")}</EmptyNote> : null}
      <div className="-mx-2 mt-2 flex flex-col gap-0.5" role="listbox" aria-label={t("rules.modules.title")} onKeyDown={moveFocusWithArrows}>
        {snapshot.modules.map((module) => (
          <button
            key={module.id}
            type="button"
            role="option"
            aria-selected={false}
            className={ROW}
            data-in-mandate={inMandate.has(module.id) ? "true" : "false"}
            onClick={() => setInspector({ kind: "module", id: module.id })}
          >
            <IconFolder className="size-4 shrink-0 text-muted-foreground" stroke={1.6} />
            <span className="min-w-0 flex-1 truncate">{module.name}</span>
            {inMandate.has(module.id) ? (
              <Tooltip label={t("rules.modules.inMandate")}>
                <span className="inline-flex shrink-0 items-center text-[var(--color-text-accent)]" data-testid="module-in-mandate">
                  <IconShieldCheck className="size-3.5" stroke={1.8} aria-hidden />
                  <span className="sr-only">{t("rules.modules.inMandate")}</span>
                </span>
              </Tooltip>
            ) : null}
            <OverlapMarkSign mark={marks[module.id]} />
            <span className="shrink-0 text-ui-xs text-muted-foreground/70">{t("rules.modules.files", { count: module.files.length })}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A module (issue #334): its files first, then who works on it, with the detected dependencies in a closed section. */
export function ModuleView({ id }: { id: string }) {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const askCoordinator = useUi((s) => s.askCoordinator);
  const openFocusStart = useUi((s) => s.openFocusStart);
  const [dependenciesOpen, setDependenciesOpen] = useState(false);
  const module = project.snapshot.modules.find((m) => m.id === id);
  const fileMarks = project.overlaps?.files ?? {};
  const moduleOverlaps = (project.overlaps?.items ?? []).filter((item) => item.modules.some((m) => m.id === id));
  if (!module) return <div className="p-4"><EmptyNote>{t("rules.module.gone")}</EmptyNote></div>;
  const inMandate = project.document.mandate?.status === "granted" && project.document.mandate.scopeModuleIds.includes(module.id);
  return (
    <>
      <div className="px-4 pt-3">
        <button type="button" className="inline-flex items-center gap-1 text-ui-sm text-muted-foreground hover:text-foreground" onClick={() => setInspector({ kind: "map" })}>
          <IconArrowLeft className="size-3.5" /> {t("rules.module.back")}
        </button>
        <h3 className="mt-2 text-ui-lg font-medium text-foreground">{module.name}</h3>
        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{module.relativePath}</p>
        <p className="mt-2 text-ui text-foreground/90">{module.summary}</p>
        <p className="mt-1 text-ui-sm text-muted-foreground" data-testid="module-mandate">
          {inMandate ? t("rules.module.inMandate") : t("rules.module.outOfMandate")}
        </p>
        <div className="cta-row mt-3">
          {/* Issue #338: the examination is secondary, an icon with its name; "Chiedi" with its icon fits the narrow side
              bar, and its tooltip and name keep the whole question. */}
          <IconButton size="icon-sm" label={t("focus.openModule")} icon={<IconFocus2 stroke={1.8} />} onClick={() => openFocusStart({ kind: "module", moduleId: module.id })} />
          <Tooltip label={t("rules.module.ask")}>
            <Button size="sm" variant="outline" aria-label={t("rules.module.ask")} onClick={() => askCoordinator(moduleQuestion(module.name), { moduleId: module.id })}>
              <IconMessageCircle stroke={1.8} /> {t("rules.module.askShort")}
            </Button>
          </Tooltip>
        </div>
      </div>
      <InspectorSection title={`${t("rules.module.files")} (${module.files.length})`}>
        <div className="-mx-2 flex flex-col gap-0.5" data-testid="module-files">
          {module.files.map((file) => (
            <button key={file.id} type="button" className={ROW} onClick={() => setInspector({ kind: "file", path: file.relativePath })}>
              <IconFileText className="size-3.5 shrink-0 text-muted-foreground" stroke={1.7} />
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{file.relativePath.slice(module.relativePath === "." ? 0 : module.relativePath.length + 1)}</span>
              <OverlapMarkSign mark={fileMarks[file.relativePath]} />
              <span className="shrink-0 text-ui-xs text-muted-foreground/70">{file.lineCount}</span>
            </button>
          ))}
        </div>
      </InspectorSection>
      {moduleOverlaps.length ? (
        <InspectorSection title={t("rules.module.colleagues")}>
          <div data-testid="module-overlaps" className="divide-y divide-[color:var(--app-surface-divider)]">
            {moduleOverlaps.map((item) => (
              <OverlapRow key={item.id} item={item} />
            ))}
          </div>
        </InspectorSection>
      ) : null}
      <DisclosureSection
        title={t("rules.module.dependencies")}
        count={module.dependencies.length}
        open={dependenciesOpen}
        onToggle={() => setDependenciesOpen(!dependenciesOpen)}
        testId="module-dependencies"
      >
        {module.dependencies.length ? (
          <div className="flex flex-wrap gap-1">
            {module.dependencies.map((d) => (
              <span key={d} className="rounded-md bg-[var(--color-background-button-secondary)] px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {d}
              </span>
            ))}
          </div>
        ) : (
          <EmptyNote>{t("rules.module.noDependencies")}</EmptyNote>
        )}
      </DisclosureSection>
    </>
  );
}

export function FilePreview({ path }: { path: string }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const [contents, setContents] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const module = project.snapshot.modules.find((m) => m.files.some((f) => f.relativePath === path));
  const fileOverlaps = (project.overlaps?.items ?? []).filter((item) => item.level !== "module" && item.files.includes(path));

  useEffect(() => {
    let current = true;
    setContents(null);
    setFailed(false);
    void act("project:readFile", { relativePath: path }).then((text) => {
      if (!current) return;
      if (text === undefined) setFailed(true);
      else setContents(text);
    });
    return () => {
      current = false;
    };
  }, [path]);

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-3 pb-2">
        {module ? (
          <button type="button" className="inline-flex items-center gap-1 text-ui-sm text-muted-foreground hover:text-foreground" onClick={() => setInspector({ kind: "module", id: module.id })}>
            <IconArrowLeft className="size-3.5" /> {module.name}
          </button>
        ) : null}
        <div className="mt-2 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground">{path}</p>
          <OverlapMarkSign mark={project.overlaps?.files[path]} />
          <button type="button" className="sidebar-icon-button size-6 rounded-md" aria-label="Mostra nella cartella" onClick={() => void act("project:revealInFolder", { relativePath: path })}>
            <IconExternalLink className="size-3.5" />
          </button>
        </div>
      </div>
      {fileOverlaps.length ? (
        <div className="px-4 pb-2" data-testid="file-overlaps">
          {fileOverlaps.map((item) => (
            <OverlapRow key={item.id} item={item} detailed={false} />
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        {failed ? <EmptyNote>Il file non è disponibile per la lettura.</EmptyNote> : null}
        {contents !== null ? (
          <pre className="rounded-xl bg-[var(--app-chat-code-surface)] p-3 font-mono text-[11.5px] leading-[1.55] text-foreground/90">
            <code>
              {contents.split("\n").map((line, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity beyond their position.
                <div key={index} className="flex">
                  <span className="mr-3 w-8 shrink-0 text-right text-muted-foreground/40 select-none">{index + 1}</span>
                  <span className="whitespace-pre">{line}</span>
                </div>
              ))}
            </code>
          </pre>
        ) : null}
      </div>
    </div>
  );
}

/** Up and down arrows move the focus between the options of a list, as in a native list. */
function moveFocusWithArrows(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
  const options = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')];
  if (!options.length) return;
  const index = options.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? options.length - 1
        : event.key === "ArrowDown"
          ? Math.min(options.length - 1, index + 1)
          : Math.max(0, index < 0 ? 0 : index - 1);
  options[next]!.focus();
  event.preventDefault();
}
