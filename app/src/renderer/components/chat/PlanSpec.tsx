import type { SpecSections, WorkPlan } from "@shared/domain";
import type { MessageKey } from "@shared/i18n";
import { useState } from "react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge, Input, TextArea } from "@/components/ui/field";
import { useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";
import { PlanSlices } from "./PlanSlices";

/**
 * The body of a plan written as a spec with AI Hero's to-spec (M04): the seam check the person answers, then the
 * spec with the template's sections, where it was published, and the person's corrections; then its slices (M05).
 */

type ListKey = "userStories" | "implementationDecisions" | "testingDecisions";
type Draft = Omit<SpecSections, ListKey> & Record<ListKey, string>;

const LIST_LABELS: Record<ListKey, MessageKey> = {
  userStories: "chat.plan.userStories",
  implementationDecisions: "chat.plan.implementationDecisions",
  testingDecisions: "chat.plan.testingDecisions",
};

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <div className="text-ui-xs text-muted-foreground/70">{label}</div>
      <div className="mt-0.5 text-ui text-foreground/90 whitespace-pre-line">{children}</div>
    </div>
  );
}

function List({ items, numbered }: { items: string[]; numbered?: boolean }) {
  const t = useT();
  if (!items.length) return <span className="text-muted-foreground">{t("chat.plan.noneFeminine")}</span>;
  const Tag = numbered ? "ol" : "ul";
  return (
    <Tag className={numbered ? "list-decimal space-y-0.5 pl-4" : "list-disc space-y-0.5 pl-4"}>
      {items.map((item, index) => (
        <li key={`${index}-${item}`}>{item}</li>
      ))}
    </Tag>
  );
}

const toDraft = (sections: SpecSections): Draft => ({
  ...sections,
  userStories: sections.userStories.join("\n"),
  implementationDecisions: sections.implementationDecisions.join("\n"),
  testingDecisions: sections.testingDecisions.join("\n"),
});

const fromDraft = (draft: Draft): SpecSections => ({
  ...draft,
  userStories: draft.userStories.split("\n"),
  implementationDecisions: draft.implementationDecisions.split("\n"),
  testingDecisions: draft.testingDecisions.split("\n"),
});

function SpecEditor({ plan, sections, onClose }: { plan: WorkPlan; sections: SpecSections; onClose: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState<Draft>(() => toDraft(sections));
  const field = (key: keyof Draft, label: string, hint?: string) => (
    <label className="block text-ui-xs text-muted-foreground">
      {label}
      {hint ? `, ${hint}` : ""}
      <TextArea value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} className="mt-1 min-h-12" />
    </label>
  );
  return (
    <div className="mt-2 space-y-2">
      <label className="block text-ui-xs text-muted-foreground">
        {t("chat.plan.title")}
        <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="mt-1" />
      </label>
      {field("problemStatement", t("chat.plan.problem"))}
      {field("solution", t("chat.plan.solution"))}
      {(Object.keys(LIST_LABELS) as ListKey[]).map((key) => (
        <div key={key}>{field(key, t(LIST_LABELS[key]), t("chat.plan.onePerLine"))}</div>
      ))}
      {field("outOfScope", t("chat.plan.outOfScope"))}
      {field("furtherNotes", t("chat.plan.furtherNotes"))}
      <div className="cta-row">
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t("chat.plan.cancel")}
        </Button>
        <Button size="sm" onClick={() => void act("plan:edit", { planId: plan.id, sections: fromDraft(draft) }).then(onClose)}>
          {t("chat.plan.saveSpec")}
        </Button>
      </div>
    </div>
  );
}

export function PlanSpecBody({ plan }: { plan: WorkPlan }) {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const [correction, setCorrection] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const spec = plan.spec;
  if (!spec) return null;
  const sections = spec.sections;
  const moduleName = (id: string) => project.snapshot.modules.find((m) => m.id === id)?.name ?? id;
  const connected = Boolean(project.github.repository) && project.github.status !== "unavailable";
  const answer = spec.seamsAnswer;

  return (
    <div data-testid="plan-spec" data-status={plan.status}>
      {sections ? (
        <>
          <p className="mt-2 text-ui font-medium text-foreground">{sections.title}</p>
          {plan.editedAt ? <p className="text-ui-xs text-muted-foreground">{t("chat.plan.editedByYou")}</p> : null}
          <Section label={t("chat.plan.problem")}>{sections.problemStatement}</Section>
          <Section label={t("chat.plan.solution")}>{sections.solution}</Section>
        </>
      ) : plan.status === "seams" ? (
        <p className="mt-2 text-ui text-foreground/90">{t("chat.plan.seamsIntro")}</p>
      ) : null}

      <Section label={t("chat.plan.seams")}>
        <div className="space-y-1.5">
          {spec.seams.map((seam) => (
            <div key={seam.seam} data-testid="plan-seam" className="rounded-lg border border-[color:var(--color-border)] px-3 py-2">
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 text-ui text-foreground">{seam.seam}</span>
                <Badge tone={seam.existing ? "success" : "info"}>{seam.existing ? t("chat.plan.seamExisting") : t("chat.plan.seamNew")}</Badge>
              </div>
              <div className="mt-0.5 text-ui-sm text-muted-foreground">{t("chat.plan.seamTests", { tests: seam.tests })}</div>
            </div>
          ))}
        </div>
      </Section>
      {answer ? (
        <p className="mt-1 text-ui-xs text-muted-foreground">{answer.confirmed ? (answer.by === "coordinator" ? t("chat.plan.seamsConfirmedByCoordinator") : t("chat.plan.seamsConfirmedByYou")) : t("chat.plan.seamsCorrected", { note: answer.note ?? "" })}</p>
      ) : null}

      {plan.status === "seams" ? (
        correction === null ? (
          <div className="cta-row mt-3">
            <Button size="sm" variant="ghost" onClick={() => setCorrection("")}>
              {t("chat.plan.correctSeams")}
            </Button>
            <Button size="sm" onClick={() => void act("plan:answerSeams", { planId: plan.id, confirmed: true, note: null })}>
              {t("chat.plan.confirmSeams")}
            </Button>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <TextArea
              value={correction}
              onChange={(e) => setCorrection(e.target.value)}
              placeholder={t("chat.plan.seamsCorrectionPlaceholder")}
              aria-label={t("chat.plan.seamsCorrectionLabel")}
              className="min-h-12"
            />
            <div className="cta-row">
              <Button size="sm" variant="ghost" onClick={() => setCorrection(null)}>
                {t("chat.plan.cancel")}
              </Button>
              <Button
                size="sm"
                disabled={!correction.trim()}
                onClick={() => void act("plan:answerSeams", { planId: plan.id, confirmed: false, note: correction.trim() }).then(() => setCorrection(null))}
              >
                {t("chat.plan.sendCorrection")}
              </Button>
            </div>
          </div>
        )
      ) : null}

      {sections ? (
        <>
          {expanded ? (
            <>
              {(Object.keys(LIST_LABELS) as ListKey[]).map((key) => (
                <Section key={key} label={t(LIST_LABELS[key])}>
                  <List items={sections[key]} numbered={key === "userStories"} />
                </Section>
              ))}
              <Section label={t("chat.plan.outOfScope")}>{sections.outOfScope || t("chat.plan.noneMasculine")}</Section>
              <Section label={t("chat.plan.furtherNotes")}>{sections.furtherNotes || t("chat.plan.noneFeminine")}</Section>
              {spec.affectedModuleIDs.length ? <Section label={t("chat.plan.modules")}>{spec.affectedModuleIDs.map(moduleName).join(", ")}</Section> : null}
              {spec.requiredDecisionIDs.length ? <Section label={t("chat.plan.requiredDecisions")}>{spec.requiredDecisionIDs.join(", ")}</Section> : null}
              {spec.references.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {spec.references.slice(0, 10).map((path) => (
                    <button
                      key={path}
                      type="button"
                      onClick={() => setInspector({ kind: "file", path })}
                      className="rounded-md bg-[var(--color-background-button-secondary)] px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {path}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
          <button type="button" className="mt-2 text-ui-sm text-[var(--color-text-accent)] hover:underline" onClick={() => setExpanded(!expanded)}>
            {expanded ? t("chat.plan.showLess") : t("chat.plan.showAll", { count: sections.userStories.length })}
          </button>

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-sm text-muted-foreground" data-testid="plan-spec-publication">
            {spec.issue ? (
              <>
                <span>{t("chat.plan.publishedAs", { number: String(spec.issue.number) })}</span>
                <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={() => void act("shell:openExternal", { url: spec.issue!.url })}>
                  {t("chat.plan.openIssue")}
                </button>
              </>
            ) : connected ? (
              <span>{t("chat.plan.notPublished")}</span>
            ) : (
              <span>{t("chat.plan.notConnected")}</span>
            )}
            {spec.publishFailure ? <span className="text-warning">{spec.publishFailure}</span> : null}
          </div>

          {editing ? (
            <SpecEditor plan={plan} sections={sections} onClose={() => setEditing(false)} />
          ) : plan.status === "ready" || plan.status === "stale" ? (
            <div className="cta-row mt-3">
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                {t("chat.plan.correctSpec")}
              </Button>
              {connected && !spec.issue && plan.status === "ready" ? (
                <Button size="sm" variant="outline" onClick={() => void act("plan:publish", { planId: plan.id })}>
                  {t("chat.plan.publish")}
                </Button>
              ) : null}
              {/* A spec written before M05 has no slices yet: the person can have it split, or approve it as a whole. */}
              {!plan.slicing && plan.status === "ready" ? (
                <Button size="sm" variant="outline" onClick={() => void act("plan:slice", { planId: plan.id })}>
                  {t("chat.plan.slice")}
                </Button>
              ) : null}
              {!plan.slicing ? (
                <Button
                  size="sm"
                  disabled={plan.status === "stale"}
                  onClick={() =>
                    void act("coordinator:send", {
                      text: t("chat.plan.approveMessage", { id: plan.id }),
                      moduleId: null,
                      model: null,
                      effort: null,
                    })
                  }
                >
                  {t("chat.plan.approve")}
                </Button>
              ) : null}
            </div>
          ) : null}
          <PlanSlices plan={plan} />
        </>
      ) : null}
    </div>
  );
}
