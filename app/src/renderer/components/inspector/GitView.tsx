import { IconExternalLink } from "@tabler/icons-react";
import type { ActiveProjectState } from "@shared/domain";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n";
import { openReference } from "@/lib/references";
import { act, useUi } from "@/lib/store";
import { EmptyNote, InspectorSection } from "./Inspector";

/** Pull requests, commits and branches a message cites (issue #277): what Trama knows of them, and GitHub on request. */

const CHECKS = { success: "Verifiche passate", failure: "Verifiche fallite", pending: "Verifiche in corso", none: "Nessuna verifica" } as const;
const REVIEW = { approved: "Approvata", changesRequested: "Modifiche richieste", commented: "Commentata", none: null } as const;

/** Opening the record on GitHub is a way out of the view: an icon with its tooltip, not the view's main action. */
function OnGitHub({ url }: { url: string | null }) {
  const t = useT();
  if (!url) return null;
  return (
    <div className="cta-row mt-3">
      <Tooltip label={t("work.branches.openOnGitHub")}>
        <Button size="icon" variant="ghost" aria-label={t("work.branches.openOnGitHub")} onClick={() => void act("shell:openExternal", { url })}>
          <IconExternalLink stroke={1.8} />
        </Button>
      </Tooltip>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5 text-ui-sm">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-words text-foreground/90">{children}</span>
    </div>
  );
}

function Go({ onClick, children, mono = false }: { onClick: () => void; children: React.ReactNode; mono?: boolean }) {
  return (
    <button type="button" className={mono ? "chat-reference font-mono text-[12px]" : "chat-reference"} onClick={onClick}>
      {children}
    </button>
  );
}

const assignmentsOf = (project: ActiveProjectState) =>
  project.document.team.specialists.flatMap((specialist) => specialist.assignments.map((assignment) => ({ specialist, assignment })));

export function PullRequestView({ number }: { number: number }) {
  const project = useUi((s) => s.app?.project)!;
  const github = project.github;
  const pr = github.snapshot?.pullRequests.find((p) => p.number === number) ?? null;
  const candidate = project.document.candidates.find((c) => c.pullRequest?.number === number) ?? null;
  const linked = pr?.linkedIssues ?? github.pullRequestLinks?.find((l) => l.number === number)?.linkedIssues ?? [];
  const url = pr?.url ?? candidate?.pullRequest?.url ?? (github.repository ? `https://github.com/${github.repository}/pull/${number}` : null);
  const review = pr?.reviewState ? REVIEW[pr.reviewState] : null;
  return (
    <div className="px-4 py-3">
      <h3 className="text-ui-lg font-medium text-foreground">{pr?.title ?? `Pull request #${number}`}</h3>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-ui-sm text-muted-foreground">
        <span>#{number}</span>
        {pr?.draft ? <Badge tone="secondary">Bozza</Badge> : null}
        {candidate?.pullRequest?.mergedAt ? <Badge tone="success">Unita</Badge> : null}
        {pr?.checks ? <Badge tone={pr.checks === "failure" ? "destructive" : pr.checks === "success" ? "success" : "secondary"}>{CHECKS[pr.checks]}</Badge> : null}
        {review ? <Badge tone="outline">{review}</Badge> : null}
      </div>
      <div className="mt-3">
        {pr ? (
          <Row label="Branch">
            <Go mono onClick={() => openReference({ kind: "branch", name: pr.headRef })}>
              {pr.headRef}
            </Go>{" "}
            verso {pr.baseRef}
          </Row>
        ) : candidate?.pullRequest ? (
          <Row label="Branch">
            <Go mono onClick={() => openReference({ kind: "branch", name: candidate.pullRequest!.branch })}>
              {candidate.pullRequest.branch}
            </Go>
          </Row>
        ) : null}
        {pr?.author ? <Row label="Autore">{pr.author}</Row> : null}
        {linked.length ? (
          <Row label="Issue">
            {linked.map((issue, position) => (
              <span key={issue}>
                {position ? ", " : null}
                <Go onClick={() => openReference({ kind: "issue", number: issue })}>#{issue}</Go>
              </span>
            ))}
          </Row>
        ) : null}
        {candidate ? (
          <Row label="Candidato">
            <Go onClick={() => openReference({ kind: "candidate", id: candidate.id })}>{candidate.id}</Go>
          </Row>
        ) : null}
        {!pr && !candidate ? <EmptyNote>GitHub non ha ancora dato i dettagli di questa pull request a Trama.</EmptyNote> : null}
      </div>
      <OnGitHub url={url} />
    </div>
  );
}

export function CommitView({ sha }: { sha: string }) {
  const project = useUi((s) => s.app?.project)!;
  const github = project.github;
  const matches = (other: string) => other.startsWith(sha) || sha.startsWith(other);
  const full =
    [...project.document.candidates.map((c) => c.baseSHA), ...(github.snapshot?.branches.map((b) => b.sha) ?? []), ...(github.snapshot?.pullRequests.map((p) => p.headSHA) ?? [])].find(
      (other) => other.length >= sha.length && matches(other),
    ) ?? sha;
  const candidates = project.document.candidates.filter((c) => matches(c.baseSHA));
  const branches = github.snapshot?.branches.filter((b) => matches(b.sha)) ?? [];
  const pulls = github.snapshot?.pullRequests.filter((p) => matches(p.headSHA)) ?? [];
  const url = github.repository ? `https://github.com/${github.repository}/commit/${full}` : null;
  return (
    <>
      <h3 className="px-4 pt-3 font-mono text-[13px] break-all text-foreground">{full}</h3>
      <InspectorSection title="Dove compare">
        {candidates.map((candidate) => (
          <Row key={candidate.id} label="Base di">
            <Go onClick={() => openReference({ kind: "candidate", id: candidate.id })}>{candidate.id}</Go>
          </Row>
        ))}
        {branches.map((branch) => (
          <Row key={branch.name} label="Ultimo di">
            <Go mono onClick={() => openReference({ kind: "branch", name: branch.name })}>
              {branch.name}
            </Go>
          </Row>
        ))}
        {pulls.map((pr) => (
          <Row key={pr.number} label="Ultimo della">
            <Go onClick={() => openReference({ kind: "pullRequest", number: pr.number })}>PR #{pr.number}</Go>
          </Row>
        ))}
        {!candidates.length && !branches.length && !pulls.length ? <EmptyNote>Trama non collega questo commit a un candidato, a un branch o a una PR.</EmptyNote> : null}
      </InspectorSection>
      <div className="px-4 pb-3">
        <OnGitHub url={url} />
      </div>
    </>
  );
}

export function BranchView({ name }: { name: string }) {
  const project = useUi((s) => s.app?.project)!;
  const github = project.github;
  const remote = github.snapshot?.branches.find((b) => b.name === name) ?? null;
  const pulls = github.snapshot?.pullRequests.filter((p) => p.headRef === name) ?? [];
  const work = assignmentsOf(project).filter(({ assignment }) => assignment.workspace?.branch === name);
  const candidates = project.document.candidates.filter((c) => c.pullRequest?.branch === name);
  const onGitHub = remote || pulls.length || candidates.length;
  const url = onGitHub && github.repository ? `https://github.com/${github.repository}/tree/${name.split("/").map(encodeURIComponent).join("/")}` : null;
  return (
    <>
      <h3 className="px-4 pt-3 font-mono text-[13px] break-all text-foreground">{name}</h3>
      <InspectorSection title="Cosa c'è sopra">
        {remote ? (
          <Row label="Ultimo commit">
            <Go mono onClick={() => openReference({ kind: "commit", sha: remote.sha })}>
              {remote.sha.slice(0, 7)}
            </Go>
          </Row>
        ) : null}
        {pulls.map((pr) => (
          <Row key={pr.number} label="PR">
            <Go onClick={() => openReference({ kind: "pullRequest", number: pr.number })}>
              #{pr.number} {pr.title}
            </Go>
          </Row>
        ))}
        {work.map(({ specialist, assignment }) => (
          <Row key={assignment.id} label="Incarico">
            <Go onClick={() => openReference({ kind: "assignment", id: assignment.id, specialistId: specialist.id })}>
              {specialist.name}: {assignment.objective}
            </Go>
          </Row>
        ))}
        {candidates.map((candidate) => (
          <Row key={candidate.id} label="Candidato">
            <Go onClick={() => openReference({ kind: "candidate", id: candidate.id })}>{candidate.id}</Go>
          </Row>
        ))}
        {!remote && !pulls.length && !work.length && !candidates.length ? <EmptyNote>Trama non collega questo branch a un incarico o a una PR.</EmptyNote> : null}
      </InspectorSection>
      <div className="px-4 pb-3">
        <OnGitHub url={url} />
      </div>
    </>
  );
}
