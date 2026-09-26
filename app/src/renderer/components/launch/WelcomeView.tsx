import { IconChevronDown, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import type { ProviderId } from "@shared/codex";
import { type GuideStepId, nextSetupStep, resumeSetupStep, SETUP_STEP_IDS, setupSteps, type StepState } from "@shared/onboarding";
import { PROVIDERS } from "@shared/providers";
import { BrandMark } from "@/components/brand/BrandMark";
import { StepActions } from "@/components/onboarding/StepActions";
import { STATUS_LABEL, StepIcon } from "@/components/onboarding/StepRow";
import { ProviderIcon } from "@/components/ProviderIcon";
import { providerStatus } from "@/components/settings/SettingsView";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { act, useUi } from "@/lib/store";

/** Codex and Claude come first; the other providers wait behind "Altri provider". */
const MAIN_PROVIDERS: ProviderId[] = ["codex", "claudeAgent"];

const STEP_COPY: Record<GuideStepId, { title: string; lead: string }> = {
  provider: {
    title: "Collega un provider",
    lead: "Gli agenti di Trama lavorano con il provider che scegli. Accedi con la sua app o CLI ufficiale: Trama non legge né copia le credenziali.",
  },
  github: {
    title: "Collega GitHub",
    lead: "Con GitHub CLI Trama legge issue e pull request e pubblica il lavoro approvato. Senza, i progetti locali e l'esempio funzionano lo stesso.",
  },
  aiHero: {
    title: "Il metodo AI Hero",
    lead: "Le skill di Matt Pocock guidano il Coordinatore: domande prima di costruire, specifiche, fette verticali, test. Trama le copia nel progetto senza toccare i file che ci sono già.",
  },
  project: { title: "", lead: "" },
  exercise: { title: "", lead: "" },
};

function ProviderList() {
  const providers = useUi((s) => s.app!.providers);
  const [others, setOthers] = useState(false);
  const [hint, setHint] = useState<Partial<Record<ProviderId, string>>>({});
  const shown = PROVIDERS.filter((p) => others || MAIN_PROVIDERS.includes(p.id as ProviderId));
  return (
    <div className="mt-4">
      <ul className="divide-y divide-[color:var(--app-surface-divider)] rounded-xl border border-[color:var(--color-border)]" aria-label="Provider">
        {shown.map((provider) => {
          const id = provider.id as ProviderId;
          const state = providers[id];
          const status = providerStatus(state?.account ?? null, state?.checking ?? false);
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
                          setHint((h) => ({ ...h, [id]: result?.command ? `Esegui ${result.command} nel terminale, poi premi Controlla di nuovo.` : `Accesso: ${provider.signInCommand}` })),
                        )
                  }
                >
                  Accedi
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
        {others ? "Mostra solo Codex e Claude" : `Altri provider (${PROVIDERS.length - MAIN_PROVIDERS.length})`}
        <IconChevronDown className={cn("size-3.5 transition-transform", others && "rotate-180")} stroke={1.8} />
      </button>
    </div>
  );
}

function StepProgress({ steps, current }: { steps: StepState[]; current: GuideStepId }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="Passi della configurazione">
      {steps.map((step, index) => (
        <li
          key={step.id}
          aria-current={step.id === current ? "step" : undefined}
          title={`${STEP_COPY[step.id as GuideStepId].title}: ${STATUS_LABEL[step.status]}`}
          className={cn(
            "h-1 w-8 rounded-full bg-[var(--color-border-heavy)] transition-colors",
            step.status === "done" && "bg-[color:var(--color-text-accent)]/50",
            step.id === current && "bg-[var(--color-text-accent)]",
          )}
        >
          <span className="sr-only">
            Passo {index + 1}: {STATUS_LABEL[step.status]}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Hello({ steps, resuming, onStart, onClose }: { steps: StepState[]; resuming: boolean; onStart: () => void; onClose: () => void }) {
  return (
    <>
      <BrandMark size={72} variant="tile" />
      <h1 className="mt-6 text-[28px] leading-[1.15] font-normal tracking-[-0.015em] text-foreground sm:text-[32px]">Benvenuto in Trama</h1>
      <p className="mt-3 text-ui-lg text-foreground/85">Un team di agenti lavora sul tuo progetto: tu decidi, loro costruiscono.</p>
      <p className="mt-2 text-ui text-muted-foreground">
        Prima colleghiamo gli strumenti, in tre passi. Puoi saltarli e riprenderli quando vuoi dalla guida, in Impostazioni o nel menu Aiuto.
      </p>
      <ol className="mt-6 space-y-1" aria-label="Passi della configurazione">
        {steps.map((step, index) => (
          <li key={step.id} className="flex items-center gap-2.5 py-1 text-ui">
            <span className="flex size-4 items-center justify-center">
              <StepIcon status={step.status} index={index} current={false} />
            </span>
            <span className="min-w-0 flex-1 truncate text-foreground/90">{STEP_COPY[step.id as GuideStepId].title}</span>
            {step.optional ? <span className="text-ui-xs text-muted-foreground/70">facoltativo</span> : null}
            <span className={cn("text-ui-xs", step.status === "done" ? "text-success" : "text-muted-foreground")}>{STATUS_LABEL[step.status]}</span>
          </li>
        ))}
      </ol>
      <div className="cta-row mt-8">
        <Button variant="ghost" onClick={onClose}>
          Salta la configurazione
        </Button>
        <Button onClick={onStart}>{resuming ? "Riprendi la configurazione" : "Configura"}</Button>
      </div>
    </>
  );
}

function SetupStep({ step, index, total, onBack, onNext }: { step: StepState; index: number; total: number; onBack: () => void; onNext: () => void }) {
  const id = step.id as GuideStepId;
  const last = index === total - 1;
  const done = step.status === "done";
  return (
    <>
      <div className="flex items-center gap-3">
        <BrandMark size={28} variant="glyph" />
        <span className="text-ui-sm text-muted-foreground">
          Passo {index + 1} di {total}
        </span>
      </div>
      <h1 className="mt-5 text-[24px] leading-[1.2] font-normal tracking-[-0.01em] text-foreground">
        {STEP_COPY[id].title}
        {step.optional ? <span className="ml-2 align-middle text-ui-sm text-muted-foreground/70">facoltativo</span> : null}
      </h1>
      <p className="mt-2 text-ui text-muted-foreground">{STEP_COPY[id].lead}</p>
      <div
        className="mt-5 flex items-start gap-2.5 rounded-xl bg-[var(--color-background-button-secondary)] px-3.5 py-3"
        data-testid="welcome-step-state"
        data-status={step.status}
      >
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
          <StepIcon status={step.status} index={index} current />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("text-ui-sm font-medium", done ? "text-success" : "text-foreground")}>{STATUS_LABEL[step.status]}</p>
          <p className="mt-0.5 text-ui-sm text-muted-foreground">{step.detail}</p>
        </div>
      </div>
      {id === "provider" ? <ProviderList /> : null}
      <div className="cta-row mt-4">
        <StepActions step={step} where="welcome" />
      </div>
      <div className="mt-8 flex items-center gap-2 border-t border-[color:var(--app-surface-divider)] pt-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Indietro
        </Button>
        <div className="cta-row flex-1">
          {done || step.status === "skipped" ? (
            <Button size="sm" onClick={onNext}>
              {last ? "Scegli un progetto" : "Continua"}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => void act("onboarding:update", { skipStep: id }).then(onNext)}>
              {step.optional ? "Rimanda" : "Salta per ora"}
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
  const steps = useMemo(() => (app ? setupSteps(app) : []), [app]);

  useEffect(() => {
    if (page && page !== "hello" && useUi.getState().app?.gitHubCli.status === "unknown") void act("onboarding:checkGitHub", undefined);
  }, [page]);

  useEffect(() => {
    if (!page) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !useUi.getState().dialog) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  if (!page || !app) return null;
  const close = () => {
    setWelcome(null);
    void act("onboarding:update", { welcomeClosed: true });
  };
  const index = page === "hello" ? -1 : SETUP_STEP_IDS.indexOf(page);
  // The person already answered or skipped something here: the welcome resumes instead of starting over.
  const resuming = app.onboarding.skippedSteps.some((id) => SETUP_STEP_IDS.includes(id)) || app.onboarding.methodChoice !== null;
  const step = index >= 0 ? steps[index]! : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Benvenuto in Trama"
      data-testid="welcome"
      data-page={page}
      className="chat-pane-enter fixed inset-0 z-[45] flex flex-col bg-[var(--color-background-surface)]"
    >
      <div className="drag-region flex h-[46px] shrink-0 items-center justify-end gap-3 px-3 sm:px-5">
        {step ? <StepProgress steps={steps} current={step.id as GuideStepId} /> : null}
        <Button variant="ghost" size="icon-sm" aria-label="Chiudi il benvenuto" onClick={close}>
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
          ) : (
            <Hello
              steps={steps}
              resuming={resuming}
              onStart={() => setWelcome(resuming ? resumeSetupStep(app) : SETUP_STEP_IDS[0]!)}
              onClose={close}
            />
          )}
        </div>
      </div>
    </div>
  );
}
