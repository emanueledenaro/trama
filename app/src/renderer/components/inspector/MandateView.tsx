import { IconBan, IconChevronRight, IconHourglass } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { type MandateAction, type MandateSnapshot, pendingMandateRequest } from "@shared/domain";
import { fixedBans } from "@shared/fixedBans";
import { DelegationSection } from "@/components/chat/Delegation";
import type { Translate } from "@shared/i18n";
import { waitingItemFor } from "@shared/waitingForYou";
import { MandateCard } from "@/components/chat/Cards";
import { useWaiting } from "@/components/WaitingView";
import { Button } from "@/components/ui/button";
import { Label, TextArea } from "@/components/ui/field";
import { formatDate } from "@/lib/format";
import { actionLabel, DELEGABLE_ACTIONS } from "@/lib/labels";
import { act, useUi } from "@/lib/store";
import { DisclosureSection, EmptyNote } from "./Inspector";
import { ModulesList } from "./MapView";
import { Sep } from "@/components/ui/sep";
import { AgentName } from "@/components/AgentIdentity";
import { useT } from "@/lib/i18n";
import { type StoppedWork, workStoppedBy } from "@shared/mandate";

/** A label of a list after the first, in lower case, so the list reads as one sentence. */
const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

const sentence = (items: string[]) => items.map((item, index) => (index === 0 ? item : lower(item))).join(", ");

/** What a restriction took away, in one line. */
function restrictionText(t: Translate, restriction: NonNullable<MandateSnapshot["restriction"]>, moduleName: (id: string) => string): string {
  const parts = [
    restriction.removedModuleIds.length ? t("rules.mandate.removedModules", { list: restriction.removedModuleIds.map(moduleName).join(", ") }) : null,
    restriction.removedActions.length ? t("rules.mandate.removedActions", { list: restriction.removedActions.map((a) => lower(actionLabel(t, a))).join(", ") }) : null,
  ].filter(Boolean);
  return t("rules.mandate.restriction", { parts: parts.join("; ") });
}

/** The work a change of the mandate stops before it takes effect; a dependent says which work it builds on (C06). */
export function StoppedWorkList({ stopping, lead }: { stopping: StoppedWork[]; lead: string }) {
  const t = useT();
  return (
    <>
      <p className="text-ui-sm text-muted-foreground">
        {lead} {stopping.length ? t("mandate.stoppedWork.some") : t("mandate.stoppedWork.none")}
      </p>
      {stopping.length ? (
        <ul className="list-disc space-y-0.5 pl-4 text-ui-sm text-foreground/90" data-testid="mandate-stopped-work">
          {stopping.map(({ specialist, assignment, dependsOn }) => (
            <li key={assignment.id} className="break-words">
              <AgentName agent={specialist} />
              <Sep />
              {assignment.objective}
              {dependsOn ? <span className="text-muted-foreground"> {t("mandate.stoppedWork.dependsOn", { objective: dependsOn.objective })}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

/** One row of the mandate in two words: Dove, Può, Mai (issue #334). */
function RuleRow({ label, children, testId, title }: { label: string; children: React.ReactNode; testId?: string; title?: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground/90" data-testid={testId} title={title}>
        {children}
      </dd>
    </>
  );
}

/** The proposal of a new mandate waits in Aspetta te: here only a line that leads there, never the card twice. */
function ProposalReference({ requestId }: { requestId: string }) {
  const t = useT();
  const setInspector = useUi((s) => s.setInspector);
  const item = waitingItemFor(useWaiting(), "mandate", requestId);
  // A proposal that is not in Aspetta te would be out of reach: then its card stays here.
  if (!item) return <MandateCard requestId={requestId} />;
  return (
    <button
      type="button"
      aria-label={t("rules.mandate.proposalOpen")}
      title={t("rules.mandate.proposalOpen")}
      className="-mx-2 flex w-[calc(100%+1rem)] min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui text-foreground transition-colors hover:bg-[var(--sidebar-accent)]"
      data-testid="mandate-proposal-reference"
      data-waiting-key={item.key}
      onClick={() => setInspector({ kind: "waiting", key: item.key })}
    >
      <IconHourglass className="size-3.5 shrink-0 text-[var(--color-text-accent)]" stroke={1.8} />
      <span className="min-w-0 flex-1 truncate">{t("rules.mandate.proposalWaiting")}</span>
      <IconChevronRight className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
    </button>
  );
}

type Change = "restrict" | "correct" | "revoke";

/**
 * Mandato in Regole (issue #334): the version, where the Coordinator acts, what it can do and what never, in three
 * rows. The proposal that waits for the person is one line to Aspetta te. Moduli, the changes and the earlier versions
 * are closed sections; `modulesOpen` opens the modules (the map of today), `change` opens the correction form.
 */
export function MandateView({ modulesOpen = false, change }: { modulesOpen?: boolean; change?: "correct" }) {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const { mandate, mandateRequests } = project.document;
  const pending = pendingMandateRequest({ mandateRequests });
  const granted = mandate?.status === "granted" ? mandate : null;
  const source = pending ?? granted;
  const modules = project.snapshot.modules;
  const [objectives, setObjectives] = useState("");
  const [priorities, setPriorities] = useState("");
  const [limits, setLimits] = useState("");
  const [scope, setScope] = useState<string[]>([]);
  const [actions, setActions] = useState<MandateAction[]>(["plan"]);
  const [revocation, setRevocation] = useState("");
  const [showModules, setShowModules] = useState(modulesOpen);
  // The map opened from elsewhere (the search, an exercise) opens the modules here.
  useEffect(() => {
    if (modulesOpen) setShowModules(true);
  }, [modulesOpen]);
  // Open, the modules are the map of today: the target says so, for the way back and for the example's exercise.
  const toggleModules = () => {
    setShowModules(!showModules);
    if (!showModules) setInspector({ kind: "map" });
  };
  const [showGoals, setShowGoals] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // "Cambia il mandato" is closed until the person opens it; without a mandate it is where one is granted.
  const [showChange, setShowChange] = useState(Boolean(change) || !granted);
  const [mode, setMode] = useState<Change | null>(change ?? null);
  const stopping = mode === "revoke" ? workStoppedBy(project.document, null) : [];
  // Restricting keeps the mandate and takes modules or actions away (issue #244).
  const [keptModules, setKeptModules] = useState<string[]>([]);
  const [keptActions, setKeptActions] = useState<MandateAction[]>([]);
  const moduleName = (id: string) => modules.find((m) => m.id === id)?.name ?? id;
  const startRestricting = () => {
    setKeptModules(granted?.scopeModuleIds ?? []);
    setKeptActions(granted?.authorizedActions ?? []);
    setMode("restrict");
  };
  const narrower =
    granted !== null &&
    keptModules.length > 0 &&
    keptActions.length > 0 &&
    (keptModules.length < granted.scopeModuleIds.length || keptActions.length < granted.authorizedActions.length);

  useEffect(() => {
    setObjectives(source?.objectives.join("\n") ?? "");
    setPriorities(source?.priorities.join("\n") ?? "");
    setLimits(source?.limits.join("\n") ?? "");
    setScope(source?.scopeModuleIds ?? []);
    setActions(source?.authorizedActions ?? ["plan"]);
    // A new version (a restriction, a correction) reloads the form: saving a correction never brings back what went.
  }, [source?.objectives.join("|"), pending?.id, mandate?.version, mandate?.status]);

  const valid = lines(objectives).length > 0 && scope.length > 0 && actions.length > 0;
  const grant = () =>
    act("mandate:grant", {
      requestId: pending?.id ?? null,
      objectives: lines(objectives),
      priorities: lines(priorities),
      scopeModuleIds: scope,
      authorizedActions: actions,
      limits: lines(limits),
    }).then(() => setMode(null));

  const checkbox = "accent-[var(--color-text-accent)]";
  const optionRow = "flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-ui hover:bg-[var(--sidebar-accent)]";

  return (
    <div className="pb-3" data-testid="mandate-view">
      <div className="px-4 pt-3 pb-2">
        <p className="text-ui text-muted-foreground" data-testid="mandate-state">
          {granted ? (
            <>
              <span className="font-medium text-foreground">{t("rules.mandate.title", { version: granted.version })}</span>
              <Sep />
              <span>{granted.restriction ? t("rules.mandate.restricted", { date: formatDate(granted.grantedAt) }) : t("rules.mandate.granted", { date: formatDate(granted.grantedAt) })}</span>
            </>
          ) : mandate ? (
            <span className="font-medium text-foreground">{t("rules.mandate.revoked")}</span>
          ) : (
            <span className="font-medium text-foreground">{t("rules.mandate.none")}</span>
          )}
        </p>
        {!mandate ? <EmptyNote>{t("rules.mandate.noneNote")}</EmptyNote> : null}
        {mandate?.status === "revoked" ? (
          <p className="mt-1 text-ui-sm text-foreground/90">{t("rules.mandate.revokedReason", { reason: mandate.revocation?.reason ?? "" })}</p>
        ) : null}
        {/* What asks the person something comes right under the state, before the rules (critique of 29 September 2026). */}
        {pending ? (
          <div className="mt-2">
            <ProposalReference requestId={pending.id} />
          </div>
        ) : null}
        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-ui-sm">
          {granted ? (
            <>
              <RuleRow label={t("rules.mandate.where")} testId="mandate-where">
                {t("rules.mandate.whereModules", { modules: granted.scopeModuleIds.map(moduleName).join(", "), count: granted.scopeModuleIds.length, total: modules.length })}
              </RuleRow>
              <RuleRow label={t("rules.mandate.can")} testId="mandate-can">
                {sentence(granted.authorizedActions.map((a) => actionLabel(t, a)))}
              </RuleRow>
            </>
          ) : null}
          {/* Every mandate, also one granted before the fixed bans existed, excludes them (issue #244). A short list, one
              ban per line: the dense sentence read badly (critique of 29 September 2026). */}
          <RuleRow label={t("rules.mandate.never")} testId="fixed-bans" title={t("rules.mandate.neverNote")}>
            <ul className="space-y-0.5">
              {fixedBans(t).map((ban) => (
                <li key={ban.id} className="flex min-w-0 items-baseline gap-1.5" data-testid="fixed-ban">
                  <IconBan className="size-3 shrink-0 translate-y-0.5 text-muted-foreground" stroke={1.8} aria-hidden />
                  <span className="min-w-0">{ban.label}</span>
                </li>
              ))}
            </ul>
          </RuleRow>
        </dl>
        {granted?.restriction ? (
          <p className="mt-2 text-ui-sm text-muted-foreground" data-testid="mandate-restriction">
            {restrictionText(t, granted.restriction, moduleName)}
          </p>
        ) : null}
      </div>
      <DelegationSection />
      {granted ? (
        <DisclosureSection
          title={t("rules.mandate.goals")}
          count={granted.objectives.length}
          open={showGoals}
          onToggle={() => setShowGoals(!showGoals)}
          testId="mandate-goals"
        >
          <div className="space-y-1.5 text-ui-sm">
            <div className="text-muted-foreground">
              {t("rules.mandate.objectives")}
              <ul className="list-disc pl-4 text-foreground/90">
                {granted.objectives.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </div>
            {granted.priorities.length ? (
              <div className="text-muted-foreground">
                {t("rules.mandate.priorities")}
                <ul className="list-disc pl-4 text-foreground/90">
                  {granted.priorities.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {granted.limits.length ? (
              <div className="text-muted-foreground">
                {t("rules.mandate.limits")}
                <ul className="list-disc pl-4 text-foreground/90">
                  {granted.limits.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </DisclosureSection>
      ) : null}
      <DisclosureSection title={t("rules.modules.title")} count={modules.length} open={showModules} onToggle={toggleModules} testId="mandate-modules">
        <ModulesList />
      </DisclosureSection>
      <DisclosureSection
        title={granted ? t("rules.change.title") : t("rules.change.grantTitle")}
        open={showChange}
        onToggle={() => setShowChange(!showChange)}
        testId="mandate-change"
      >
        {mode === null ? (
          <div className="space-y-2">
            <EmptyNote>{granted ? t("rules.change.lead") : t("rules.change.grantLead")}</EmptyNote>
            {/* Each opens its form: nothing changes until the form is confirmed. */}
            <div className="cta-row">
              {granted ? (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setMode("revoke")}>
                    {t("rules.change.revoke")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={startRestricting}>
                    {t("rules.change.restrict")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setMode("correct")}>
                    {t("rules.change.correct")}
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setMode("correct")}>
                  {t("rules.change.write")}
                </Button>
              )}
            </div>
          </div>
        ) : null}
        {mode === "restrict" && granted ? (
          <div className="space-y-3" data-testid="mandate-restrict">
            <p className="text-ui-sm text-muted-foreground">{t("rules.restrict.lead")}</p>
            <div>
              <Label>{t("rules.restrict.modules")}</Label>
              <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-lg border border-input p-1">
                {granted.scopeModuleIds.map((id) => (
                  <label key={id} className={optionRow}>
                    <input
                      type="checkbox"
                      className={checkbox}
                      checked={keptModules.includes(id)}
                      onChange={(e) => setKeptModules(e.target.checked ? [...keptModules, id] : keptModules.filter((m) => m !== id))}
                    />
                    <span className="min-w-0 flex-1 truncate">{moduleName(id)}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label>{t("rules.restrict.actions")}</Label>
              <div className="flex flex-col gap-1">
                {granted.authorizedActions.map((action) => (
                  <label key={action} className="flex cursor-pointer items-center gap-2 text-ui">
                    <input
                      type="checkbox"
                      className={checkbox}
                      checked={keptActions.includes(action)}
                      onChange={(e) => setKeptActions(e.target.checked ? [...keptActions, action] : keptActions.filter((a) => a !== action))}
                    />
                    {actionLabel(t, action)}
                  </label>
                ))}
              </div>
            </div>
            {narrower ? (
              <StoppedWorkList
                stopping={workStoppedBy(project.document, { scopeModuleIds: keptModules, authorizedActions: keptActions })}
                lead={t("mandate.stoppedWork.restrictLead")}
              />
            ) : null}
            <div className="cta-row">
              <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
                {t("rules.change.cancel")}
              </Button>
              <Button
                size="sm"
                disabled={!narrower}
                onClick={() => void act("mandate:restrict", { scopeModuleIds: keptModules, authorizedActions: keptActions }).then(() => setMode(null))}
              >
                {t("rules.restrict.submit")}
              </Button>
            </div>
          </div>
        ) : null}
        {mode === "correct" ? (
          <div className="space-y-3" data-testid="mandate-correct">
            {pending ? <p className="text-ui-sm text-muted-foreground">{t("rules.correct.fromProposal")}</p> : null}
            <div>
              <Label>{t("rules.correct.objectives")}</Label>
              <TextArea value={objectives} onChange={(e) => setObjectives(e.target.value)} aria-label={t("rules.correct.objectivesLabel")} />
            </div>
            <div>
              <Label>{t("rules.correct.priorities")}</Label>
              <TextArea value={priorities} onChange={(e) => setPriorities(e.target.value)} className="min-h-12" />
            </div>
            <div>
              <Label>{t("rules.correct.scope")}</Label>
              <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-lg border border-input p-1">
                {modules.map((module) => (
                  <label key={module.id} className={optionRow}>
                    <input
                      type="checkbox"
                      className={checkbox}
                      checked={scope.includes(module.id)}
                      onChange={(e) => setScope(e.target.checked ? [...scope, module.id] : scope.filter((id) => id !== module.id))}
                    />
                    <span className="min-w-0 flex-1 truncate">{module.name}</span>
                    <span className="truncate font-mono text-[10.5px] text-muted-foreground">{module.relativePath}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label>{t("rules.correct.actions")}</Label>
              <div className="flex flex-col gap-1">
                {DELEGABLE_ACTIONS.map((action) => (
                  <label key={action} className="flex cursor-pointer items-center gap-2 text-ui">
                    <input
                      type="checkbox"
                      className={checkbox}
                      checked={actions.includes(action)}
                      onChange={(e) => setActions(e.target.checked ? [...actions, action] : actions.filter((a) => a !== action))}
                    />
                    {actionLabel(t, action)}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-ui-xs text-muted-foreground">{t("rules.correct.actionsNote")}</p>
            </div>
            <div>
              <Label>{t("rules.correct.limits")}</Label>
              <TextArea value={limits} onChange={(e) => setLimits(e.target.value)} className="min-h-12" />
            </div>
            <div className="cta-row">
              <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
                {t("rules.change.cancel")}
              </Button>
              <Button size="sm" disabled={!valid} onClick={() => void grant()}>
                {granted ? t("rules.correct.save") : t("rules.correct.grant")}
              </Button>
            </div>
          </div>
        ) : null}
        {mode === "revoke" && granted ? (
          <div className="space-y-2" data-testid="mandate-revoke-confirm">
            <p className="text-ui-sm text-muted-foreground">{t("rules.revoke.lead")}</p>
            <TextArea
              value={revocation}
              onChange={(e) => setRevocation(e.target.value)}
              placeholder={t("rules.revoke.placeholder")}
              aria-label={t("rules.revoke.reasonLabel")}
              className="min-h-12"
              autoFocus
            />
            <StoppedWorkList stopping={stopping} lead={t("mandate.stoppedWork.revokeLead")} />
            <div className="cta-row">
              <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
                {t("rules.change.cancel")}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={!revocation.trim()}
                onClick={() =>
                  void act("mandate:revoke", { reason: revocation.trim() }).then(() => {
                    setRevocation("");
                    setMode(null);
                  })
                }
              >
                {t("rules.revoke.submit")}
              </Button>
            </div>
          </div>
        ) : null}
      </DisclosureSection>
      {mandate && mandate.history.length ? (
        <DisclosureSection
          title={t("rules.history.title")}
          count={mandate.history.length}
          open={showHistory}
          onToggle={() => setShowHistory(!showHistory)}
          testId="mandate-history"
        >
          <ol className="space-y-1.5 text-ui-sm text-muted-foreground">
            {[...mandate.history].reverse().map((snapshot) => (
              <li key={snapshot.version}>
                v{snapshot.version}
                <Sep />
                {formatDate(snapshot.grantedAt)}
                <Sep />
                {snapshot.restriction ? restrictionText(t, snapshot.restriction, moduleName) : snapshot.objectives.join(", ")}
              </li>
            ))}
          </ol>
        </DisclosureSection>
      ) : null}
    </div>
  );
}
