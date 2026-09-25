// Layout and classes follow Synara's SidebarSearchPalette (github.com/Emanuele-web04/synara, MIT License).
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  IconBrain,
  IconCircleDot,
  IconFileDiff,
  IconFileText,
  IconFolder,
  IconFolderPlus,
  IconGitPullRequest,
  IconPencilPlus,
  IconPlugConnected,
  IconRosetteDiscountCheck,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconSitemap,
  IconUsersGroup,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import type * as React from "react";
import { mentionCandidates } from "@shared/mentions";
import { cn } from "@/lib/cn";
import { act, type InspectorTarget, useUi } from "@/lib/store";

interface PaletteItem {
  id: string;
  group: string;
  label: string;
  meta?: string;
  icon: React.ReactNode;
  run: () => void;
}

const ICON = "size-3.5 shrink-0 text-muted-foreground";

export function SearchPalette() {
  const open = useUi((s) => s.dialog === "search");
  const setDialog = useUi((s) => s.setDialog);
  const app = useUi((s) => s.app);
  const setInspector = useUi((s) => s.setInspector);
  const focusComposer = useUi((s) => s.focusComposer);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setDialog(useUi.getState().dialog === "search" ? null : "search");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setDialog]);

  const items = useMemo<PaletteItem[]>(() => {
    if (!app) return [];
    const close = () => setDialog(null);
    const inspect = (target: InspectorTarget) => () => {
      setInspector(target);
      close();
    };
    const project = app.project;
    const actions: PaletteItem[] = [
      ...(project
        ? [
            { id: "write", label: "Scrivi al Coordinatore", icon: <IconPencilPlus className={ICON} />, run: () => (close(), focusComposer()) },
            { id: "map", label: "Mappa del progetto", icon: <IconSitemap className={ICON} />, run: inspect({ kind: "map" }) },
            { id: "pact", label: "Patto", icon: <IconRosetteDiscountCheck className={ICON} />, run: inspect({ kind: "pact" }) },
            { id: "mandate", label: "Mandato", icon: <IconShieldCheck className={ICON} />, run: inspect({ kind: "mandate" }) },
            { id: "team", label: "Team", icon: <IconUsersGroup className={ICON} />, run: inspect({ kind: "team" }) },
            { id: "work", label: "Lavoro", icon: <IconFileDiff className={ICON} />, run: inspect({ kind: "work" }) },
            { id: "group", label: "Il lavoro del gruppo", icon: <IconGitPullRequest className={ICON} />, run: inspect({ kind: "group" }) },
            { id: "issues", label: "Issue", icon: <IconCircleDot className={ICON} />, run: inspect({ kind: "issues" }) },
            { id: "memory", label: "Memoria del Coordinatore", icon: <IconBrain className={ICON} />, run: inspect({ kind: "memory" }) },
          ]
        : []),
      { id: "open", label: "Apri progetto…", icon: <IconFolderPlus className={ICON} />, run: () => (close(), void act("project:openDialog", undefined)) },
      { id: "connections", label: "Collegamenti", icon: <IconPlugConnected className={ICON} />, run: () => { setDialog(null); useUi.getState().openSettings("connections"); } },
      { id: "settings", label: "Impostazioni", icon: <IconSettings className={ICON} />, run: () => { setDialog(null); useUi.getState().openSettings("general"); } },
    ].map((item) => ({ ...item, group: "Azioni" }));
    const projects: PaletteItem[] = app.recentProjects.map((recent) => ({
      id: `project:${recent.id}`,
      group: "Progetti",
      label: recent.name,
      meta: recent.path,
      icon: <IconFolder className={ICON} />,
      run: () => (close(), void act("project:open", { path: recent.path })),
    }));
    const text = query.trim().toLowerCase();
    const filter = (list: PaletteItem[]) => (text ? list.filter((i) => i.label.toLowerCase().includes(text) || i.meta?.toLowerCase().includes(text)) : list);
    const objects: PaletteItem[] =
      project && text
        ? mentionCandidates(text, { modules: project.snapshot.modules, issues: project.github.issues, decisions: project.document.decisions })
            .slice(0, 20)
            .map((candidate) => {
              const { kind, key } = candidate.mention;
              const target: InspectorTarget =
                kind === "module" ? { kind: "module", id: key } : kind === "issue" ? { kind: "issue", number: Number(key) } : kind === "decision" ? { kind: "decision", id: key } : { kind: "file", path: key };
              return {
                id: `${kind}:${key}`,
                group: "Nel progetto",
                label: candidate.title,
                meta: candidate.subtitle,
                icon: kind === "file" ? <IconFileText className={ICON} /> : kind === "module" ? <IconFolder className={ICON} /> : kind === "issue" ? <IconCircleDot className={ICON} /> : <IconRosetteDiscountCheck className={ICON} />,
                run: inspect(target),
              };
            })
        : [];
    return [...filter(actions), ...filter(projects), ...objects];
  }, [app, query, setDialog, setInspector, focusComposer]);

  const groups = [...new Set(items.map((i) => i.group))];
  const selected = Math.min(index, Math.max(0, items.length - 1));

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(value) => setDialog(value ? "search" : null)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/15 transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 dark:bg-black/35" />
        <DialogPrimitive.Popup className="fixed top-[14vh] left-1/2 z-50 flex max-h-[26rem] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-[color:var(--color-border-light)] bg-[var(--color-background-surface)] text-[var(--color-text-foreground)] shadow-lg outline-none transition-[scale,opacity] duration-200 data-[ending-style]:scale-98 data-[ending-style]:opacity-0 data-[starting-style]:scale-98 data-[starting-style]:opacity-0">
          <DialogPrimitive.Title className="sr-only">Cerca in Trama</DialogPrimitive.Title>
          <div className="flex items-center border-b border-border/70 ps-3.5">
            <IconSearch className="size-4 shrink-0 text-muted-foreground" stroke={1.7} />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const step = event.key === "ArrowDown" ? 1 : -1;
                  setIndex((selected + step + items.length) % Math.max(1, items.length));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  items[selected]?.run();
                }
              }}
              placeholder="Cerca progetti, moduli, file, issue, decisioni e azioni"
              aria-label="Cerca in Trama"
              className="font-system-ui h-11 w-full min-w-0 bg-transparent px-3 font-sans text-ui-lg text-foreground outline-none placeholder:text-muted-foreground/70"
            />
          </div>
          <div className="min-h-0 overflow-y-auto px-1.5 pb-2" role="listbox" aria-label="Risultati">
            {items.length === 0 ? <p className="px-4 pt-3 pb-2 text-ui text-muted-foreground/80">Nessun risultato.</p> : null}
            {groups.map((group) => (
              <div key={group}>
                <div className="flex items-center justify-between px-2.5 pt-2 pb-1 text-ui-xs font-normal text-muted-foreground/70">{group}</div>
                {items
                  .filter((item) => item.group === group)
                  .map((item) => {
                    const position = items.indexOf(item);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        aria-selected={position === selected}
                        onMouseEnter={() => setIndex(position)}
                        onClick={item.run}
                        className={cn(
                          "flex min-h-[30px] w-full cursor-pointer items-center gap-3 rounded-[20px] px-2.5 text-left text-foreground",
                          position === selected && "bg-zinc-500/8 dark:bg-zinc-400/10",
                        )}
                      >
                        {item.icon}
                        <span className="min-w-0 flex-1 truncate text-ui">{item.label}</span>
                        {item.meta ? <span className="max-w-[45%] shrink-0 truncate text-ui-meta text-muted-foreground/70">{item.meta}</span> : null}
                      </button>
                    );
                  })}
              </div>
            ))}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
