/**
 * Overlap warnings (G03, #176): the person's work compared with the colleagues' presence at three levels (decision 3).
 * The same module of the map is a light signal, the same file a warning, and a merge probe that fails with the lines in
 * conflict is a real conflict. Trama informs and prepares the message to the colleague; it never blocks anyone
 * (decision 10). Pure functions, shared by the main process and the renderer.
 */
import type { PresenceEntry, PresenceTask } from "./presence";

export type OverlapLevel = "module" | "file" | "conflict";

/** Lines of the person's version of a file, 1-based and inclusive. */
export interface LineRange {
  start: number;
  end: number;
}

/** A merge probe (`conflicts.ts`) of the person's work against a colleague's pushed branch. */
export interface PresenceProbe {
  user: string;
  branch: string;
  /** Who does the person's side of the work: null for the person's checkout, else the agent's name. */
  mine: string | null;
  remoteSHA: string;
  snapshotId: string;
  status: "clean" | "conflict" | "unavailable";
  files: string[];
  lines: Record<string, LineRange[]>;
  checkedAt: string;
}

/** The colleague, or one of the colleague's agents, on the other side of the overlap. */
export interface OverlapColleague {
  user: string;
  name: string;
  /** Set when the other side is an agent of the colleague. */
  agent: { id: string; name: string; color: string } | null;
  branch: string | null;
  task: PresenceTask | null;
}

export interface OverlapItem {
  id: string;
  level: OverlapLevel;
  colleague: OverlapColleague;
  /** The person's side: null for the person, else the name of one of their agents. */
  mine: string | null;
  modules: { id: string; name: string }[];
  /** The files both sides touch; at the conflict level, the files in conflict. */
  files: string[];
  /** At the conflict level, the lines in conflict for each file, in the person's version. */
  lines: Record<string, LineRange[]>;
  /** The colleague's open pull request on that branch: the message becomes a comment there. */
  pullRequest: { number: number; url: string } | null;
}

/** How a module or a file of the map is marked: touched by others only, or overlapping with the person's work. */
export interface OverlapMark {
  level: OverlapLevel | "touched";
  people: string[];
}

export interface OverlapView {
  /** The work going on now (the person's checkout and agents) against the others, strongest first. */
  items: OverlapItem[];
  /** For each open task (W02), what it would overlap, by the modules of its plan and the files of its agents. */
  tasks: Record<string, OverlapItem[]>;
  modules: Record<string, OverlapMark>;
  files: Record<string, OverlapMark>;
  /** The merge probes behind the conflict level, so a candidate can be compared before it is published. */
  probes: PresenceProbe[];
}

/** One side of the person's work: the checkout, an agent, or a task that has not started yet. */
export interface WorkSide {
  mine: string | null;
  files: string[];
  moduleIds: string[];
}

export interface OverlapModule {
  id: string;
  name: string;
  relativePath: string;
  files: string[];
}

export interface OverlapPullRequest {
  number: number;
  url: string;
  headRef: string;
  author: string | null;
  fromFork?: boolean;
}

const RANK: Record<OverlapMark["level"], number> = { touched: 0, module: 1, file: 2, conflict: 3 };

export const OVERLAP_LABEL: Record<OverlapLevel, string> = { module: "Stesso modulo", file: "Stesso file", conflict: "Conflitto" };

/** Finds the module of a path: the module that lists it, else the module whose folder holds it. */
export function moduleLocator(modules: OverlapModule[]): (path: string) => OverlapModule | null {
  const byFile = new Map<string, OverlapModule>();
  for (const module of modules) for (const file of module.files) byFile.set(file, module);
  const folders = [...modules].filter((m) => m.relativePath !== ".").sort((a, b) => b.relativePath.length - a.relativePath.length);
  const root = modules.find((m) => m.relativePath === ".") ?? null;
  return (path) => byFile.get(path) ?? folders.find((m) => path.startsWith(`${m.relativePath}/`)) ?? root;
}

interface OtherSide {
  colleague: OverlapColleague;
  files: string[];
}

/** Everyone else in the picture with something in hand: each colleague, and each of their agents, apart. */
function otherSides(others: PresenceEntry[]): OtherSide[] {
  const sides: OtherSide[] = [];
  for (const entry of others) {
    if (entry.self || entry.status === "expired") continue;
    const record = entry.record;
    sides.push({ colleague: { user: record.user, name: record.name, agent: null, branch: record.activeBranch, task: record.task }, files: record.files });
    for (const agent of record.agents) {
      sides.push({
        colleague: { user: record.user, name: record.name, agent: { id: agent.id, name: agent.name, color: agent.color }, branch: agent.branch, task: agent.task },
        files: agent.files,
      });
    }
  }
  return sides;
}

export function pullRequestFor(colleague: OverlapColleague, pullRequests: OverlapPullRequest[]): { number: number; url: string } | null {
  if (!colleague.branch) return null;
  const candidates = pullRequests.filter((p) => p.headRef === colleague.branch && !p.fromFork);
  const pull = candidates.find((p) => p.author?.toLowerCase() === colleague.user) ?? candidates[0];
  return pull ? { number: pull.number, url: pull.url } : null;
}

/** Compares each side of the person's work with each side of the others; the strongest level wins for each pair. */
export function compareSides(input: {
  sides: WorkSide[];
  others: PresenceEntry[];
  modules: OverlapModule[];
  probes: PresenceProbe[];
  pullRequests: OverlapPullRequest[];
}): OverlapItem[] {
  const locate = moduleLocator(input.modules);
  const moduleName = new Map(input.modules.map((m) => [m.id, m.name]));
  const modulesOf = (files: string[]) => new Set(files.map((f) => locate(f)?.id).filter((id): id is string => Boolean(id)));
  const items: OverlapItem[] = [];
  for (const side of input.sides) {
    const mineFiles = new Set(side.files);
    const mineModules = new Set([...modulesOf(side.files), ...side.moduleIds]);
    for (const other of otherSides(input.others)) {
      const colleague = other.colleague;
      const probe = input.probes.find(
        (p) => p.status === "conflict" && p.user === colleague.user && p.branch === colleague.branch && p.mine === side.mine && p.files.length,
      );
      const shared = other.files.filter((f) => mineFiles.has(f)).sort();
      const sharedModules = [...modulesOf(other.files)].filter((id) => mineModules.has(id)).sort();
      const level: OverlapLevel | null = probe ? "conflict" : shared.length ? "file" : sharedModules.length ? "module" : null;
      if (!level) continue;
      const files = probe ? [...probe.files].sort() : shared;
      const moduleIds = level === "module" ? sharedModules : [...modulesOf(files)].sort();
      items.push({
        // One item per pair and level: new files of the same pair do not make a new warning, a real conflict does.
        id: [level, colleague.user, colleague.agent?.id ?? "", side.mine ?? ""].join(":"),
        level,
        colleague,
        mine: side.mine,
        modules: moduleIds.map((id) => ({ id, name: moduleName.get(id) ?? id })),
        files,
        lines: probe ? probe.lines : {},
        pullRequest: pullRequestFor(colleague, input.pullRequests),
      });
    }
  }
  return items.sort((a, b) => RANK[b.level] - RANK[a.level] || a.colleague.name.localeCompare(b.colleague.name));
}

/** The marks on the map: every module and file the others touch, raised to the level of the overlap with the person. */
export function mapMarks(others: PresenceEntry[], modules: OverlapModule[], items: OverlapItem[]): Pick<OverlapView, "modules" | "files"> {
  const locate = moduleLocator(modules);
  const moduleMarks: Record<string, OverlapMark> = {};
  const fileMarks: Record<string, OverlapMark> = {};
  const raise = (marks: Record<string, OverlapMark>, key: string, level: OverlapMark["level"], person: string) => {
    const mark = (marks[key] ??= { level, people: [] });
    if (RANK[level] > RANK[mark.level]) mark.level = level;
    if (!mark.people.includes(person)) mark.people.push(person);
  };
  for (const side of otherSides(others)) {
    const who = side.colleague.agent ? `${side.colleague.agent.name} (${side.colleague.name})` : side.colleague.name;
    for (const file of side.files) {
      raise(fileMarks, file, "touched", who);
      const module = locate(file);
      if (module) raise(moduleMarks, module.id, "touched", who);
    }
  }
  for (const item of items) {
    const who = item.colleague.agent ? `${item.colleague.agent.name} (${item.colleague.name})` : item.colleague.name;
    for (const module of item.modules) raise(moduleMarks, module.id, item.level, who);
    if (item.level !== "module") for (const file of item.files) raise(fileMarks, file, item.level, who);
  }
  return { modules: moduleMarks, files: fileMarks };
}

/** "righe 3-5 e 12" */
export function linesLabel(ranges: LineRange[]): string {
  const parts = ranges.map((r) => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`));
  if (!parts.length) return "";
  const joined = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} e ${parts.at(-1)}`;
  return `${ranges.length === 1 && ranges[0]!.start === ranges[0]!.end ? "riga" : "righe"} ${joined}`;
}

function filesLabel(files: string[], lines: Record<string, LineRange[]> = {}, limit = 3): string {
  const shown = files.slice(0, limit).map((f) => (lines[f]?.length ? `${f} (${linesLabel(lines[f]!)})` : f));
  const rest = files.length - shown.length;
  const joined = shown.length > 1 ? `${shown.slice(0, -1).join(", ")} e ${shown.at(-1)}` : (shown[0] ?? "");
  return rest > 0 ? `${joined} e altri ${rest}` : joined;
}

const modulesLabel = (item: OverlapItem) => item.modules.map((m) => m.name).join(", ") || "lo stesso modulo";

/** Who is on the other side, in words: "Bea" or "Pixel, agente di Bea". */
export function colleagueLabel(colleague: OverlapColleague): string {
  return colleague.agent ? `${colleague.agent.name}, agente di ${colleague.name}` : colleague.name;
}

/** One line for the focus bar, the map and the chat. */
export function overlapSummary(item: OverlapItem): string {
  const who = colleagueLabel(item.colleague);
  const mine = item.mine ? ` (come ${item.mine})` : "";
  switch (item.level) {
    case "module":
      return `${who} lavora anche nel modulo ${modulesLabel(item)}${mine}.`;
    case "file":
      return `${who} tocca anche ${filesLabel(item.files)}${mine}.`;
    case "conflict":
      return `Conflitto con ${who} in ${filesLabel(item.files, item.lines)}${mine}.`;
  }
}

/**
 * The message to the colleague (decision 10), ready to send as a comment on their pull request or to copy into the
 * team's channel. Only the person sends it.
 */
export function colleagueMessage(item: OverlapItem, self: { name: string; branch: string | null }): string {
  const first = item.colleague.name.split(/\s+/)[0] || item.colleague.name;
  const where =
    item.level === "module"
      ? `i nostri lavori passano dallo stesso modulo, ${modulesLabel(item)}`
      : `i nostri lavori toccano gli stessi file: ${filesLabel(item.files, {}, 6)}`;
  const task = item.colleague.task ? ` ("${item.colleague.task.title}")` : "";
  const branches = [
    self.branch ? (item.mine ? `il mio agente ${item.mine} è su ${self.branch}` : `io sono su ${self.branch}`) : null,
    item.colleague.branch ? `${item.colleague.agent ? `il tuo agente ${item.colleague.agent.name} è` : "tu sei"} su ${item.colleague.branch}${task}` : null,
  ].filter((part): part is string => Boolean(part));
  const lines = [`Ciao ${first}, sono ${self.name}. Con Trama vedo che ${where}.`];
  if (branches.length) {
    const sentence = branches.join(", ");
    lines.push(`${sentence[0]!.toUpperCase()}${sentence.slice(1)}.`);
  }
  if (item.level === "conflict") {
    lines.push(`Una prova di unione tra i nostri branch dà conflitto in ${filesLabel(item.files, item.lines, 6)}.`);
    lines.push("Ci sentiamo per decidere chi cambia cosa prima di unire?");
  } else {
    lines.push("Ci sentiamo per decidere chi tocca cosa, così evitiamo un conflitto?");
  }
  return lines.join("\n");
}

/** What the Coordinator says in the chat, at the start of a task, while working or before merging. */
export function coordinatorNotice(item: OverlapItem, moment: "start" | "working"): { title: string; text: string } {
  const summary = overlapSummary(item);
  const tail = item.pullRequest
    ? `Ho preparato un commento per la sua pull request #${item.pullRequest.number}: lo invii tu, se ti va.`
    : "Ho preparato un messaggio da copiare nel canale del team: lo invii tu, se ti va.";
  if (moment === "start") {
    return { title: "Prima di iniziare", text: `${summary} Il lavoro può partire comunque; conviene parlarne prima. ${tail}` };
  }
  if (item.level === "conflict") {
    return { title: "Conflitto con un collega", text: `${summary} La prova di unione lo conferma. Nessun lavoro è fermo. ${tail}` };
  }
  return { title: "Stessi file di un collega", text: `${summary} Per ora non c'è un conflitto confermato. ${tail}` };
}

/** Level of the strongest item, for the badges. */
export function strongest(items: OverlapItem[]): OverlapItem | null {
  return [...items].sort((a, b) => RANK[b.level] - RANK[a.level])[0] ?? null;
}

/**
 * Line ranges of the person's side ("ours") in a file with conflict markers, as `git merge-tree` writes it. Lines
 * outside the conflict blocks and on the person's side count; the base and the other side do not.
 */
export function conflictRanges(merged: string): LineRange[] {
  const ranges: LineRange[] = [];
  let ours = 0;
  let state: "outside" | "ours" | "base" | "theirs" = "outside";
  let start = 0;
  for (const line of merged.split("\n")) {
    if (state === "outside" && line.startsWith("<<<<<<<")) {
      state = "ours";
      start = ours + 1;
      continue;
    }
    if (state === "ours" && line.startsWith("|||||||")) {
      state = "base";
      continue;
    }
    if ((state === "ours" || state === "base") && line.startsWith("=======")) {
      state = "theirs";
      continue;
    }
    if (state === "theirs" && line.startsWith(">>>>>>>")) {
      // An empty side still names the line where the conflict sits.
      ranges.push({ start: Math.max(1, start), end: Math.max(start, ours) });
      state = "outside";
      continue;
    }
    if (state === "outside" || state === "ours") ours += 1;
  }
  return ranges;
}
