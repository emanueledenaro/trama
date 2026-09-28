import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { IconChevronDown, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import type { ProviderId } from "@shared/codex";
import { type GuideStepId, nextSetupStep, resumeSetupStep, SETUP_STEP_IDS, setupSteps, type StepState } from "@shared/onboarding";
import { PROVIDERS } from "@shared/providers";
import { TramaMark } from "@/components/brand/TramaMark";
import { StepActions } from "@/components/onboarding/StepActions";
import { StepIcon, stepStatusLabel } from "@/components/onboarding/StepRow";
import { ProviderIcon } from "@/components/ProviderIcon";
import { LanguageChoice } from "@/components/settings/LanguageChoice";
import { providerStatus } from "@/components/settings/SettingsView";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { useLanguage, useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";
import type { MessageKey, Translate } from "@shared/i18n";

/** Codex and Claude come first; the other providers wait behind their toggle. */
const MAIN_PROVIDERS: ProviderId[] = ["codex", "claudeAgent"];

/** The welcome's own title and lead for the setup steps; the other guide steps do not appear here. */
const STEP_COPY: Partial<Record<GuideStepId, { title: MessageKey; lead: MessageKey }>> = {
  provider: { title: "welcome.provider.title", lead: "welcome.provider.lead" },
  github: { title: "welcome.github.title", lead: "welcome.github.lead" },
  aiHero: { title: "welcome.aiHero.title", lead: "welcome.aiHero.lead" },
};

const stepCopy = (t: Translate, id: GuideStepId) => {
  const copy = STEP_COPY[id];
  return copy ? { title: t(copy.title), lead: t(copy.lead) } : { title: "", lead: "" };
};

function ProviderList() {
  const t = useT();
  const language = useLanguage();
  const providers = useUi((s) => s.app!.providers);
  const [others, setOthers] = useState(false);
  const [hint, setHint] = useState<Partial<Record<ProviderId, string>>>({});
  const shown = PROVIDERS.filter((p) => others || MAIN_PROVIDERS.includes(p.id as ProviderId));
  return (
    <div className="mt-4">
      <ul className="divide-y divide-[color:var(--app-surface-divider)] rounded-xl border border-[color:var(--color-border)]" aria-label={t("welcome.providers")}>
        {shown.map((provider) => {
          const id = provider.id as ProviderId;
          const state = providers[id];
          const status = providerStatus(t, language, state?.account ?? null, state?.checking ?? false);
          return (
            <li key={id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2.5" data-provider-row={id}>
              <ProviderIcon provider={id} className="size-4" />
              <span className="text-ui text-foreground">{provider.name}</span>
              {state?.checking ? <Spinner className="size-3" /> : null}
              <span className="min-w-[6rem] flex-1 truncate text-ui-xs text-muted-foreground">{status.detail}</span>
              <Badge tone={status.tone}>{status.label}</Badge>
              {state?.account?.kind === "signedOut" ? (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    id === "codex"
                      ? void act("codex:login", undefined)
                      : void act("provider:login", { provider: id }).then((result) =>
                          setHint((h) => ({
                            ...h,
                            [id]: result?.command ? t("welcome.signInHint", { command: result.command }) : t("welcome.signInCommand", { command: provider.signInCommand }),
                          })),
                        )
                  }
                >
                  {t("welcome.signIn")}
                </Button>
              ) : null}
              {hint[id] ? <span className="w-full pl-6.5 text-ui-xs text-foreground/80">{hint[id]}</span> : null}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        aria-expanded={others}
        onClick={() => setOthers(!others)}
        className="mt-2 inline-flex items-center gap-1 text-ui-sm text-muted-foreground hover:text-foreground"
      >
        {others ? t("welcome.onlyMainProviders") : t("welcome.otherProviders", { count: PROVIDERS.length - MAIN_PROVIDERS.length })}
        <IconChevronDown className={cn("size-3.5 transition-transform", others && "rotate-180")} stroke={1.8} />
      </button>
    </div>
  );
}

function StepProgress({ steps, current }: { steps: StepState[]; current: GuideStepId }) {
  const t = useT();
  return (
    <ol className="flex items-center gap-1.5" aria-label={t("welcome.stepsLabel")}>
      {steps.map((step, index) => (
        <li
          key={step.id}
          aria-current={step.id === current ? "step" : undefined}
          title={`${stepCopy(t, step.id as GuideStepId).title}: ${stepStatusLabel(t, step.status)}`}
          className={cn(
            "h-1 w-8 rounded-full bg-[var(--color-border-heavy)] transition-colors",
            step.status === "done" && "bg-[color:var(--color-text-accent)]/50",
            step.id === current && "bg-[var(--color-text-accent)]",
          )}
        >
          <span className="sr-only">{t("welcome.stepStatus", { index: index + 1, status: stepStatusLabel(t, step.status) })}</span>
        </li>
      ))}
    </ol>
  );
}

function Hello({ steps, resuming, onStart, onClose }: { steps: StepState[]; resuming: boolean; onStart: () => void; onClose: () => void }) {
  const t = useT();
  return (
    <>
      <TramaMark size={72} variant="tile" />
      {/* The language comes first (issue #301): the system's is already selected, and the page changes at once. */}
      <div
        className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-[color:var(--color-border)] px-3.5 py-2.5"
        data-testid="welcome-language"
      >
        <div className="min-w-[12rem] flex-1">
          <p className="text-ui-sm font-medium text-foreground">{t("language.label")}</p>
          <p className="mt-0.5 text-ui-xs text-muted-foreground">{t("language.welcomeHint")}</p>
        </div>
        <LanguageChoice />
      </div>
      <h1 className="mt-6 text-[28px] leading-[1.15] font-normal tracking-[-0.015em] text-foreground sm:text-[32px]">{t("welcome.title")}</h1>
      <p className="mt-3 text-ui-lg text-foreground/85">{t("welcome.tagline")}</p>
      <p className="mt-2 text-ui text-muted-foreground">{t("welcome.intro")}</p>
      <ol className="mt-6 space-y-1" aria-label={t("welcome.stepsLabel")}>
        {steps.map((step, index) => (
          <li key={step.id} className="flex items-center gap-2.5 py-1 text-ui">
            <span className="flex size-4 items-center justify-center">
              <StepIcon status={step.status} index={index} current={false} />
            </span>
            <span className="min-w-0 flex-1 truncate text-foreground/90">{stepCopy(t, step.id as GuideStepId).title}</span>
            {step.optional ? <span className="text-ui-xs text-muted-foreground/70">{t("welcome.optional")}</span> : null}
            <span className={cn("text-ui-xs", step.status === "done" ? "text-success" : "text-muted-foreground")}>{stepStatusLabel(t, step.status)}</span>
          </li>
        ))}
      </ol>
      <div className="cta-row mt-8">
        <Button variant="ghost" onClick={onClose}>
          {t("welcome.skipSetup")}
        </Button>
        <Button onClick={onStart}>{resuming ? t("welcome.resume") : t("welcome.start")}</Button>
      </div>
    </>
  );
}

function SetupStep({ step, index, total, onBack, onNext }: { step: StepState; index: number; total: number; onBack: () => void; onNext: () => void }) {
  const t = useT();
  const id = step.id as GuideStepId;
  const copy = stepCopy(t, id);
  const last = index === total - 1;
  const done = step.status === "done";
  return (
    <>
      <div className="flex items-center gap-3">
        <TramaMark size={28} />
        <span className="text-ui-sm text-muted-foreground">{t("welcome.stepOf", { index: index + 1, total })}</span>
      </div>
      <h1 className="mt-5 text-[24px] leading-[1.2] font-normal tracking-[-0.01em] text-foreground">
        {copy.title}
        {step.optional ? <span className="ml-2 align-middle text-ui-sm text-muted-foreground/70">{t("welcome.optional")}</span> : null}
      </h1>
      <p className="mt-2 text-ui text-muted-foreground">{copy.lead}</p>
      <div
        className="mt-5 flex items-start gap-2.5 rounded-xl bg-[var(--color-background-button-secondary)] px-3.5 py-3"
        data-testid="welcome-step-state"
        data-status={step.status}
      >
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
          <StepIcon status={step.status} index={index} current />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("text-ui-sm font-medium", done ? "text-success" : "text-foreground")}>{stepStatusLabel(t, step.status)}</p>
          <p className="mt-0.5 text-ui-sm text-muted-foreground">{step.detail}</p>
        </div>
      </div>
      {id === "provider" ? <ProviderList /> : null}
      <div className="cta-row mt-4">
        <StepActions step={step} where="welcome" />
      </div>
      <div className="mt-8 flex items-center gap-2 border-t border-[color:var(--app-surface-divider)] pt-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          {t("welcome.back")}
        </Button>
        <div className="cta-row flex-1">
          {done || step.status === "skipped" ? (
            <Button size="sm" onClick={onNext}>
              {last ? t("welcome.chooseProject") : t("welcome.continue")}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => void act("onboarding:update", { skipStep: id }).then(onNext)}>
              {step.optional ? t("welcome.postpone") : t("welcome.skipForNow")}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * The welcome (B02): shown by itself on the first launch, then from the guide. A first page says what Trama
 * does; the configuration reuses the guide's steps and state (provider, GitHub, AI Hero), each one skippable
 * and resumable. At the end, or when closed, the project picker is underneath.
 */
export function WelcomeView() {
  const page = useUi((s) => s.welcome);
  const setWelcome = useUi((s) => s.setWelcome);
  const app = useUi((s) => s.app);
  const t = useT();
  const steps = useMemo(() => (app ? setupSteps(app) : []), [app]);

  useEffect(() => {
    if (page && page !== "hello" && useUi.getState().app?.gitHubCli.status === "unknown") void act("onboarding:checkGitHub", undefined);
  }, [page]);

  if (!app) return null;
  const close = () => {
    setWelcome(null);
    void act("onboarding:update", { welcomeClosed: true });
  };
  const index = !page || page === "hello" ? -1 : SETUP_STEP_IDS.indexOf(page);
  // The person has been here before: the button says so. Either way it starts at the first step still open.
  const resuming =
    app.onboarding.welcomeClosedAt !== null ||
    app.onboarding.skippedSteps.some((id) => SETUP_STEP_IDS.includes(id)) ||
    app.onboarding.methodChoice !== null;
  const step = index >= 0 ? steps[index]! : null;

  // The shared dialog primitive keeps the focus inside, makes the window behind inert and gives the focus back.
  return (
    <DialogPrimitive.Root open={page !== null} onOpenChange={(open) => (open ? null : close())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          aria-label={t("welcome.title")}
          data-testid="welcome"
          data-page={page ?? undefined}
          className="chat-pane-enter fixed inset-0 z-[45] flex flex-col bg-[var(--color-background-surface)] text-foreground outline-none"
        >
          <div className="drag-region flex h-[46px] shrink-0 items-center justify-end gap-3 px-3 sm:px-5">
            {step ? <StepProgress steps={steps} current={step.id as GuideStepId} /> : null}
            <Button variant="ghost" size="icon-sm" aria-label={t("welcome.close")} onClick={close}>
              <IconX className="size-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex min-h-full w-full max-w-[34rem] flex-col justify-center px-4 pt-4 pb-12 sm:px-6">
              {step ? (
                <SetupStep
                  key={step.id}
                  step={step}
                  index={index}
                  total={SETUP_STEP_IDS.length}
                  onBack={() => setWelcome(index === 0 ? "hello" : SETUP_STEP_IDS[index - 1]!)}
                  onNext={() => {
                    const next = nextSetupStep(step.id as GuideStepId);
                    if (next) setWelcome(next);
                    else close();
                  }}
                />
              ) : page ? (
                <Hello steps={steps} resuming={resuming} onStart={() => setWelcome(resumeSetupStep(app))} onClose={close} />
              ) : null}
            </div>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
