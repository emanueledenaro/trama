import { IconArrowLeft, IconCircleCheck, IconCircleDot, IconExternalLink, IconMessageCircle, IconPlus, IconRefresh } from "@tabler/icons-react";
import { useState } from "react";
import { ChatMarkdown } from "@/components/chat/ChatMarkdown";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Badge, Input, Label, TextArea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { act, useUi } from "@/lib/store";
import { EmptyNote, InspectorSection } from "./Inspector";

export function IssuesView() {
  const github = useUi((s) => s.app?.project?.github)!;
  const setInspector = useUi((s) => s.setInspector);
  const [filter, setFilter] = useState<"open" | "closed">("open");
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
                  .join(" · ")
              : github.capabilities.message}
          </p>
        ) : null}
        {github.status === "ready" ? (
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg bg-[var(--color-background-button-secondary)] p-0.5">
              {(["open", "closed"] as const).map((state) => (
                <button
                  key={state}
                  type="button"
                  onClick={() => setFilter(state)}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-ui-sm transition-colors",
                    filter === state ? "bg-[var(--color-background-surface)] text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {state === "open" ? "Aperte" : "Chiuse"} ({github.issues.filter((i) => i.state === state).length})
                </button>
              ))}
            </div>
            <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setCreating(!creating)}>
              <IconPlus /> Nuova issue
            </Button>
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
            <div className="flex gap-2">
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
      {github.status === "ready" ? (
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
                  #{issue.number} · {formatRelativeTime(issue.updatedAt)}
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
  const issue = useUi((s) => s.app?.project?.github.issues.find((i) => i.number === number));
  const setInspector = useUi((s) => s.setInspector);
  const focusComposer = useUi((s) => s.focusComposer);
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
          {issue.author ? <span>· {issue.author}</span> : null}
          {issue.labels.map((label) => (
            <Badge key={label} tone="outline">
              {label}
            </Badge>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="outline" onClick={() => focusComposer()}>
            <IconMessageCircle stroke={1.8} /> Chiedi al Coordinatore
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void act("shell:openExternal", { url: issue.url })}>
            <IconExternalLink stroke={1.8} /> GitHub
          </Button>
        </div>
      </div>
      <InspectorSection title="Descrizione">
        {issue.body ? <ChatMarkdown text={issue.body} /> : <EmptyNote>Nessuna descrizione.</EmptyNote>}
      </InspectorSection>
    </>
  );
}
