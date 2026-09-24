import { IconArrowLeft, IconExternalLink, IconFileText, IconFolder, IconMessageCircle } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { act, useUi } from "@/lib/store";
import { EmptyNote, InspectorSection } from "./Inspector";

const ROW =
  "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-ui text-foreground/89 transition-colors hover:bg-[var(--sidebar-accent)]";

export function MapView() {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const { snapshot } = project;
  return (
    <>
      <InspectorSection title="Struttura rilevata">
        <p className="text-ui text-foreground/90">
          {project.isDemo ? "Negozio di esempio" : snapshot.name}: {snapshot.totalFileCount} file sorgente in {snapshot.modules.length} moduli.
        </p>
        <p className="mt-1 text-ui-sm text-muted-foreground">
          I moduli seguono le cartelle del repository e non provano una responsabilità architetturale.
        </p>
        {snapshot.warnings.length ? (
          <ul className="mt-2 list-disc space-y-0.5 pl-4 text-ui-sm text-warning">
            {snapshot.warnings.slice(0, 5).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
      </InspectorSection>
      <InspectorSection title="Moduli">
        {snapshot.modules.length === 0 ? <EmptyNote>Nessun file sorgente riconosciuto.</EmptyNote> : null}
        <div className="-mx-2 flex flex-col gap-0.5" role="listbox" aria-label="Moduli" onKeyDown={moveFocusWithArrows}>
          {snapshot.modules.map((module) => (
            <button
              key={module.id}
              type="button"
              role="option"
              aria-selected={false}
              className={ROW}
              onClick={() => setInspector({ kind: "module", id: module.id })}
            >
              <IconFolder className="size-4 shrink-0 text-muted-foreground" stroke={1.6} />
              <span className="min-w-0 flex-1 truncate">{module.name}</span>
              <span className="shrink-0 text-ui-xs text-muted-foreground/70">{module.files.length} file</span>
            </button>
          ))}
        </div>
      </InspectorSection>
    </>
  );
}

export function ModuleView({ id }: { id: string }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const focusComposer = useUi((s) => s.focusComposer);
  const module = project.snapshot.modules.find((m) => m.id === id);
  if (!module) return <div className="p-4"><EmptyNote>Il modulo non esiste più dopo l'ultima scansione.</EmptyNote></div>;
  const inMandate = project.document.mandate?.status === "granted" && project.document.mandate.scopeModuleIds.includes(module.id);
  return (
    <>
      <div className="px-4 pt-3">
        <button type="button" className="inline-flex items-center gap-1 text-ui-sm text-muted-foreground hover:text-foreground" onClick={() => setInspector({ kind: "map" })}>
          <IconArrowLeft className="size-3.5" /> Mappa
        </button>
        <h3 className="mt-2 text-ui-lg font-medium text-foreground">{module.name}</h3>
        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{module.relativePath}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => focusComposer(module.id)}>
            <IconMessageCircle stroke={1.8} /> Chiedi al Coordinatore su questo modulo
          </Button>
        </div>
      </div>
      <InspectorSection title="Panoramica">
        <p className="text-ui text-foreground/90">{module.summary}</p>
        <p className="mt-1 text-ui-sm text-muted-foreground">{inMandate ? "Il modulo rientra nel mandato." : "Il modulo non rientra nel mandato attuale."}</p>
      </InspectorSection>
      <InspectorSection title="Dipendenze rilevate">
        {module.dependencies.length ? (
          <div className="flex flex-wrap gap-1">
            {module.dependencies.map((d) => (
              <span key={d} className="rounded-md bg-[var(--color-background-button-secondary)] px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {d}
              </span>
            ))}
          </div>
        ) : (
          <EmptyNote>Nessuna dipendenza rilevata.</EmptyNote>
        )}
      </InspectorSection>
      <InspectorSection title={`File (${module.files.length})`}>
        <div className="-mx-2 flex flex-col gap-0.5">
          {module.files.map((file) => (
            <button key={file.id} type="button" className={ROW} onClick={() => setInspector({ kind: "file", path: file.relativePath })}>
              <IconFileText className="size-3.5 shrink-0 text-muted-foreground" stroke={1.7} />
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{file.relativePath.slice(module.relativePath === "." ? 0 : module.relativePath.length + 1)}</span>
              <span className="shrink-0 text-ui-xs text-muted-foreground/70">{file.lineCount}</span>
            </button>
          ))}
        </div>
      </InspectorSection>
    </>
  );
}

export function FilePreview({ path }: { path: string }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const [contents, setContents] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const module = project.snapshot.modules.find((m) => m.files.some((f) => f.relativePath === path));

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
          <button type="button" className="sidebar-icon-button size-6 rounded-md" aria-label="Mostra nella cartella" onClick={() => void act("project:revealInFolder", { relativePath: path })}>
            <IconExternalLink className="size-3.5" />
          </button>
        </div>
      </div>
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
