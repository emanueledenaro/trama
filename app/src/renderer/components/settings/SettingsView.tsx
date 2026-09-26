import {
  IconBrain,
  IconBrandGithub,
  IconChecklist,
  IconChevronDown,
  IconDeviceDesktop,
  IconEye,
  IconMoon,
  IconPlugConnected,
  IconRefresh,
  IconSettings,
  IconSun,
  IconTools,
  IconUsers,
} from "@tabler/icons-react";
import { useState } from "react";
import type { ProviderAccount, ProviderId } from "@shared/codex";
import { DEFAULT_LEARNING_SETTINGS, type LearningSettings, type ThemePreference } from "@shared/domain";
import { capabilityLines, PROVIDERS, type ProviderDescriptor } from "@shared/providers";
import { AIHERO_ATTRIBUTION } from "@shared/skills";
import { ProviderIcon } from "@/components/ProviderIcon";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Badge, TextArea } from "@/components/ui/field";
import { activeRules, CLEAN_CODE_RULES, CLEAN_CODE_SOURCE, CLEAN_CODE_VERSION } from "@shared/cleanCode";
import { cn } from "@/lib/cn";
import { act, type SettingsSection, useUi } from "@/lib/store";
import { PresenceControls, presenceStatusLine } from "@/components/PresencePanel";

const SECTIONS: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "Generale", icon: <IconSettings stroke={1.7} /> },
  { id: "connections", label: "Collegamenti", icon: <IconPlugConnected stroke={1.7} /> },
  { id: "method", label: "Metodo di lavoro", icon: <IconTools stroke={1.7} /> },
  { id: "standard", label: "Standard del codice", icon: <IconChecklist stroke={1.7} /> },
  { id: "learning", label: "Apprendimento", icon: <IconBrain stroke={1.7} /> },
  { id: "monitor", label: "Monitor", icon: <IconEye stroke={1.7} /> },
  { id: "presence", label: "Presenza", icon: <IconUsers stroke={1.7} /> },
];

/** The settings page: a section list on the left, one section at a time on the right. */
export function SettingsView() {
  const section = useUi((s) => s.settingsSection);
  const openSettings = useUi((s) => s.openSettings);
  const closeSettings = useUi((s) => s.closeSettings);
  return (
    <div
      className="chat-pane-enter flex min-h-0 flex-1 flex-col @2xl/chat:flex-row"
      data-testid="settings"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) closeSettings();
      }}
    >
      <nav
        aria-label="Sezioni delle impostazioni"
        className="flex shrink-0 gap-0.5 overflow-x-auto [scrollbar-width:none] border-b border-[color:var(--app-surface-divider)] px-3 py-2 @2xl/chat:w-52 @2xl/chat:flex-col @2xl/chat:overflow-visible @2xl/chat:border-r @2xl/chat:border-b-0 @2xl/chat:px-2 @2xl/chat:py-4"
      >
        {SECTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-current={section === entry.id ? "page" : undefined}
            onClick={() => openSettings(entry.id)}
            className={cn(
              "flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-left text-ui transition-colors [&_svg]:size-3.5 [&_svg]:shrink-0",
              section === entry.id
                ? "bg-[var(--sidebar-selected)] text-foreground"
                : "text-foreground/80 hover:bg-[var(--sidebar-accent)] hover:text-foreground",
            )}
          >
            {entry.icon}
            <span className="truncate">{entry.label}</span>
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div key={section} className="mx-auto w-full max-w-[40rem] px-4 py-6 sm:px-8">
          {section === "general" ? <GeneralSection /> : null}
          {section === "connections" ? <ConnectionsSection /> : null}
          {section === "method" ? <MethodSection /> : null}
          {section === "standard" ? <StandardSection /> : null}
          {section === "learning" ? <LearningSection /> : null}
          {section === "monitor" ? <MonitorSection /> : null}
          {section === "presence" ? <PresenceSection /> : null}
        </div>
      </div>
    </div>
  );
}

function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-6 flex items-start gap-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-ui-lg font-medium text-foreground">{title}</h2>
        {description ? <p className="mt-1 text-ui-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** A titled card of rows, as in the Codex and Synara settings. */
function Group({ title, note, children }: { title?: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-6 last:mb-0">
      {title ? <h3 className="mb-2 px-1 text-ui-sm font-medium text-muted-foreground">{title}</h3> : null}
      <div className="divide-y divide-[color:var(--app-surface-divider)] rounded-xl border border-[color:var(--color-border)] bg-[var(--card)]">
        {children}
      </div>
      {note ? <p className="mt-2 px-1 text-ui-xs text-muted-foreground">{note}</p> : null}
    </section>
  );
}

/** One setting: label and explanation on the left, the control on the right. */
function Row({ label, description, control, children }: { label: React.ReactNode; description?: React.ReactNode; control?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      {/* When the row is narrow the controls wrap under the label instead of squeezing it. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-[12rem] flex-1">
          <div className="text-ui text-foreground">{label}</div>
          {description ? <div className="mt-0.5 text-ui-sm text-muted-foreground">{description}</div> : null}
        </div>
        {control ? <div className="flex shrink-0 items-center gap-2">{control}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-[18px] w-[30px] shrink-0 cursor-pointer items-center rounded-full transition-colors",
        checked ? "bg-[var(--color-text-accent)]" : "bg-[var(--color-border-heavy)]",
      )}
    >
      <span className={cn("inline-block size-[14px] rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-[14px]" : "translate-x-[2px]")} />
    </button>
  );
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description?: React.ReactNode; checked: boolean; onChange: (value: boolean) => void }) {
  return <Row label={label} description={description} control={<Toggle checked={checked} onChange={onChange} label={label} />} />;
}

function GeneralSection() {
  const theme = useUi((s) => s.app?.settings.theme ?? "system");
  const sounds = useUi((s) => s.app?.settings.sounds === true);
  const setDialog = useUi((s) => s.setDialog);
  const options: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
    { value: "system", label: "Sistema", icon: <IconDeviceDesktop className="size-3.5" stroke={1.7} /> },
    { value: "light", label: "Chiaro", icon: <IconSun className="size-3.5" stroke={1.7} /> },
    { value: "dark", label: "Scuro", icon: <IconMoon className="size-3.5" stroke={1.7} /> },
  ];
  return (
    <>
      <PageHeader title="Generale" />
      <Group>
        <Row
          label="Tema"
          description="Sistema segue l'aspetto di macOS."
          control={
            <div role="radiogroup" aria-label="Tema" className="flex rounded-lg bg-[var(--color-background-button-secondary)] p-0.5">
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={theme === option.value}
                  onClick={() => void act("settings:update", { theme: option.value })}
                  className={cn(
                    "flex h-6 items-center gap-1.5 rounded-md px-2.5 text-ui-sm transition-colors",
                    theme === option.value ? "bg-[var(--color-background-surface)] text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option.icon}
                  {option.label}
                </button>
              ))}
            </div>
          }
        />
        <ToggleRow
          label="Suono con gli avvisi utili"
          description="Solo per conflitti, provider bloccati e lavoro in attesa; mai per sincronizzazioni o consumo di token."
          checked={sounds}
          onChange={(value) => void act("settings:update", { sounds: value })}
        />
        <Row
          label="Guida introduttiva"
          description="Collegamenti, progetto, metodo AI Hero ed esercizi sulla copia di esempio. Riprende dal punto in cui ti eri fermato."
          control={
            <Button variant="outline" size="sm" onClick={() => setDialog("guide")}>
              Apri la guida
            </Button>
          }
        />
      </Group>
    </>
  );
}

function providerStatus(account: ProviderAccount | null, checking: boolean): { label: string; detail: string | null; tone: "success" | "warning" | "secondary" } {
  if (checking && !account) return { label: "Verifica in corso", detail: null, tone: "secondary" };
  switch (account?.kind) {
    case "chatgpt":
      return { label: "Collegato", detail: [account.email, account.plan ? `piano ${account.plan}` : null].filter(Boolean).join(", ") || null, tone: "success" };
    case "authenticated":
      return { label: "Collegato", detail: account.label, tone: "success" };
    case "signedOut":
      return { label: "Accesso richiesto", detail: null, tone: "secondary" };
    case "unsupported":
      return { label: "Account non supportato", detail: account.type, tone: "warning" };
    case "blocked":
      return {
        label: "Bloccato",
        detail: `${account.message}${account.until ? ` Si sblocca il ${new Date(account.until).toLocaleString("it-IT")}.` : ""}`,
        tone: "warning",
      };
    case "unavailable":
      return { label: "Non disponibile", detail: account.message, tone: "warning" };
    default:
      return { label: "Stato sconosciuto", detail: null, tone: "secondary" };
  }
}

const GITHUB_STATUS = {
  unknown: "Stato sconosciuto",
  checking: "Verifica in corso",
  missing: "Non installata",
  signedOut: "Accesso richiesto",
  ready: "Collegato",
  error: "Errore",
} as const;

function ConnectionsSection() {
  const codex = useUi((s) => s.app!.codex);
  const gitHubCli = useUi((s) => s.app!.gitHubCli);
  const account = codex.account;
  const status = providerStatus(account, codex.checking);
  const codexDetail =
    account?.kind === "unsupported"
      ? `Codex usa un account di tipo ${account.type}. Trama accetta solo un account ChatGPT per evitare la fatturazione API.`
      : status.detail;
  return (
    <>
      <PageHeader
        title="Collegamenti"
        description="L'accesso avviene nel browser ufficiale o nel terminale. Trama non copia le credenziali."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void act("codex:refresh", undefined);
              void act("providers:refresh", {});
            }}
          >
            <IconRefresh /> Verifica tutti
          </Button>
        }
      />
      <Group title="Account principale">
        <Row
          label={
            <span className="flex items-center gap-2">
              <ProviderIcon provider="codex" className="size-4" /> ChatGPT {codex.checking ? <Spinner /> : null}
            </span>
          }
          description={
            <>
              {codexDetail ?? (account === null ? "Verifica in corso" : null)}
              {account?.kind === "chatgpt" ? <span className="text-muted-foreground/70"> · {codex.models.length} modelli</span> : null}
            </>
          }
          control={
            <>
              <Badge tone={status.tone}>{status.label}</Badge>
              {account?.kind === "signedOut" ? (
                <Button size="sm" onClick={() => void act("codex:login", undefined)}>
                  Accedi con ChatGPT
                </Button>
              ) : null}
            </>
          }
        />
        <Row
          label={
            <span className="flex items-center gap-2">
              <IconBrandGithub className="size-4" stroke={1.7} /> GitHub
            </span>
          }
          description={
            gitHubCli.status === "ready" ? (
              gitHubCli.account
            ) : gitHubCli.status === "error" && gitHubCli.detail ? (
              gitHubCli.detail
            ) : (
              <>
                Trama usa GitHub CLI. {gitHubCli.status === "missing" ? "Installala, poi esegui " : "Esegui "}
                <code className="font-mono text-foreground/90">gh auth login</code> nel terminale.
              </>
            )
          }
          control={
            <Badge tone={gitHubCli.status === "ready" ? "success" : gitHubCli.status === "error" ? "warning" : "secondary"}>
              {GITHUB_STATUS[gitHubCli.status]}
            </Badge>
          }
        />
      </Group>
      <Group title="Provider" note="Ogni provider usa la propria CLI ufficiale. Verifica rilegge lo stato di accesso e i modelli.">
        {PROVIDERS.filter((provider) => provider.id !== "codex").map((provider) => (
          <ProviderRow key={provider.id} provider={provider} />
        ))}
      </Group>
    </>
  );
}

function ProviderRow({ provider }: { provider: ProviderDescriptor }) {
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const id = provider.id as ProviderId;
  const state = useUi((s) => s.app!.providers[id]);
  const status = providerStatus(state?.account ?? null, state?.checking ?? false);
  const connected = status.tone === "success";
  return (
    <Row
      label={
        <span className="flex items-center gap-2">
          <ProviderIcon provider={id} className="size-4" /> {provider.name} {state?.checking ? <Spinner /> : null}
        </span>
      }
      description={
        <>
          {status.detail ? <span>{status.detail}</span> : null}
          {connected && state ? <span className="text-muted-foreground/70">{status.detail ? " · " : ""}{state.models.length} modelli</span> : null}
          {!connected ? (
            <span className="block">
              Accesso: <code className="font-mono text-foreground/90">{provider.signInCommand}</code>
            </span>
          ) : null}
          {hint ? <span className="block text-foreground/80">{hint}</span> : null}
        </>
      }
      control={
        <>
          <Badge tone={status.tone}>{status.label}</Badge>
          <Button variant="ghost" size="xs" aria-expanded={open} onClick={() => setOpen(!open)}>
            Capacità <IconChevronDown className={cn("transition-transform", open && "rotate-180")} />
          </Button>
          <Button variant="ghost" size="xs" onClick={() => void act("providers:refresh", { provider: id })}>
            Verifica
          </Button>
          {state?.account?.kind === "signedOut" ? (
            <Button
              variant="outline"
              size="xs"
              onClick={() =>
                void act("provider:login", { provider: id }).then((result) =>
                  setHint(result?.command ? `Esegui ${result.command} nel terminale, poi premi Verifica.` : null),
                )
              }
            >
              Accedi
            </Button>
          ) : null}
        </>
      }
    >
      {open ? (
        <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 rounded-lg bg-[var(--color-background-button-secondary)] px-3 py-2 text-ui-xs @xl/chat:grid-cols-2">
          {capabilityLines(provider.capabilities).map((line) => (
            <div key={line.label} className="flex justify-between gap-2">
              <span className="text-muted-foreground">{line.label}</span>
              <span className="text-foreground/90">{line.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </Row>
  );
}

function MethodSection() {
  const project = useUi((s) => s.app?.project ?? null);
  const autoPrepare = useUi((s) => s.app?.settings.autoPrepareMethod !== false);
  const continuousWork = useUi((s) => s.app?.settings.continuousWork !== false);
  const [report, setReport] = useState<{ pathsCreated: string[]; existingPreserved: string[]; warnings: string[]; version: string } | null>(null);
  const [running, setRunning] = useState(false);
  const noProject = !project || project.isDemo;
  return (
    <>
      <PageHeader
        title="Metodo di lavoro"
        description={
          <>
            Le skill AI Hero della release v1.2.3 con i nomi di Trama (ask-trama, setup-trama), copiate nel progetto senza installer e senza cambiare le impostazioni
            globali di Codex. I file esistenti restano invariati.
          </>
        }
      />
      <Group note={`${AIHERO_ATTRIBUTION}. Le skill varie, come git-guardrails-claude-code, si usano solo con "/".`}>
        <ToggleRow
          label="Prepara il metodo all'apertura di un progetto"
          checked={autoPrepare}
          onChange={(value) => void act("settings:update", { autoPrepareMethod: value })}
        />
        <Row
          label="Prepara ora nel progetto aperto"
          description={
            noProject ? (
              "Apri un progetto per preparare il metodo."
            ) : report ? (
              <>
                AI Hero {report.version}: {report.pathsCreated.length} percorsi creati, {report.existingPreserved.length} preservati.
                {report.warnings.length ? ` ${report.warnings.join(" ")}` : ""}
              </>
            ) : project?.missingMethodSkills?.length ? (
              <span className="text-warning">Codex non ha caricato queste skill: {project.missingMethodSkills.join(", ")}.</span>
            ) : project?.missingMethodSkills ? (
              "Codex ha caricato tutte le skill del metodo."
            ) : null
          }
          control={
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={noProject}
                onClick={() =>
                  // The record of the rollback goes to the project's chat; this page says it happened (W12).
                  void act("skills:rollback", undefined).then((restored) => {
                    if (!restored) return;
                    setReport(null);
                    useUi.getState().setToast(
                      `Ultimo aggiornamento del metodo annullato: ${restored.length === 1 ? "1 file ripristinato" : `${restored.length} file ripristinati`}.`,
                      "info",
                    );
                  })
                }
              >
                Annulla l'ultimo aggiornamento
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={noProject || running}
                onClick={async () => {
                  setRunning(true);
                  setReport((await act("skills:prepare", undefined)) ?? null);
                  setRunning(false);
                }}
              >
                {running ? <Spinner /> : null} Prepara
              </Button>
            </>
          }
        />
      </Group>
      <Group title="Lavoro continuo">
        <ToggleRow
          label="Il Coordinatore va avanti da solo dentro il mandato"
          description="Prepara il piano, assegna il lavoro ed esegue le verifiche senza chiedere. Ti chiede solo decisioni di prodotto, il mandato, il team e l'unione del candidato. Puoi fermare ogni mossa dalla chat."
          checked={continuousWork}
          onChange={(value) => void act("settings:update", { continuousWork: value })}
        />
      </Group>
    </>
  );
}

/** Trama's Clean Code standard for the open project (Q03, ADR 0016): each rule on or off, and the person's note. */
function StandardSection() {
  const project = useUi((s) => s.app?.project ?? null);
  const settings = project?.document.cleanCode;
  const [note, setNote] = useState<string | null>(null);
  const saved = settings?.note ?? "";
  const draft = note ?? saved;
  const on = new Set(activeRules(settings).map((rule) => rule.id));
  return (
    <>
      <PageHeader
        title="Standard del codice"
        description={
          <>
            Lo standard Clean Code di Trama, versione {CLEAN_CODE_VERSION}. Gli sviluppatori lo ricevono come testo di Trama accanto alle skill, che restano col testo
            originale, e la revisione tecnica controlla il diff anche rispetto a questo standard.
          </>
        }
      />
      {!project ? (
        <Group>
          <Row label={<span className="text-muted-foreground">Apri un progetto per adattare lo standard.</span>} />
        </Group>
      ) : (
        <div data-testid="clean-code-settings">
          <Group
            title={`Regole per ${project.name}`}
            note={
              <>
                Fonte: {CLEAN_CODE_SOURCE}. Prima vengono le regole del progetto (AGENTS.md, CONTRIBUTING.md, linter e formatter), poi il metodo delle skill, poi
                questo standard. Le regole segnate come bloccanti fanno chiedere modifiche in revisione. Numero di argomenti, lunghezza delle funzioni e duplicazioni
                li misura Trama: sono evidenze, mentre i rilievi del revisore restano un giudizio.
              </>
            }
          >
            {CLEAN_CODE_RULES.map((rule) => (
              <Row
                key={rule.id}
                label={
                  <span className="flex items-center gap-2">
                    {rule.label}
                    {rule.severity === "blocking" ? <Badge tone="warning">Bloccante</Badge> : null}
                  </span>
                }
                description={rule.summary}
                control={
                  <Toggle checked={on.has(rule.id)} label={rule.label} onChange={(enabled) => void act("project:cleanCode", { rule: rule.id, enabled })} />
                }
              />
            ))}
          </Group>
          <Group title="Adattamento al progetto" note="Il testo arriva a sviluppatori e revisore come indicazione della persona, per esempio: SOLID solo nei moduli a oggetti.">
            <div className="px-4 py-3">
              <TextArea
                aria-label="Come si applica lo standard a questo progetto"
                rows={3}
                value={draft}
                placeholder="Lingua, paradigma o eccezioni di questo progetto"
                onChange={(event) => setNote(event.target.value)}
              />
              <div className="cta-row mt-2">
                <Button size="sm" variant="ghost" disabled={draft === saved} onClick={() => setNote(null)}>
                  Annulla
                </Button>
                <Button
                  size="sm"
                  disabled={draft === saved}
                  onClick={() => void act("project:cleanCode", { note: draft }).then(() => setNote(null))}
                >
                  Salva
                </Button>
              </div>
            </div>
          </Group>
        </div>
      )}
    </>
  );
}

/** What the Coordinator's learning may do (ADR 0014). */
function LearningSection() {
  const saved = useUi((s) => s.app?.settings.learning);
  const learning = { ...DEFAULT_LEARNING_SETTINGS, ...(saved ?? {}) };
  const set = (change: Partial<LearningSettings>) => void act("settings:update", { learning: change });
  return (
    <>
      <PageHeader title="Apprendimento del Coordinatore" description="Cosa il Coordinatore può ricordare e migliorare da solo." />
      <Group note="Tutto resta nella cartella di Trama, mai nel repository. La revisione usa il provider e il modello del Coordinatore e consuma token: la trovi in Memoria con il suo costo.">
        <ToggleRow label="Note sul progetto" checked={learning.memory} onChange={(value) => set({ memory: value })} />
        <ToggleRow label="Profilo della persona" description="Comune a tutti i tuoi progetti." checked={learning.userProfile} onChange={(value) => set({ userProfile: value })} />
        <ToggleRow label="Revisione dell'esperienza dopo il lavoro" checked={learning.backgroundReview} onChange={(value) => set({ backgroundReview: value })} />
        <ToggleRow label="Manutenzione settimanale delle skill apprese" checked={learning.curator} onChange={(value) => set({ curator: value })} />
        <ToggleRow label="Unire con un modello le skill troppo simili" checked={learning.consolidate} onChange={(value) => set({ consolidate: value })} />
      </Group>
    </>
  );
}

function MonitorSection() {
  const monitor = useUi((s) => s.app!.monitor);
  const repository = useUi((s) => s.app?.project?.github.repository ?? null);
  const platform = useUi((s) => s.app!.platform);
  const monitored = repository ? monitor.repositories.includes(repository) : false;
  return (
    <>
      <PageHeader
        title="Monitor in background"
        description="Legge branch e pull request dei colleghi con GitHub CLI e ti avvisa delle novità mentre Trama è aperto o in background."
      />
      <Group>
        <ToggleRow label="Monitor attivo" checked={monitor.enabled} onChange={(enabled) => void act("monitor:update", { enabled })} />
        {platform !== "linux" ? (
          <ToggleRow
            label="Avvia Trama all'accesso, in background"
            checked={monitor.openAtLogin}
            onChange={(openAtLogin) => void act("monitor:update", { openAtLogin })}
          />
        ) : null}
      </Group>
      <Group title="Repository osservati">
        {monitor.repositories.length === 0 ? <Row label={<span className="text-muted-foreground">Nessun repository.</span>} /> : null}
        {monitor.repositories.map((repo) => {
          const status = monitor.status[repo];
          return (
            <Row
              key={repo}
              label={<span className="font-mono text-[12px]">{repo}</span>}
              description={status?.lastError ? <span className="text-destructive">{status.lastError}</span> : status?.lastSuccessAt ? "Aggiornato" : null}
              control={
                <Button variant="ghost" size="xs" onClick={() => void act("monitor:update", { removeRepository: repo })}>
                  Togli
                </Button>
              }
            />
          );
        })}
        {repository && !monitored ? (
          <Row
            label={<span className="font-mono text-[12px]">{repository}</span>}
            description="Repository del progetto aperto."
            control={
              <Button size="sm" variant="outline" onClick={() => void act("monitor:update", { enabled: true, addRepository: repository })}>
                Osserva
              </Button>
            }
          />
        ) : null}
      </Group>
    </>
  );
}

/** Decision 6: the presence switch, always here, with the pause; the consent belongs to the open project. */
function PresenceSection() {
  const project = useUi((s) => s.app?.project ?? null);
  return (
    <>
      <PageHeader
        title="Presenza"
        description="Chi usa Trama condivide con il team su quale branch lavora, i percorsi dei file che tocca e la richiesta in corso, sul remoto del progetto. Mai il contenuto dei file. Il consenso vale per progetto."
      />
      <Group note="La presenza si aggiorna ogni 45 secondi e subito al cambio di branch. Dopo 7 giorni senza aggiornamenti sparisce.">
        {!project ? (
          <Row label={<span className="text-muted-foreground">Apri un progetto per scegliere se condividere la presenza.</span>} />
        ) : project.isDemo ? (
          <Row label={<span className="text-muted-foreground">Il progetto di esempio non condivide la presenza.</span>} />
        ) : (
          <Row
            label={`Condividi la presenza in ${project.name}`}
            description={
              <>
                {presenceStatusLine(project.presence)}
                {project.presence?.message ? <span className="mt-1 block text-foreground/80">{project.presence.message}</span> : null}
              </>
            }
            control={<PresenceControls view={project.presence} consentChoice={project.document.presence?.choice ?? null} />}
          />
        )}
      </Group>
    </>
  );
}
