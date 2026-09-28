import { IconArrowLeft, IconCircleCheck, IconCircleDot, IconExternalLink, IconMessageCircle, IconPlayerPlay, IconPlus, IconRefresh } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { issueTriage } from "@shared/duties";
import { problemBacklog } from "@shared/problems";
import { assignmentStatus } from "@shared/states";
import { ReferenceText } from "@/components/chat/ReferenceText";
import { Tooltip } from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n";
import { ChatMarkdown } from "@/components/chat/ChatMarkdown";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Badge, Input, Label, TextArea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { act, useUi } from "@/lib/store";
import { issueQuestion } from "@/lib/askCoordinator";
import { useTriageOnRequest } from "./AutomaticWork";
import { EmptyNote, InspectorSection } from "./Inspector";
import { Sep } from "@/components/ui/sep";

/**
 * The backlog items the found problems became (A08): with their issue, or kept in Trama without GitHub. It was a
 * section of Activity; it is the "Nel backlog" filter of the issues since Activity moved to the bottom panel (issue #337).
 */
function ProblemBacklog() {
  const t = useT();
  const document = useUi((s) => s.app?.project?.document);
  const items = useMemo(() => (document ? problemBacklog(document) : []), [document]);
  return (
    <ul aria-label={t("issues.backlog.label")} className="flex flex-col divide-y divide-[color:var(--app-surface-divider)] px-4 py-1" data-testid="problem-backlog">
      {items.map((problem) => (
        <li key={problem.id} className="py-2" data-testid="problem-backlog-item">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-ui text-foreground" title={problem.id}>
              <ReferenceText text={problem.title} links={false} />
            </span>
            {problem.issue ? (
              <Tooltip label={t("issues.backlog.openIssue", { number: problem.issue.number })}>
                <button
                  type="button"
                  aria-label={t("issues.backlog.openIssue", { number: problem.issue.number })}
                  className="sidebar-icon-button h-6 shrink-0 gap-1 rounded-md px-1.5 text-ui-xs"
                  onClick={() => void act("shell:openExternal", { url: problem.issue!.url })}
                >
                  <IconCircleDot className="size-3.5" stroke={1.8} />#{problem.issue.number}
                </button>
              </Tooltip>
            ) : (
              <Badge tone="secondary">{t("issues.backlog.onlyTrama")}</Badge>
            )}
          </div>
          <p className="mt-0.5 text-ui-xs text-muted-foreground">{problem.evidence.label}</p>
          {problem.placement ? (
            <p className="mt-1 text-ui-sm text-muted-foreground">
              <ReferenceText text={problem.placement.reason} />
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function IssuesView({ backlog: onBacklog = false }: { backlog?: boolean }) {
  const t = useT();
  const github = useUi((s) => s.app?.project?.github)!;
  const setInspector = useUi((s) => s.setInspector);
  const backlog = useUi((s) => (s.app?.project ? problemBacklog(s.app.project.document).length : 0));
  const [chosen, setFilter] = useState<"open" | "closed" | "backlog">(onBacklog ? "backlog" : "open");
  // Without GitHub the backlog is the only list; an empty backlog falls back to the open issues.
  const filter = github.status !== "ready" && backlog ? "backlog" : chosen === "backlog" && !backlog ? "open" : chosen;
  const filters = [...(github.status === "ready" ? (["open", "closed"] as const) : []), ...(backlog ? (["backlog"] as const) : [])];
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const issues = github.issues.filter((i) => i.state === filter);

  return (
    <>
      <InspectorSection
        title={github.repository ?? "GitHub"}
        aside={
          <div className="flex items-center gap-1">
            {github.status === "loading" ? <Spinner /> : null}
            <button type="button" className="sidebar-icon-button size-6 rounded-md" aria-label="Aggiorna le issue" onClick={() => void act("github:refresh", undefined)}>
              <IconRefresh className="size-3.5" />
            </button>
          </div>
        }
      >
        {github.status === "unavailable" ? <EmptyNote>{github.message}</EmptyNote> : null}
        {github.capabilities ? (
          <p className="mb-2 text-ui-xs text-muted-foreground">
            {github.capabilities.status === "ready"
              ? [
                  github.capabilities.login ? `Accesso come ${github.capabilities.login}` : "Accesso con gh",
                  github.capabilities.private ? "repository privato" : "repository pubblico",
                  github.capabilities.canPush ? "puoi pubblicare branch e pull request" : "sola lettura: niente push",
                  github.capabilities.rateRemaining !== null ? `${github.capabilities.rateRemaining} richieste API rimaste` : null,
                ]
                  .filter(Boolean)
                  .join(", ")
              : github.capabilities.message}
          </p>
        ) : null}
        {filters.length ? (
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg bg-[var(--color-background-button-secondary)] p-0.5">
              {filters.map((state) => (
                <button
                  key={state}
                  type="button"
                  onClick={() => setFilter(state)}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-ui-sm transition-colors",
                    filter === state ? "bg-[var(--color-background-surface)] text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {state === "backlog"
                    ? t("issues.filter.backlog", { count: backlog })
                    : `${state === "open" ? "Aperte" : "Chiuse"} (${github.issues.filter((i) => i.state === state).length})`}
                </button>
              ))}
            </div>
            {github.status === "ready" ? (
              <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setCreating(!creating)}>
                <IconPlus /> Nuova issue
              </Button>
            ) : null}
          </div>
        ) : null}
      </InspectorSection>
      {creating ? (
        <InspectorSection title="Nuova issue">
          <div className="space-y-2">
            <div>
              <Label>Titolo</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Label>Descrizione</Label>
              <TextArea value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
            <p className="text-ui-xs text-muted-foreground">La issue viene pubblicata su GitHub con l'accesso di GitHub CLI.</p>
            <div className="cta-row">
              <Button
                size="sm"
                disabled={!title.trim()}
                onClick={() =>
                  void act("github:createIssue", { title, body }).then(() => {
                    setTitle("");
                    setBody("");
                    setCreating(false);
                  })
                }
              >
                Pubblica issue
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
                Annulla
              </Button>
            </div>
          </div>
        </InspectorSection>
      ) : null}
      {filter === "backlog" ? <ProblemBacklog /> : null}
      {github.status === "ready" && filter !== "backlog" ? (
        <div className="px-2 py-2">
          {issues.length === 0 ? <div className="px-2"><EmptyNote>Nessuna issue.</EmptyNote></div> : null}
          {issues.map((issue) => (
            <button
              key={issue.number}
              type="button"
              onClick={() => setInspector({ kind: "issue", number: issue.number })}
              className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--sidebar-accent)]"
            >
              {issue.state === "open" ? (
                <IconCircleDot className="mt-0.5 size-3.5 shrink-0 text-[var(--status-open,var(--success))]" stroke={1.8} />
              ) : (
                <IconCircleCheck className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-ui text-foreground/90">{issue.title}</span>
                <span className="block text-ui-xs text-muted-foreground">
                  #{issue.number}<Sep />{formatRelativeTime(issue.updatedAt)}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

export function IssueDetail({ number }: { number: number }) {
  const t = useT();
  const issue = useUi((s) => s.app?.project?.github.issues.find((i) => i.number === number));
  const triage = useUi((s) => (s.app?.project ? issueTriage(s.app.project.document, number) : null));
  const onRequest = useTriageOnRequest();
  const [starting, setStarting] = useState(false);
  const setInspector = useUi((s) => s.setInspector);
  const askCoordinator = useUi((s) => s.askCoordinator);
  if (!issue) return <div className="p-4"><EmptyNote>Issue non trovata.</EmptyNote></div>;
  return (
    <>
      <div className="px-4 pt-3">
        <button type="button" className="inline-flex items-center gap-1 text-ui-sm text-muted-foreground hover:text-foreground" onClick={() => setInspector({ kind: "issues" })}>
          <IconArrowLeft className="size-3.5" /> Issue
        </button>
        <h3 className="mt-2 text-ui-lg font-medium text-foreground">{issue.title}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-ui-sm text-muted-foreground">
          <Badge tone={issue.state === "open" ? "success" : "secondary"}>{issue.state === "open" ? "Aperta" : "Chiusa"}</Badge>
          <span>#{issue.number}</span>
          {issue.author ? <span><Sep />{issue.author}</span> : null}
          {issue.labels.map((label) => (
            <Badge key={label} tone="outline">
              {label}
            </Badge>
          ))}
        </div>
        <div className="cta-row mt-3">
          <Button size="sm" variant="ghost" onClick={() => void act("shell:openExternal", { url: issue.url })}>
            <IconExternalLink stroke={1.8} /> Apri su GitHub
          </Button>
          <Button size="sm" variant={onRequest && issue.state === "open" ? "outline" : "default"} onClick={() => askCoordinator(issueQuestion(issue))}>
            <IconMessageCircle stroke={1.8} /> Chiedi al Coordinatore
          </Button>
          {onRequest && issue.state === "open" ? (
            <Button
              size="sm"
              data-testid="issue-triage-start"
              disabled={!onRequest.allowed || starting}
              onClick={() => {
                setStarting(true);
                void act("automaticWork:start", { kind: "triage", issueNumber: issue.number }).finally(() => setStarting(false));
              }}
            >
              <IconPlayerPlay stroke={1.8} /> {triage ? "Rifai il triage ora" : "Avvia il triage ora"}
            </Button>
          ) : null}
        </div>
        {onRequest && issue.state === "open" && onRequest.reason ? <p className="mt-1.5 text-right text-ui-xs text-muted-foreground">{onRequest.reason}</p> : null}
      </div>
      <InspectorSection title="Descrizione">
        {issue.body ? <ChatMarkdown text={issue.body} /> : <EmptyNote>Nessuna descrizione.</EmptyNote>}
      </InspectorSection>
      {triage ? (
        <InspectorSection
          title="Triage di Trama"
          aside={<Badge tone={assignmentStatus(t, triage.status).tone}>{assignmentStatus(t, triage.status).label}</Badge>}
        >
          {triage.duty?.outcome?.kind === "triage" && triage.result ? (
            <ChatMarkdown text={triage.result} />
          ) : (
            <p className="text-ui-sm text-muted-foreground">{triage.lastUpdate}</p>
          )}
          <div className="cta-row mt-2">
            <Button size="sm" variant="ghost" onClick={() => setInspector({ kind: "specialist", id: triage.specialistId })}>
              Apri il bug triage
            </Button>
          </div>
        </InspectorSection>
      ) : null}
    </>
  );
}
