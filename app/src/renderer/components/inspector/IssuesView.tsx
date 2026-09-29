import { IconArrowLeft, IconExternalLink, IconMessageCircle, IconPlayerPlay } from "@tabler/icons-react";
import { useT } from "@/lib/i18n";
import { useState } from "react";
import { issueTriage } from "@shared/duties";
import { assignmentStatus } from "@shared/states";
import { ChatMarkdown } from "@/components/chat/ChatMarkdown";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { act, useUi } from "@/lib/store";
import { issueQuestion } from "@/lib/askCoordinator";
import { useTriageOnRequest } from "./AutomaticWork";
import { EmptyNote, InspectorSection } from "./Inspector";
import { Sep } from "@/components/ui/sep";

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
