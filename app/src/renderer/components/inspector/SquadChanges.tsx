import { IconDots } from "@/components/icons";
import { useState } from "react";
import type { ProjectDocument, Squad, SquadMergeProposal } from "@shared/domain";
import type { Translate } from "@shared/i18n";
import {
  type SquadChangeProblem,
  mergeNeedsChoice,
  mergeProblem,
  mergeProposal,
  renameProblem,
  splitBlocked,
  splitProblem,
  splitProposal,
  squadDevelopers,
} from "@shared/squadChanges";
import { developersAtWork, SQUAD_SIZE, teamSquads } from "@shared/squads";
import { AgentAvatar } from "@/components/AgentIdentity";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { PickerSelect } from "@/components/ui/picker";
import { Tooltip } from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";

/**
 * The person renames, merges and splits the squads from the Squads view (A11): a menu on each squad opens the change
 * under its header, with the reason when it cannot be made. The Coordinator's proposal of who stays in a merge asked in
 * the chat waits on top of the view.
 */

export type SquadEdit = "rename" | "merge" | "split";

const say = (t: Translate, found: SquadChangeProblem | null) => (found ? t(found.key, found.params) : null);

const checkbox = "accent-[var(--color-text-accent)]";
const optionRow = "flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-ui hover:bg-[var(--sidebar-accent)]";

/** The menu of a squad's changes; an action that cannot be made says why under its name. */
export function SquadMenu({ squad, onEdit }: { squad: Squad; onEdit: (edit: SquadEdit) => void }) {
  const t = useT();
  const document = useUi((s) => s.app?.project?.document)!;
  const others = teamSquads(document).filter((s) => s.id !== squad.id);
  const mergeBlocked = others.length ? null : t("teams.change.problem.noOther");
  const splitReason = say(t, splitBlocked(document, squad.id));
  const label = t("teams.squad.more", { squad: squad.name });
  return (
    <Menu>
      <Tooltip label={label}>
        <MenuTrigger aria-label={label} className="sidebar-icon-button inline-flex size-6 shrink-0 items-center justify-center rounded-md" data-testid="squad-menu">
          <IconDots className="size-4" stroke={1.8} />
        </MenuTrigger>
      </Tooltip>
      <MenuPopup align="end">
        <MenuItem onClick={() => onEdit("rename")}>{t("teams.squad.rename")}</MenuItem>
        <ReasonItem label={t("teams.squad.merge")} reason={mergeBlocked} onClick={() => onEdit("merge")} />
        <ReasonItem label={t("teams.squad.split")} reason={splitReason} onClick={() => onEdit("split")} />
      </MenuPopup>
    </Menu>
  );
}

function ReasonItem({ label, reason, onClick }: { label: string; reason: string | null; onClick: () => void }) {
  return (
    <MenuItem disabled={Boolean(reason)} onClick={onClick} className="max-w-72 flex-col items-start gap-0">
      <span>{label}</span>
      {reason ? <span className="text-ui-xs whitespace-normal text-muted-foreground">{reason}</span> : null}
    </MenuItem>
  );
}

/** Cancel and the change's own call to action, on the right, the change last (cta-row). */
function Actions({ onCancel, label, reason, onConfirm, busy }: { onCancel: () => void; label: string; reason: string | null; onConfirm: () => void; busy: boolean }) {
  const t = useT();
  return (
    <div className="cta-row">
      <Button size="sm" variant="ghost" onClick={onCancel}>
        {t("teams.squad.cancel")}
      </Button>
      <Button size="sm" disabled={Boolean(reason) || busy} onClick={onConfirm}>
        {label}
      </Button>
    </div>
  );
}

function Reason({ text }: { text: string | null }) {
  return text ? (
    <p className="text-ui-sm text-muted-foreground" data-testid="squad-change-reason">
      {text}
    </p>
  ) : null;
}

/** Runs the change and closes the form once it is made; a refusal of the main process shows as a toast. */
function useRun(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const run = (made: Promise<boolean | undefined>) => {
    setBusy(true);
    void made.then((ok) => {
      setBusy(false);
      if (ok) onDone();
    });
  };
  return { busy, run };
}

export function RenameSquad({ squad, onDone }: { squad: Squad; onDone: () => void }) {
  const t = useT();
  const document = useUi((s) => s.app?.project?.document)!;
  const [name, setName] = useState(squad.name);
  const reason = say(t, renameProblem(document, squad.id, name));
  const { busy, run } = useRun(onDone);
  const save = () => run(act("squad:rename", { squadId: squad.id, name: name.trim() }));
  return (
    <div className="mt-4 space-y-4 px-2" data-testid="rename-squad">
      <Input
        autoFocus
        aria-label={t("teams.squad.renameLabel")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !reason) save();
          if (e.key === "Escape") onDone();
        }}
      />
      {name.trim() !== squad.name ? <Reason text={reason} /> : null}
      <p className="text-ui-xs text-muted-foreground" title={squad.id}>
        {t("teams.squad.renameNote")}
      </p>
      <Actions onCancel={onDone} label={t("teams.squad.rename")} reason={reason} onConfirm={save} busy={busy} />
    </div>
  );
}

/** The developers of both squads with a box each, those at work fixed on: they stay with their work. */
function KeepList({ document, ids, keep, onChange }: { document: ProjectDocument; ids: string[]; keep: string[]; onChange: (keep: string[]) => void }) {
  const t = useT();
  const working = new Set(developersAtWork(document).map((s) => s.id));
  const people = ids.flatMap((id) => document.team.specialists.filter((s) => s.id === id));
  return (
    <div>
      <Label>{t("teams.squad.mergeKeep")}</Label>
      <div className="flex flex-col gap-0.5 rounded-lg border border-input p-1" data-testid="squad-keep">
        {people.map((s) => (
          <label key={s.id} className={optionRow} title={s.id}>
            <input
              type="checkbox"
              className={checkbox}
              checked={keep.includes(s.id)}
              disabled={working.has(s.id)}
              onChange={(e) => onChange(e.target.checked ? [...keep, s.id] : keep.filter((id) => id !== s.id))}
            />
            <AgentAvatar agent={s} size={20} />
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            {working.has(s.id) ? <span className="shrink-0 text-ui-xs text-muted-foreground">{t("teams.squad.atWork")}</span> : null}
          </label>
        ))}
      </div>
    </div>
  );
}

export function MergeSquad({ squad, onDone }: { squad: Squad; onDone: () => void }) {
  const t = useT();
  const document = useUi((s) => s.app?.project?.document)!;
  const others = teamSquads(document).filter((s) => s.id !== squad.id);
  const [fromId, setFromId] = useState(others.length === 1 ? others[0]!.id : "");
  const from = others.find((s) => s.id === fromId) ?? null;
  const [keep, setKeep] = useState<{ fromId: string; ids: string[] } | null>(null);
  // Trama's proposal of who stays, until the person changes it for this pair of squads.
  const kept = keep?.fromId === fromId ? keep.ids : from ? mergeProposal(document, squad.id, from.id) : [];
  const choose = from ? mergeNeedsChoice(document, squad.id, from.id) : false;
  const reason = from ? say(t, mergeProblem(document, squad.id, from.id, choose ? kept : null)) : null;
  const all = from ? [...squadDevelopers(document, squad), ...squadDevelopers(document, from)].map((s) => s.id) : [];
  const { busy, run } = useRun(onDone);
  const save = () => from && run(act("squad:merge", { intoId: squad.id, fromId: from.id, keepIds: choose ? kept : null }));
  return (
    <div className="mt-4 space-y-4 px-2" data-testid="merge-squad">
      <div>
        <Label>{t("teams.squad.mergeWith")}</Label>
        <PickerSelect
          label={t("teams.squad.mergeWith")}
          value={fromId}
          options={others.map((s) => ({ value: s.id, title: s.name }))}
          onChange={setFromId}
          className="w-full"
        />
      </div>
      {from ? <p className="text-ui-sm text-muted-foreground">{t("teams.squad.mergeNote", { from: from.name, into: squad.name })}</p> : null}
      {from && choose ? (
        <>
          <p className="text-ui-sm text-muted-foreground">{t("teams.squad.mergeChoose", { count: all.length, limit: SQUAD_SIZE })}</p>
          <KeepList document={document} ids={all} keep={kept} onChange={(ids) => setKeep({ fromId, ids })} />
        </>
      ) : null}
      <Reason text={reason} />
      <Actions onCancel={onDone} label={t("teams.squad.mergeConfirm")} reason={from ? reason : t("teams.change.problem.sameSquad")} onConfirm={save} busy={busy} />
    </div>
  );
}

export function SplitSquad({ squad, onDone }: { squad: Squad; onDone: () => void }) {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const document = project.document;
  const moduleName = (id: string) => project.snapshot.modules.find((m) => m.id === id)?.name ?? id;
  const [moduleIds, setModuleIds] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [name, setName] = useState("");
  // Trama proposes who goes with the areas, until the person picks.
  const developerIds = chosen ?? splitProposal(document, squad.id, moduleIds);
  const reason = say(t, splitProblem(document, squad.id, moduleIds, developerIds, name));
  const developers = squadDevelopers(document, squad);
  const { busy, run } = useRun(onDone);
  const save = () => run(act("squad:split", { squadId: squad.id, moduleIds, developerIds, name: name.trim() }));
  return (
    <div className="mt-4 space-y-4 px-2" data-testid="split-squad">
      <div>
        <Label>{t("teams.squad.splitAreas")}</Label>
        <div className="flex flex-col gap-0.5 rounded-lg border border-input p-1" data-testid="split-areas">
          {squad.moduleIds.map((id) => (
            <label key={id} className={optionRow} title={id}>
              <input
                type="checkbox"
                className={checkbox}
                checked={moduleIds.includes(id)}
                onChange={(e) => {
                  const next = e.target.checked ? [...moduleIds, id] : moduleIds.filter((m) => m !== id);
                  setModuleIds(next);
                  if (!name.trim() || name === moduleIds.map(moduleName).join(", ")) setName(next.map(moduleName).join(", "));
                }}
              />
              <span className="min-w-0 flex-1 truncate">{moduleName(id)}</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <Label>{t("teams.squad.splitDevelopers")}</Label>
        <div className="flex flex-col gap-0.5 rounded-lg border border-input p-1" data-testid="split-developers">
          {developers.map((s) => (
            <label key={s.id} className={optionRow} title={s.id}>
              <input
                type="checkbox"
                className={checkbox}
                checked={developerIds.includes(s.id)}
                onChange={(e) => setChosen(e.target.checked ? [...developerIds, s.id] : developerIds.filter((id) => id !== s.id))}
              />
              <AgentAvatar agent={s} size={20} />
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <Label>{t("teams.squad.splitName")}</Label>
        <Input aria-label={t("teams.squad.splitName")} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <p className="text-ui-xs text-muted-foreground">{t("teams.squad.splitNote")}</p>
      <Reason text={reason} />
      <Actions onCancel={onDone} label={t("teams.squad.splitConfirm")} reason={reason} onConfirm={save} busy={busy} />
    </div>
  );
}

/** The merge the person asked the Coordinator for, with more than three developers: who stays, to confirm or change. */
export function MergeProposalCard({ proposal }: { proposal: SquadMergeProposal }) {
  const t = useT();
  const document = useUi((s) => s.app?.project?.document)!;
  const into = teamSquads(document).find((s) => s.id === proposal.intoId);
  const from = teamSquads(document).find((s) => s.id === proposal.fromId);
  const [keep, setKeep] = useState(proposal.keepIds);
  const { busy, run } = useRun(() => undefined);
  if (!into || !from) return null;
  const all = [...squadDevelopers(document, into), ...squadDevelopers(document, from)].map((s) => s.id);
  const reason = say(t, mergeProblem(document, into.id, from.id, keep));
  return (
    <section className="space-y-4 border-b border-[color:var(--app-surface-divider)] px-4 py-4" data-testid="squad-merge-proposal">
      <p className="text-ui font-medium text-foreground">{t("teams.mergeProposal.title")}</p>
      <p className="text-ui-sm text-muted-foreground">{t("teams.mergeProposal.text", { from: from.name, into: into.name, count: all.length })}</p>
      <p className="text-ui-sm text-muted-foreground">{t("teams.squad.mergeNote", { from: from.name, into: into.name })}</p>
      <KeepList document={document} ids={all} keep={keep} onChange={setKeep} />
      <Reason text={reason} />
      <div className="cta-row">
        <Button size="sm" variant="ghost" onClick={() => void act("squad:dismissMerge", { proposalId: proposal.id })}>
          {t("teams.mergeProposal.dismiss")}
        </Button>
        <Button size="sm" disabled={Boolean(reason) || busy} onClick={() => run(act("squad:confirmMerge", { proposalId: proposal.id, keepIds: keep }))}>
          {t("teams.squad.mergeConfirm")}
        </Button>
      </div>
    </section>
  );
}
