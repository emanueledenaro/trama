import type { GitHubState, ProjectDocument, Specialist, SpecialistAssignment } from "./domain";
import { localeOf, type Translate } from "./i18n";
import type { RepositoryModule } from "./repository";

/**
 * References in messages (issue #277): the ids and names a text cites that name real records of Trama. Recognition
 * works on Trama's data, never on the text alone: an id that looks right but names nothing stays plain text and is
 * reported as unknown.
 */
export type ReferenceTarget =
  | { kind: "issue"; number: number }
  | { kind: "pullRequest"; number: number }
  | { kind: "assignment"; id: string; specialistId: string }
  | { kind: "candidate"; id: string }
  | { kind: "review"; id: string; candidateId: string }
  | { kind: "audit"; id: string }
  | { kind: "decision"; id: string }
  | { kind: "question"; id: string }
  | { kind: "mandate"; id: string }
  | { kind: "plan"; id: string }
  | { kind: "slice"; planId: string; sliceId: string }
  | { kind: "goal"; id: string }
  | { kind: "route"; id: string }
  | { kind: "specialist"; id: string }
  | { kind: "module"; id: string }
  | { kind: "file"; path: string }
  | { kind: "commit"; sha: string }
  | { kind: "branch"; name: string };

export type ReferenceKind = ReferenceTarget["kind"];

export interface Reference {
  target: ReferenceTarget;
  /** The id as Trama records it, shown on hover. */
  id: string;
  /** The readable name with its noun, as "fetta 2, Il supporto vede gli ordini" or "candidato di Luca". */
  label: string;
  /** The name without the noun, for a text that already wrote it ("la fetta S2" becomes "la fetta 2, ..."). */
  short: string;
  /** What the hover says beyond the id: a title, an objective. */
  detail: string | null;
  /** The page on GitHub, for issues, pull requests and commits. */
  url: string | null;
  /** The agent the name says a work is of ("di Luca"): a text that writes it again after the id says it once (issue #392). */
  owner?: string;
}

export interface ReferenceSources {
  document: ProjectDocument;
  modules: RepositoryModule[];
  github: GitHubState;
}

export interface ReferenceIndex {
  ids: Map<string, Reference>;
  issues: Map<number, Reference>;
  /** False while GitHub has not answered: an issue number that names nothing is then not reported. */
  githubReady: boolean;
  slices: Map<string, Reference>;
  names: Map<string, Reference>;
  paths: Map<string, Reference>;
  branches: Map<string, Reference>;
  commits: { sha: string; reference: Reference }[];
}

/** One stretch of a text: plain, a reference, or an id that looks like one of Trama's and names nothing. */
export type ReferencePart = { text: string } | { text: string; reference: Reference } | { text: string; unknown: string };

/** The id prefixes Trama links, with the kind each one names (ids.ts). */
const LINKED_PREFIXES = ["A", "AT", "C", "D", "F", "G", "M", "P", "Q", "R", "S"] as const;
const ID_PATTERN = /(?<![\w-])(?:DQ|DM|AT|PR|[ACDEFGMPQRST])-[0-9A-F]{8}(?![\w-])/g;
const ISSUE_PATTERN = /(?<![\w&/#])#(\d{1,6})(?!\w)/g;
const SLICE_PATTERN = /(?<![\w-])S(\d{1,2})(?![\w-])/g;
const MENTION_PATTERN = /(?<![\w@])@(?:"((?:\\.|[^"\\])*)"|([^\s@]+))/g;
const PATH_PATTERN = /(?<![\w./@-])((?:[\w.-]+\/)+[\w.-]*[\w]|[\w-][\w.-]*\.[A-Za-z][A-Za-z0-9]{0,7})(?::\d+(?::\d+)?)?(?![\w/])/g;
const SHA_PATTERN = /(?<![\w-])[0-9a-f]{7,40}(?![\w-])/g;
/** Nouns a text may write before a reference; the reference then shows its short name. */
const NOUN_BEFORE =
  /(?:^|[^\p{L}])(incarico|candidato|decisione|domanda|mandato|piano|fetta|obiettivo|issue|ticket|pr|pull request|modulo|file|commit|branch|revisione|esame|percorso|assignment|candidate|decision|question|mandate|plan|slice|goal|module|review|route)\s*$/iu;
/**
 * The words that may stand right before a slice id or an issue number that names Trama's record (issue #392): the
 * nouns of slices and issues, articles, prepositions, conjunctions and GitHub's closing keywords. After any other word
 * the short code belongs to that word ("le tariffe S1", "l'ordine #2") and stays text. i18n-exempt: words Trama reads in
 * the text, in both languages.
 */
const SHORT_CODE_LEADS = new Set(
  [
    "fetta fette slice slices issue issues ticket tickets pr prs pull request requests",
    "il lo la i gli le un uno una di a da in con su per tra fra",
    "del dello della dei degli delle al allo alla ai agli alle dal dallo dalla dai dagli dalle",
    "nel nello nella nei negli nelle sul sullo sulla sui sugli sulle col coi",
    "e ed o od ma né oppure poi anche come dopo prima vedi cioè",
    "the an of to on for and or with from by at see after before via",
    "close closes closed fix fixes fixed resolve resolves resolved chiude chiudi risolve",
  ].flatMap((words) => words.split(" ")),
);
const WORD_BEFORE = /(\p{L}+)\s+$/u;
/** A list of short codes of the same kind: "S1 e S2", "#13, #14". */
const LIST_BEFORE = /^(?:\s*,\s*|\s+(?:e|ed|o|and|or)\s+)$/iu;

const clip = (text: string, limit = 60) => {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1).trimEnd()}…` : clean;
};

const make = (target: ReferenceTarget, id: string, noun: string, name: string, detail: string | null = null, url: string | null = null): Reference => ({
  target,
  id,
  label: noun ? `${noun} ${name}` : name,
  short: name,
  detail,
  url,
});

/** Every reference of the project, built from Trama's records, the repository and GitHub's last reading. */
export function buildReferenceIndex(t: Translate, { document, modules, github }: ReferenceSources): ReferenceIndex {
  const index: ReferenceIndex = {
    ids: new Map(),
    issues: new Map(),
    githubReady: github.status === "ready",
    slices: new Map(),
    names: new Map(),
    paths: new Map(),
    branches: new Map(),
    commits: [],
  };
  const repository = github.repository;
  // The day a mandate was asked, as the language writes a short date: "05/03" in Italian, "03/05" in English.
  const asked = new Intl.DateTimeFormat(localeOf(t.language), { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const specialists = document.team.specialists;
  const owner = (specialistId: string) => specialists.find((s) => s.id === specialistId);
  const assignments = specialists.flatMap((s) => s.assignments.map((assignment) => ({ assignment, specialist: s })));
  const plans = document.plans;
  const sliceName = (planId: string, sliceId: string) => {
    const ticket = plans.find((p) => p.id === planId)?.slicing?.tickets.find((t) => t.id === sliceId);
    return ticket ? `${sliceId.replace(/^S/, "")}, ${clip(ticket.title)}` : sliceId;
  };
  const ofWork = (assignment: SpecialistAssignment | undefined, specialist: Specialist | undefined) => {
    const who = specialist ? t("shared.reference.of", { name: specialist.name }) : "";
    const slice = assignment?.slice ? t("shared.reference.ofSlice", { name: sliceName(assignment.slice.planId, assignment.slice.sliceId) }) : "";
    return `${who}${slice}`.trim() || t("shared.reference.noAuthor");
  };
  // Two works of the same agent read the same: the second and later get their number, in the order they began.
  const numbered = (names: [string, string][]) => {
    const total = new Map<string, number>();
    for (const [, name] of names) total.set(name, (total.get(name) ?? 0) + 1);
    const seen = new Map<string, number>();
    return new Map(
      names.map(([key, name]) => {
        const count = (seen.get(name) ?? 0) + 1;
        seen.set(name, count);
        return [key, total.get(name)! > 1 ? t("shared.reference.numbered", { name, count: String(count) }) : name];
      }),
    );
  };
  const workNames = numbered(assignments.map(({ assignment, specialist }) => [assignment.id, ofWork(assignment, specialist)]));
  const candidateNames = numbered(
    document.candidates.map((candidate) => {
      const found = assignments.find((a) => a.assignment.id === candidate.assignmentId);
      return [candidate.id, ofWork(found?.assignment, found?.specialist ?? owner(candidate.specialistId))];
    }),
  );

  for (const specialist of specialists) {
    const reference = make({ kind: "specialist", id: specialist.id }, specialist.id, "", specialist.name, specialist.competence);
    index.ids.set(specialist.id, reference);
    // Developers carry a person's name; a fixed role's name ("Sicurezza") is a common word and is linked by id only.
    if (specialist.origin !== "fixedRole" && specialist.name.trim().length >= 3) index.names.set(specialist.name.trim(), reference);
  }
  const ownedBy = (reference: Reference, specialist: Specialist | undefined): Reference => (specialist ? { ...reference, owner: specialist.name } : reference);
  for (const { assignment, specialist } of assignments) {
    index.ids.set(
      assignment.id,
      ownedBy(make({ kind: "assignment", id: assignment.id, specialistId: specialist.id }, assignment.id, t("shared.reference.assignment"), workNames.get(assignment.id)!, clip(assignment.objective, 120)), specialist),
    );
    if (assignment.workspace?.branch) {
      index.branches.set(assignment.workspace.branch, make({ kind: "branch", name: assignment.workspace.branch }, assignment.workspace.branch, "", assignment.workspace.branch, t("shared.reference.assignmentBranch", { id: assignment.id })));
    }
  }
  for (const candidate of document.candidates) {
    const found = assignments.find((a) => a.assignment.id === candidate.assignmentId);
    const name = candidateNames.get(candidate.id)!;
    const author = found?.specialist ?? owner(candidate.specialistId);
    const reference = ownedBy(make({ kind: "candidate", id: candidate.id }, candidate.id, t("shared.reference.candidate"), name, found ? clip(found.assignment.objective, 120) : null), author);
    index.ids.set(candidate.id, reference);
    if (candidate.technicalReview) {
      index.ids.set(
        candidate.technicalReview.id,
        ownedBy(
          make({ kind: "review", id: candidate.technicalReview.id, candidateId: candidate.id }, candidate.technicalReview.id, t("shared.reference.review"), name, clip(candidate.technicalReview.summary, 120)),
          author,
        ),
      );
    }
    index.commits.push({ sha: candidate.baseSHA, reference: make({ kind: "commit", sha: candidate.baseSHA }, candidate.baseSHA, "", candidate.baseSHA.slice(0, 7), t("shared.reference.candidateBase", { id: candidate.id }), repository ? `https://github.com/${repository}/commit/${candidate.baseSHA}` : null) });
    if (candidate.pullRequest) {
      const pr = candidate.pullRequest;
      index.branches.set(pr.branch, make({ kind: "branch", name: pr.branch }, pr.branch, "", pr.branch, t("shared.reference.pullBranch", { number: String(pr.number) })));
    }
  }
  for (const audit of document.audits ?? []) {
    const candidate = index.ids.get(audit.target.candidateId);
    const reference = make({ kind: "audit", id: audit.id }, audit.id, t("shared.reference.audit"), candidate?.short ?? audit.target.candidateId);
    index.ids.set(audit.id, candidate?.owner ? { ...reference, owner: candidate.owner } : reference);
  }
  for (const decision of [...document.decisionHistory, ...document.decisions]) {
    index.ids.set(decision.id, make({ kind: "decision", id: decision.id }, decision.id, t("shared.reference.decision"), `«${clip(decision.value, 48)}»`, clip(decision.value, 160)));
  }
  for (const request of document.decisionRequests) {
    index.ids.set(request.id, make({ kind: "question", id: request.id }, request.id, t("shared.reference.question"), `«${clip(request.question, 48)}»`, clip(request.question, 160)));
  }
  for (const request of document.mandateRequests) {
    const date = asked.format(new Date(`${request.askedAt.slice(0, 10)}T00:00:00Z`));
    index.ids.set(request.id, make({ kind: "mandate", id: request.id }, request.id, t("shared.reference.mandate"), t("shared.reference.mandateAsked", { date }), clip(request.reason, 160)));
  }
  for (const plan of plans) {
    const title = plan.spec?.sections?.title ?? plan.proposal?.summary ?? plan.summary;
    index.ids.set(plan.id, make({ kind: "plan", id: plan.id }, plan.id, t("shared.reference.plan"), `«${clip(title, 48)}»`, clip(title, 160)));
    for (const ticket of plan.slicing?.tickets ?? []) {
      // The same slice id comes back in each breakdown: the latest plan that has it wins.
      const reference = make({ kind: "slice", planId: plan.id, sliceId: ticket.id }, ticket.id, t("shared.reference.slice"), sliceName(plan.id, ticket.id), clip(ticket.whatToBuild, 160));
      index.slices.set(ticket.id, reference);
    }
  }
  for (const goal of document.goals ?? []) {
    index.ids.set(goal.id, make({ kind: "goal", id: goal.id }, goal.id, t("shared.reference.goal"), `«${clip(goal.title, 48)}»`, clip(goal.outcome, 160)));
  }
  // A route of Ask Trama by the situation it answers (issue #270): "Avvia il percorso AT-..." names it.
  for (const route of document.routes ?? []) {
    index.ids.set(route.id, make({ kind: "route", id: route.id }, route.id, t("shared.reference.route"), `«${clip(route.situation, 48)}»`, clip(route.reason, 160)));
  }
  for (const module of modules) {
    const reference = make({ kind: "module", id: module.id }, module.relativePath, t("shared.reference.module"), module.name, clip(module.summary, 160));
    if (module.relativePath !== ".") index.paths.set(module.relativePath.replace(/\/+$/, ""), reference);
    for (const file of module.files) index.paths.set(file.relativePath, make({ kind: "file", path: file.relativePath }, file.relativePath, "", file.relativePath, t("shared.reference.moduleFile", { module: module.name })));
  }
  for (const issue of github.issues) {
    index.issues.set(issue.number, make({ kind: "issue", number: issue.number }, `#${issue.number}`, t("shared.reference.issue"), `#${issue.number}`, clip(issue.title, 160), issue.url));
  }
  const pullUrl = (number: number) => (repository ? `https://github.com/${repository}/pull/${number}` : null);
  const pulls = new Map<number, { title: string | null; url: string | null }>();
  for (const link of github.pullRequestLinks ?? []) pulls.set(link.number, { title: null, url: pullUrl(link.number) });
  for (const candidate of document.candidates) if (candidate.pullRequest) pulls.set(candidate.pullRequest.number, { title: null, url: candidate.pullRequest.url });
  for (const pr of github.snapshot?.pullRequests ?? []) {
    pulls.set(pr.number, { title: pr.title, url: pr.url });
    index.branches.set(pr.headRef, make({ kind: "branch", name: pr.headRef }, pr.headRef, "", pr.headRef, t("shared.reference.pullBranch", { number: String(pr.number) })));
    index.commits.push({ sha: pr.headSHA, reference: make({ kind: "commit", sha: pr.headSHA }, pr.headSHA, "", pr.headSHA.slice(0, 7), t("shared.reference.pullCommit", { number: String(pr.number) }), repository ? `https://github.com/${repository}/commit/${pr.headSHA}` : null) });
  }
  for (const [number, pr] of pulls) {
    // A number that GitHub lists as an issue stays an issue: GitHub numbers both in one sequence.
    if (index.issues.has(number)) continue;
    index.issues.set(number, make({ kind: "pullRequest", number }, `#${number}`, t("shared.reference.pullRequest"), `#${number}`, pr.title ? clip(pr.title, 160) : null, pr.url));
  }
  for (const branch of github.snapshot?.branches ?? []) {
    if (!index.branches.has(branch.name)) index.branches.set(branch.name, make({ kind: "branch", name: branch.name }, branch.name, "", branch.name));
    index.commits.push({ sha: branch.sha, reference: make({ kind: "commit", sha: branch.sha }, branch.sha, "", branch.sha.slice(0, 7), t("shared.reference.branchCommit", { branch: branch.name }), repository ? `https://github.com/${repository}/commit/${branch.sha}` : null) });
  }
  return index;
}

/** The reference an id, a number, a path, a branch or a commit names, or null. */
export function lookupReference(token: string, index: ReferenceIndex): Reference | null {
  const text = token.trim();
  if (!text) return null;
  const id = index.ids.get(text.toUpperCase());
  if (id) return id;
  const issue = /^#(\d{1,6})$/.exec(text);
  if (issue) return index.issues.get(Number(issue[1])) ?? null;
  if (/^S\d{1,2}$/.test(text)) return index.slices.get(text) ?? null;
  const path = text.replace(/^\.\//, "").replace(/:\d+(?::\d+)?$/, "").replace(/\/+$/, "");
  const found = index.paths.get(path) ?? index.branches.get(text) ?? index.names.get(text);
  if (found) return found;
  if (/^[0-9a-f]{7,40}$/.test(text)) return index.commits.find((c) => c.sha.startsWith(text))?.reference ?? null;
  return null;
}

/** A composer mention (`@module:<id>`, `@issue:12`, `@decision:D-1`, `@path`) resolved against the index. */
function mentionReference(body: string, index: ReferenceIndex): Reference | null {
  if (body.startsWith("module:")) {
    const id = body.slice(7);
    return [...index.paths.values()].find((r) => r.target.kind === "module" && r.target.id === id) ?? null;
  }
  if (body.startsWith("issue:")) return index.issues.get(Number(body.slice(6).replace(/^#/, ""))) ?? null;
  if (body.startsWith("decision:")) return index.ids.get(body.slice(9).toUpperCase()) ?? null;
  return index.paths.get(body) ?? null;
}

interface Match {
  start: number;
  end: number;
  reference?: Reference;
  unknown?: string;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isLinkedPrefix = (id: string) => (LINKED_PREFIXES as readonly string[]).includes(id.slice(0, id.indexOf("-")));

const ANCHORED_ID = new RegExp(`^${ID_PATTERN.source}$`);
const compiled = new WeakMap<ReferenceIndex, { irregular: RegExp | null; names: RegExp | null }>();

/** The patterns an index needs beyond the fixed ones, compiled once per index. */
function patternsOf(index: ReferenceIndex) {
  let patterns = compiled.get(index);
  if (!patterns) {
    const alternatives = (items: string[]) => items.sort((a, b) => b.length - a.length).map(escape).join("|");
    // Ids a person chose by hand, as a decision's "D-1", do not follow ids.ts: they are matched as written.
    const irregular = [...index.ids.keys()].filter((id) => !ANCHORED_ID.test(id));
    const names = [...index.names.keys()];
    patterns = {
      irregular: irregular.length ? new RegExp(`(?<![\\w-])(?:${alternatives(irregular)})(?![\\w-])`, "g") : null,
      names: names.length ? new RegExp(`(?<![\\p{L}\\p{N}_@-])(?:${alternatives(names)})(?![\\p{L}\\p{N}_-])`, "gu") : null,
    };
    compiled.set(index, patterns);
  }
  return patterns;
}

/**
 * Whether each short code of one kind (a slice id, an issue number) read in order names Trama's record: it does after
 * a word of SHORT_CODE_LEADS or no word at all, and a code that continues a list takes the answer of the one before it.
 */
function shortCodeReader() {
  let last: { end: number; names: boolean } | null = null;
  return (text: string, start: number, length: number) => {
    const between = last ? text.slice(last.end, start) : null;
    const word = WORD_BEFORE.exec(text.slice(Math.max(0, start - 40), start))?.[1];
    const names = last && between !== null && LIST_BEFORE.test(between) ? last.names : !word || SHORT_CODE_LEADS.has(word.toLowerCase());
    last = { end: start + length, names };
    return names;
  };
}

/**
 * How much of the text after a work's id repeats the agent its name already says (" di Luca", " by Luca"), or 0.
 * i18n-exempt: words Trama reads in the text, in both languages.
 */
function ownerAfter(text: string, end: number, reference: Reference): number {
  if (!reference.owner) return 0;
  const repeated = new RegExp(`^\\s+(?:di|by)\\s+${escape(reference.owner)}(?![\\p{L}\\p{N}_-])`, "u").exec(text.slice(end));
  return repeated ? repeated[0].length : 0;
}

function matches(text: string, index: ReferenceIndex): Match[] {
  const found: Match[] = [];
  for (const m of text.matchAll(MENTION_PATTERN)) {
    if (m[1] !== undefined) {
      const reference = mentionReference(m[1].replace(/\\(.)/g, "$1"), index);
      if (reference) found.push({ start: m.index, end: m.index + m[0].length, reference });
      continue;
    }
    // A mention at the end of a sentence keeps its punctuation out of the link.
    const body = m[2]!;
    const trimmed = body.replace(/[,.;:!?)]+$/, "");
    const whole = mentionReference(body, index);
    const reference = whole ?? mentionReference(trimmed, index);
    if (reference) found.push({ start: m.index, end: m.index + 1 + (whole ? body : trimmed).length, reference });
  }
  const { irregular, names } = patternsOf(index);
  if (irregular) for (const m of text.matchAll(irregular)) found.push({ start: m.index, end: m.index + m[0].length, reference: index.ids.get(m[0])! });
  for (const m of text.matchAll(ID_PATTERN)) {
    const reference = index.ids.get(m[0]);
    if (reference) found.push({ start: m.index, end: m.index + m[0].length + ownerAfter(text, m.index + m[0].length, reference), reference });
    else if (isLinkedPrefix(m[0])) found.push({ start: m.index, end: m.index + m[0].length, unknown: m[0] });
  }
  const issueCode = shortCodeReader();
  for (const m of text.matchAll(ISSUE_PATTERN)) {
    if (!issueCode(text, m.index, m[0].length)) continue;
    const reference = index.issues.get(Number(m[1]));
    if (reference) found.push({ start: m.index, end: m.index + m[0].length, reference });
    else if (index.githubReady) found.push({ start: m.index, end: m.index + m[0].length, unknown: m[0] });
  }
  // A slice number that names no slice is not reported: "S3" is also a common name outside Trama.
  if (index.slices.size) {
    const sliceCode = shortCodeReader();
    for (const m of text.matchAll(SLICE_PATTERN)) {
      if (!sliceCode(text, m.index, m[0].length)) continue;
      const reference = index.slices.get(m[0]);
      if (reference) found.push({ start: m.index, end: m.index + m[0].length, reference });
    }
  }
  if (names) for (const m of text.matchAll(names)) found.push({ start: m.index, end: m.index + m[0].length, reference: index.names.get(m[0])! });
  for (const m of text.matchAll(PATH_PATTERN)) {
    const reference = index.paths.get(m[1]!) ?? index.branches.get(m[1]!);
    if (reference) found.push({ start: m.index, end: m.index + m[0].length, reference });
  }
  if (index.commits.length) {
    for (const m of text.matchAll(SHA_PATTERN)) {
      const reference = index.commits.find((c) => c.sha.startsWith(m[0]))?.reference;
      if (reference) found.push({ start: m.index, end: m.index + m[0].length, reference });
    }
  }
  // Earlier first, and the longer of two that start together; overlapping matches after the first are dropped.
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Match[] = [];
  for (const match of found) if (!kept.length || match.start >= kept.at(-1)!.end) kept.push(match);
  return kept;
}

/** Splits `text` into plain stretches, references and unknown ids, in order. */
export function splitReferences(text: string, index: ReferenceIndex): ReferencePart[] {
  const parts: ReferencePart[] = [];
  let position = 0;
  for (const match of matches(text, index)) {
    if (match.start > position) parts.push({ text: text.slice(position, match.start) });
    const written = text.slice(match.start, match.end);
    if (match.reference) parts.push({ text: written, reference: match.reference });
    else parts.push({ text: written, unknown: match.unknown! });
    position = match.end;
  }
  if (position < text.length) parts.push({ text: text.slice(position) });
  return parts;
}

/**
 * What a reference shows where `before` is the text written just before it: the short name when the text already
 * wrote the noun ("la fetta S2" shows "la fetta 2, ..."), the name with its noun otherwise. Paths, branches, commits,
 * names and composer mentions keep what was written.
 */
export function referenceText(reference: Reference, written: string, before: string): string {
  const kind = reference.target.kind;
  if (kind === "file" || kind === "branch" || kind === "commit") return written;
  if (written.startsWith("@")) return reference.label;
  if (kind === "specialist" && !/^S-/.test(written)) return written;
  if (kind === "module" && written.includes("/")) return written;
  return NOUN_BEFORE.test(before) ? reference.short : reference.label;
}

/** The hover of a reference: the id Trama records and what it names. */
export function referenceTitle(reference: Reference): string {
  return reference.detail ? `${reference.id}: ${reference.detail}` : reference.id;
}

/** The ids `text` cites that look like Trama's and name nothing of this project, once each (issue #277). */
export function unknownReferences(text: string, index: ReferenceIndex): string[] {
  const unknown = splitReferences(text, index).flatMap((part) => ("unknown" in part ? [part.unknown] : []));
  return [...new Set(unknown)];
}

/** A target as the text of a link, and back: `trama:ref/<kind>/<key>`. */
export function referenceHref(target: ReferenceTarget): string {
  const key =
    target.kind === "issue" || target.kind === "pullRequest"
      ? String(target.number)
      : target.kind === "file"
        ? target.path
        : target.kind === "commit"
          ? target.sha
          : target.kind === "branch"
            ? target.name
            : target.kind === "slice"
              ? `${target.planId}/${target.sliceId}`
              : target.kind === "assignment"
                ? `${target.specialistId}/${target.id}`
                : target.kind === "review"
                  ? `${target.candidateId}/${target.id}`
                  : target.id;
  return `trama:ref/${target.kind}/${encodeURIComponent(key)}`;
}

export function parseReferenceHref(href: string): ReferenceTarget | null {
  const match = /^trama:ref\/([a-zA-Z]+)\/(.+)$/.exec(href);
  if (!match) return null;
  let key: string;
  try {
    key = decodeURIComponent(match[2]!);
  } catch {
    return null;
  }
  const pair = () => {
    const at = key.indexOf("/");
    return at > 0 ? [key.slice(0, at), key.slice(at + 1)] : null;
  };
  switch (match[1]) {
    case "issue":
    case "pullRequest": {
      const number = Number(key);
      return Number.isInteger(number) && number > 0 ? { kind: match[1], number } : null;
    }
    case "file":
      return { kind: "file", path: key };
    case "commit":
      return /^[0-9a-f]{7,40}$/.test(key) ? { kind: "commit", sha: key } : null;
    case "branch":
      return { kind: "branch", name: key };
    case "slice": {
      const [planId, sliceId] = pair() ?? [];
      return planId && sliceId ? { kind: "slice", planId, sliceId } : null;
    }
    case "assignment": {
      const [specialistId, id] = pair() ?? [];
      return specialistId && id ? { kind: "assignment", specialistId, id } : null;
    }
    case "review": {
      const [candidateId, id] = pair() ?? [];
      return candidateId && id ? { kind: "review", candidateId, id } : null;
    }
    case "candidate":
    case "audit":
    case "decision":
    case "question":
    case "mandate":
    case "plan":
    case "goal":
    case "route":
    case "specialist":
    case "module":
      return { kind: match[1], id: key };
    default:
      return null;
  }
}

/**
 * Trama's records the Coordinator may cite, one line each with the name the person reads; null when there are none.
 * i18n-exempt: written for the Coordinator, which receives the person's language with its rules.
 */
export function referenceListing(index: ReferenceIndex, limit = 80): string | null {
  const agents: string[] = [];
  const records: string[] = [];
  for (const reference of index.ids.values()) {
    const kind = reference.target.kind;
    if (kind === "review" || kind === "audit") continue;
    (kind === "specialist" ? agents : records).push(`- ${reference.id}: ${reference.label}`);
  }
  for (const reference of index.slices.values()) {
    if (reference.target.kind === "slice") records.push(`- ${reference.id} (piano ${reference.target.planId}): ${reference.label}`);
  }
  if (!agents.length && !records.length) return null;
  // The agents always; of the other records, the newest.
  const kept = records.slice(-limit);
  return [
    "## Riferimenti di Trama",
    "Gli id reali che puoi citare; Trama li mostra alla persona come collegamenti con il nome a destra. Un id che non è qui resta testo semplice e Trama lo segnala.",
    ...agents,
    ...(records.length > kept.length ? [`(${records.length - kept.length} record più vecchi omessi)`] : []),
    ...kept,
  ].join("\n");
}
