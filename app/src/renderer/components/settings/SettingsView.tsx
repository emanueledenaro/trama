import { addBlockedSite, blockedHostFrom, removeBlockedSite } from "@shared/blockedSites";
import { discussionModelSetting } from "@shared/discussions";
import {
  IconBan,
  IconBrain,
  IconBrandGithub,
  IconChecklist,
  IconChevronDown,
  IconDeviceDesktop,
  IconEye,
  IconListDetails,
  IconMoon,
  IconPlugConnected,
  IconRefresh,
  IconSchool,
  IconSettings,
  IconSun,
  IconTools,
  IconTrash,
  IconUsers,
  IconWorldOff,
} from "@/components/icons";
import { useEffect, useState } from "react";
import type { ProviderAccount } from "@shared/codex";
import type { GitHubCliState } from "@shared/onboarding";
import type { ThemePreference } from "@shared/domain";
import { classifyProviderFailure } from "@shared/providerFailure";
import { capabilityLines, coordinatorUnavailableReason, PROVIDERS, type ProviderDescriptor } from "@shared/providers";
import { aiHeroAttribution } from "@shared/skills";
import { MAX_ACTIVE_SQUADS, MAX_DEVELOPERS_PER_SQUAD, MIN_SQUAD_LIMIT, squadLimits } from "@shared/squads";
import { MAX_PARALLEL_DEVELOPERS_SETTING, MIN_PARALLEL_DEVELOPERS, sharedDevelopers } from "@shared/parallel";
import { offersCloud, WORK_PLACE_SETTINGS, workPlaceSetting } from "@shared/workPlace";
import { GitHubCliDescription } from "@/components/GitHubCliStatus";
import { TramaMark } from "@/components/brand/TramaMark";
import { ProviderIcon } from "@/components/ProviderIcon";
import { Spinner } from "@/components/Spinner";
import { Button, FilledScope } from "@/components/ui/button";
import { Badge, Input } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { CLEAN_CODE_VERSION } from "@shared/cleanCode";
import { cn } from "@/lib/cn";
import { useLanguage, useT } from "@/lib/i18n";
import { act, type SettingsSection, useUi } from "@/lib/store";
import { formatDateTime, type Language, type MessageKey, type Translate } from "@shared/i18n";
import { SwitchArea } from "@/components/settings/SwitchArea";
import { LanguageChoice } from "@/components/settings/LanguageChoice";
import { PresenceControls, PresenceStatus } from "@/components/PresencePanel";

/** The sections of the app (issue #336), apart from those of the open project. */
const APP_SECTIONS: SettingsSection[] = ["general", "connections"];

const SECTIONS: { id: SettingsSection; label: MessageKey; icon: React.ReactNode }[] = [
  { id: "general", label: "settings.section.general", icon: <IconSettings stroke={1.7} /> },
  { id: "connections", label: "settings.section.connections", icon: <IconPlugConnected stroke={1.7} /> },
  { id: "method", label: "settings.section.method", icon: <IconTools stroke={1.7} /> },
  { id: "standard", label: "settings.section.standard", icon: <IconChecklist stroke={1.7} /> },
  { id: "learning", label: "settings.section.learning", icon: <IconBrain stroke={1.7} /> },
  { id: "monitor", label: "settings.section.monitor", icon: <IconEye stroke={1.7} /> },
  { id: "presence", label: "settings.section.presence", icon: <IconUsers stroke={1.7} /> },
];

/** The settings page: a section list on the left, one section at a time on the right. */
export function SettingsView() {
  const section = useUi((s) => s.settingsSection);
  const openSettings = useUi((s) => s.openSettings);
  const closeSettings = useUi((s) => s.closeSettings);
  const projectName = useUi((s) => (s.app?.project ? (s.app.project.isDemo ? null : s.app.project.name) : null));
  const t = useT();
  return (
    <div
      className="chat-pane-enter flex min-h-0 flex-1 flex-col @2xl/chat:flex-row"
      data-testid="settings"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) closeSettings();
      }}
    >
      <nav
        aria-label={t("settings.sections")}
        className="flex shrink-0 flex-wrap gap-x-2 gap-y-0.5 border-b border-[color:var(--app-surface-divider)] px-3 py-2 @2xl/chat:w-52 @2xl/chat:flex-col @2xl/chat:flex-nowrap @2xl/chat:border-r @2xl/chat:border-b-0 @2xl/chat:px-2 @2xl/chat:py-4"
      >
        {/* The app's sections, then the project's (issue #336). */}
        {[
          { title: t("settings.group.app"), entries: SECTIONS.filter((entry) => APP_SECTIONS.includes(entry.id)) },
          { title: projectName ? t("settings.group.projectOf", { name: projectName }) : t("settings.group.project"), entries: SECTIONS.filter((entry) => !APP_SECTIONS.includes(entry.id)) },
        ].map((group) => (
          // Under 672 px the sections wrap on more lines instead of scrolling sideways out of sight.
          <div key={group.title} className="flex min-w-0 max-w-full flex-wrap gap-0.5 @2xl/chat:mb-3 @2xl/chat:flex-col @2xl/chat:flex-nowrap" role="group" aria-label={group.title}>
            <span className="hidden truncate px-2 pb-1 text-ui-xs text-muted-foreground @2xl/chat:block">{group.title}</span>
            {group.entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-current={section === entry.id ? "page" : undefined}
                onClick={() => openSettings(entry.id)}
                className={cn(
                  "flex h-8 min-w-0 max-w-full items-center gap-2 rounded-md px-2 text-left text-ui transition-colors [&_svg]:size-3.5 [&_svg]:shrink-0",
                  section === entry.id
                    ? "bg-[var(--sidebar-selected)] text-foreground"
                    : "text-foreground/80 hover:bg-[var(--sidebar-accent)] hover:text-foreground",
                )}
              >
                {entry.icon}
                <span className="truncate">{t(entry.label)}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* The one filled button of the window is the one of Aspetta te (ADR 0018): a primary here is drawn as an outline. */}
        <FilledScope allowed={false}>
          <div key={section} className="mx-auto w-full max-w-[40rem] px-4 py-6 @min-[560px]/chat:px-8">
            {section === "general" ? <GeneralSection /> : null}
            {section === "connections" ? <ConnectionsSection /> : null}
            {section === "method" ? <MethodSection /> : null}
            {section === "standard" ? <StandardSection /> : null}
            {section === "learning" ? <LearningSection /> : null}
            {section === "monitor" ? <MonitorSection /> : null}
            {section === "presence" ? <PresenceSection /> : null}
          </div>
        </FilledScope>
      </div>
    </div>
  );
}

function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start gap-x-4 gap-y-2">
      <div className="min-w-[12rem] flex-1">
        <h2 className="text-ui-lg font-medium text-foreground">{title}</h2>
        {description ? <p className="mt-1 text-ui-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="cta-row ml-auto min-w-0 max-w-full">{actions}</div> : null}
    </header>
  );
}

/** A titled card of rows, as in the Codex settings. */
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
        {control ? <div className="cta-row ml-auto min-w-0 max-w-full">{control}</div> : null}
      </div>
      {children}
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description?: React.ReactNode; checked: boolean; onChange: (value: boolean) => void }) {
  return <Row label={label} description={description} control={<SwitchArea checked={checked} onChange={onChange} label={label} />} />;
}

function GeneralSection() {
  const theme = useUi((s) => s.app?.settings.theme ?? "system");
  const sounds = useUi((s) => s.app?.settings.sounds === true);
  const openWelcome = useUi((s) => s.openWelcome);
  const t = useT();
  const options: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
    { value: "system", label: t("settings.theme.system"), icon: <IconDeviceDesktop className="size-3.5" stroke={1.7} /> },
    { value: "light", label: t("settings.theme.light"), icon: <IconSun className="size-3.5" stroke={1.7} /> },
    { value: "dark", label: t("settings.theme.dark"), icon: <IconMoon className="size-3.5" stroke={1.7} /> },
  ];
  return (
    <>
      <PageHeader title={t("settings.section.general")} />
      <Group>
        <Row label={t("language.label")} description={t("language.description")} control={<LanguageChoice />} />
        <Row
          label={t("settings.theme")}
          description={t("settings.theme.description")}
          control={
            <div role="radiogroup" aria-label={t("settings.theme")} className="flex flex-wrap rounded-lg bg-[var(--color-background-button-secondary)] p-0.5">
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={theme === option.value}
                  onClick={() => void act("settings:update", { theme: option.value })}
                  className={cn(
                    "flex h-8 items-center gap-2 rounded-md px-4 text-ui-sm transition-colors",
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
          label={t("settings.sounds")}
          description={t("settings.sounds.description")}
          checked={sounds}
          onChange={(value) => void act("settings:update", { sounds: value })}
        />
        <Row
          label={t("settings.guide")}
          description={t("settings.guide.description")}
          control={
            <Button variant="outline" onClick={() => openWelcome()}>
              <IconSchool stroke={1.8} /> {t("settings.guide.open")}
            </Button>
          }
        />
      </Group>
      <BlockedSitesGroup />
      <Group title={t("settings.about")}>
        <div className="flex items-center gap-3 px-4 py-3" data-testid="about-trama">
          <TramaMark size={40} variant="tile" />
          <div className="min-w-0 flex-1">
            <div className="text-ui text-foreground">Trama</div>
            <div className="mt-0.5 text-ui-sm text-muted-foreground" data-testid="about-version">
              {t("settings.about.version", { version: __TRAMA_VERSION__ })}
            </div>
            {__TRAMA_COMMIT__ && <div className="mt-0.5 font-mono text-ui-sm text-muted-foreground">{t("settings.about.commit", { commit: __TRAMA_COMMIT__ })}</div>}
          </div>
        </div>
      </Group>
    </>
  );
}

/** The sites the person blocks, one list for every project (ADR 0020, issue #414). */
function BlockedSitesGroup() {
  const sites = useUi((s) => s.app?.settings.blockedSites ?? []);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<"invalid" | "duplicate" | "full" | null>(null);
  const t = useT();
  const add = () => {
    const result = addBlockedSite(sites, text);
    if (result.problem) {
      setProblem(result.problem);
      return;
    }
    setProblem(null);
    setText("");
    void act("settings:update", { blockedSites: result.list });
  };
  return (
    <Group title={t("settings.blocked.title")} note={t("settings.blocked.description")}>
      <div className="px-4 py-3" data-testid="blocked-sites">
        <form
          className="flex flex-wrap items-center gap-x-4 gap-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <Input
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setProblem(null);
            }}
            aria-label={t("settings.blocked.label")}
            aria-invalid={problem ? true : undefined}
            placeholder={t("settings.blocked.placeholder")}
            data-testid="blocked-site-input"
            className="min-w-[12rem] flex-1"
          />
          <div className="cta-row ml-auto min-w-0 max-w-full">
            <Button type="submit" variant="outline" disabled={!text.trim()} data-testid="blocked-site-add">
              <IconBan stroke={1.8} /> {t("settings.blocked.add")}
            </Button>
          </div>
        </form>
        {problem ? (
          <p role="alert" className="mt-2 text-ui-sm text-destructive" data-testid="blocked-site-problem">
            {t(`settings.blocked.${problem}`, { site: blockedHostFrom(text) ?? text.trim() })}
          </p>
        ) : null}
      </div>
      {sites.length === 0 ? (
        <div className="px-4 py-3 text-ui-sm text-muted-foreground" data-testid="blocked-sites-empty">
          {t("settings.blocked.empty")}
        </div>
      ) : (
        sites.map((site) => (
          <div key={site} className="flex items-center gap-3 px-4 py-2" data-testid="blocked-site" data-site={site}>
            <IconWorldOff className="size-4 shrink-0 text-muted-foreground" stroke={1.7} />
            <span className="min-w-0 flex-1 truncate font-mono text-ui-sm text-foreground">{site}</span>
            <div className="cta-row ml-auto">
              <IconButton
                label={t("settings.blocked.remove", { site })}
                icon={<IconTrash stroke={1.7} />}
                onClick={() => void act("settings:update", { blockedSites: removeBlockedSite(sites, site) })}
              />
            </div>
          </div>
        ))
      )}
    </Group>
  );
}

export function providerStatus(
  t: Translate,
  language: Language,
  account: ProviderAccount | null,
  checking: boolean,
): { label: string; detail: string | null; tone: "success" | "warning" | "secondary" } {
  if (checking && !account) return { label: t("provider.status.checking"), detail: null, tone: "secondary" };
  switch (account?.kind) {
    case "chatgpt": {
      const detail = [account.email, account.plan ? t("provider.status.plan", { plan: account.plan }) : null].filter(Boolean).join(", ") || null;
      return { label: t("provider.status.connected"), detail, tone: "success" };
    }
    case "authenticated":
      return { label: t("provider.status.connected"), detail: account.label, tone: "success" };
    case "signedOut":
      return { label: t("provider.status.signInRequired"), detail: null, tone: "secondary" };
    case "unsupported":
      return { label: t("provider.status.unsupported"), detail: account.type, tone: "warning" };
    case "blocked": {
      // The provider's text stays out of the row: its class in plain words (P10).
      const failure = classifyProviderFailure(t, account.message);
      const until = !failure.until && account.until ? ` ${t("provider.status.unlocksAt", { date: formatDateTime(language, account.until) })}` : "";
      const label = failure.kind === "temporaryLimit" ? t("provider.status.temporaryLimit") : t("provider.status.quotaExhausted");
      return { label, detail: `${failure.explanation}${until}`, tone: "warning" };
    }
    case "unavailable":
      return { label: t("provider.status.unavailable"), detail: account.message, tone: "warning" };
    default:
      return { label: t("provider.status.unknown"), detail: null, tone: "secondary" };
  }
}

const GITHUB_STATUS: Record<GitHubCliState["status"], MessageKey> = {
  unknown: "github.status.unknown",
  checking: "github.status.checking",
  missing: "github.status.missing",
  signedOut: "github.status.signedOut",
  ready: "github.status.ready",
  error: "github.status.error",
};

/** The Capacità button of a provider row, the same for every provider (issue #71), as an icon with its tooltip (issue #336). */
function CapabilityToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const t = useT();
  return (
    <IconButton
      label={t("settings.provider.capabilities")}
      icon={<IconListDetails />}
      size="icon"
      aria-expanded={open}
      className={cn(open && "bg-[var(--color-background-button-secondary)] text-foreground")}
      onClick={onToggle}
    />
  );
}

/** Checks a connection again, as an icon with its tooltip (issue #336). */
function CheckButton({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return <IconButton label={label} icon={<IconRefresh />} size="icon" disabled={disabled} onClick={onClick} />;
}

function CapabilityList({ provider }: { provider: ProviderDescriptor }) {
  const t = useT();
  return (
    <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 rounded-lg bg-[var(--color-background-button-secondary)] px-3 py-2 text-ui-xs @xl/chat:grid-cols-2">
      {capabilityLines(t, provider.capabilities).map((line) => (
        <div key={line.label} className="flex justify-between gap-2">
          <span className="text-muted-foreground">{line.label}</span>
          <span className="text-foreground/90">{line.value}</span>
        </div>
      ))}
    </div>
  );
}

const CODEX = PROVIDERS.find((provider) => provider.id === "codex")!;

function ConnectionsSection() {
  const [codexOpen, setCodexOpen] = useState(false);
  const t = useT();
  const language = useLanguage();
  const codex = useUi((s) => s.app!.codex);
  const gitHubCli = useUi((s) => s.app!.gitHubCli);
  const capabilities = useUi((s) => s.app?.project?.github.capabilities ?? null);
  // What the account can do in the open project's repository, which Issue showed before Lavoro (issue #332).
  const access = !capabilities
    ? null
    : capabilities.status === "ready"
      ? [
          capabilities.login ? t("github.access.login", { login: capabilities.login }) : t("github.access.gh"),
          capabilities.private === null ? null : capabilities.private ? t("github.access.private") : t("github.access.public"),
          capabilities.canPush ? t("github.access.canPush") : t("github.access.readOnly"),
          capabilities.rateRemaining !== null ? t("github.access.rate", { count: capabilities.rateRemaining }) : null,
        ]
          .filter(Boolean)
          .join(", ")
      : capabilities.message;
  // The state is read each time the page opens, so a login made in the terminal meanwhile shows up (P10).
  useEffect(() => {
    if (useUi.getState().app?.gitHubCli.status !== "checking") void act("onboarding:checkGitHub", undefined);
  }, []);
  const account = codex.account;
  const status = providerStatus(t, language, account, codex.checking);
  const providerStates = useUi((s) => s.app!.providers);
  // One line on top: how many of the connections are ready (the states below say which and why).
  const others = PROVIDERS.filter((provider) => provider.id !== "codex");
  const ready =
    Number(status.tone === "success") +
    Number(gitHubCli.status === "ready") +
    others.filter((provider) => providerStatus(t, language, providerStates[provider.id]?.account ?? null, false).tone === "success").length;
  const total = 2 + others.length;
  const codexDetail = account?.kind === "unsupported" ? t("settings.connections.codexUnsupported", { type: account.type }) : status.detail;
  return (
    <>
      <PageHeader
        title={t("settings.section.connections")}
        description={t("settings.connections.description")}
        actions={
          <Button
            variant="outline"
            onClick={() => {
              void act("codex:refresh", undefined);
              void act("providers:refresh", {});
              void act("onboarding:checkGitHub", undefined);
            }}
          >
            <IconRefresh /> {t("settings.connections.checkAll")}
          </Button>
        }
      />
      <p className="mb-6 text-ui text-foreground" data-testid="connections-summary">
        {t("settings.connections.summary", { ready, total })}
      </p>
      <Group title={t("settings.connections.mainAccount")}>
        <Row
          label={
            <span className="flex items-center gap-2">
              <ProviderIcon provider="codex" className="size-4" /> ChatGPT {codex.checking ? <Spinner /> : null}
            </span>
          }
          description={
            <>
              {codexDetail ?? (account === null ? t("provider.status.checking") : null)}
              {account?.kind === "chatgpt" ? (
                <span className="text-muted-foreground/70"> · {t("settings.connections.models", { count: codex.models.length })}</span>
              ) : null}
            </>
          }
          control={
            <>
              <Badge tone={status.tone}>{status.label}</Badge>
              <CapabilityToggle open={codexOpen} onToggle={() => setCodexOpen(!codexOpen)} />
              <CheckButton label={t("settings.provider.checkOf", { name: "ChatGPT" })} onClick={() => void act("codex:refresh", undefined)} />
              {account?.kind === "signedOut" ? (
                <Button onClick={() => void act("codex:login", undefined)}>
                  {t("settings.connections.signInChatGpt")}
                </Button>
              ) : null}
            </>
          }
        >
          {codexOpen ? <CapabilityList provider={CODEX} /> : null}
        </Row>
        <Row
          label={
            <span className="flex items-center gap-2">
              <IconBrandGithub className="size-4" stroke={1.7} /> GitHub
            </span>
          }
          description={
            <>
              <span className={cn(gitHubCli.status === "error" && "text-destructive")} data-testid="github-description">
                <GitHubCliDescription state={gitHubCli} />
              </span>
              {access ? (
                <span className="mt-1 block" data-testid="github-access">
                  {t("settings.connections.githubAccess", { access })}
                </span>
              ) : null}
            </>
          }
          control={
            <>
              <Badge tone={gitHubCli.status === "ready" ? "success" : gitHubCli.status === "error" ? "destructive" : "secondary"}>
                {t(GITHUB_STATUS[gitHubCli.status])}
              </Badge>
              <CheckButton
                label={t("settings.connections.checkAgain")}
                disabled={gitHubCli.status === "checking"}
                onClick={() => void act("onboarding:checkGitHub", undefined)}
              />
            </>
          }
        />
      </Group>
      <Group title={t("settings.connections.providers")} note={t("settings.connections.providersNote")}>
        {PROVIDERS.filter((provider) => provider.id !== "codex").map((provider) => (
          <ProviderRow key={provider.id} provider={provider} />
        ))}
      </Group>
    </>
  );
}

/**
 * The GitHub account of the open project's repository: who is signed in, the repository's visibility, whether the
 * account can push and the API requests left. It was in Issue until issue #336.
 */
function ProviderRow({ provider }: { provider: ProviderDescriptor }) {
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const t = useT();
  const language = useLanguage();
  const id = provider.id;
  const state = useUi((s) => s.app!.providers[id]);
  const status = providerStatus(t, language, state?.account ?? null, state?.checking ?? false);
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
          {status.detail ? <span className={cn(state?.account?.kind === "unavailable" && "text-destructive")}>{status.detail}</span> : null}
          {connected && state ? (
            <span className="text-muted-foreground/70">
              {status.detail ? " · " : ""}
              {t("settings.connections.models", { count: state.models.length })}
            </span>
          ) : null}
          {!connected ? (
            <span className="block">
              {t("settings.provider.signInCommand")} <code className="font-mono text-foreground/90">{provider.signInCommand}</code>
            </span>
          ) : null}
          {coordinatorUnavailableReason(t, id) ? <span className="block text-warning">{coordinatorUnavailableReason(t, id)}</span> : null}
          {hint ? <span className="block text-foreground/80">{hint}</span> : null}
        </>
      }
      control={
        <>
          <Badge tone={state?.account?.kind === "unavailable" ? "destructive" : status.tone}>{status.label}</Badge>
          <CapabilityToggle open={open} onToggle={() => setOpen(!open)} />
          <CheckButton label={t("settings.provider.checkOf", { name: provider.name })} onClick={() => void act("providers:refresh", { provider: id })} />
          {state?.account?.kind === "signedOut" ? (
            <Button
              variant="outline"
              onClick={() =>
                void act("provider:login", { provider: id }).then((result) =>
                  setHint(result?.command ? t("settings.provider.signInHint", { command: result.command }) : null),
                )
              }
            >
              {t("settings.provider.signIn")}
            </Button>
          ) : null}
        </>
      }
    >
      {open ? <CapabilityList provider={provider} /> : null}
    </Row>
  );
}

function MethodSection() {
  const project = useUi((s) => s.app?.project ?? null);
  const autoPrepare = useUi((s) => s.app?.settings.autoPrepareMethod !== false);
  const continuousWork = useUi((s) => s.app?.settings.continuousWork !== false);
  const [report, setReport] = useState<{ pathsCreated: string[]; existingPreserved: string[]; warnings: string[]; version: string } | null>(null);
  const [running, setRunning] = useState(false);
  const t = useT();
  const noProject = !project || project.isDemo;
  return (
    <>
      <PageHeader title={t("settings.section.method")} description={t("settings.method.description")} />
      <Group note={t("settings.method.note", { attribution: aiHeroAttribution(t) })}>
        <ToggleRow
          label={t("settings.method.autoPrepare")}
          checked={autoPrepare}
          onChange={(value) => void act("settings:update", { autoPrepareMethod: value })}
        />
        <Row
          label={t("settings.method.prepareNow")}
          description={
            noProject ? (
              t("settings.method.openProject")
            ) : report ? (
              <>
                {t("method.report", { version: report.version, created: report.pathsCreated.length, preserved: report.existingPreserved.length })}
                {report.warnings.length ? ` ${report.warnings.join(" ")}` : ""}
              </>
            ) : project?.missingMethodSkills?.length ? (
              <span className="text-warning">{t("settings.method.missingSkills", { skills: project.missingMethodSkills.join(", ") })}</span>
            ) : project?.missingMethodSkills ? (
              t("settings.method.allLoaded")
            ) : null
          }
          control={
            <>
              <Button
                variant="ghost"
                disabled={noProject}
                onClick={() =>
                  // The record of the rollback goes to the project's chat; this page says it happened (W12).
                  void act("skills:rollback", undefined).then((restored) => {
                    if (!restored) return;
                    setReport(null);
                    useUi.getState().setToast(t("settings.method.rolledBack", { count: restored.length }), "info");
                  })
                }
              >
                {t("settings.method.rollback")}
              </Button>
              {/* The row's primary: last, on the right, and never filled (ADR 0018). */}
              <Button
                variant="outline"
                disabled={noProject || running}
                onClick={async () => {
                  setRunning(true);
                  setReport((await act("skills:prepare", undefined)) ?? null);
                  setRunning(false);
                }}
              >
                {running ? <Spinner /> : null} {t("settings.method.prepare")}
              </Button>
            </>
          }
        />
      </Group>
      <Group title={t("settings.continuous.title")}>
        <ToggleRow
          label={t("settings.continuous.label")}
          description={t("settings.continuous.description")}
          checked={continuousWork}
          onChange={(value) => void act("settings:update", { continuousWork: value })}
        />
      </Group>
      <DevelopersAtWorkGroup />
      <WorkPlaceGroup />
      <DiscussionModelGroup />
    </>
  );
}

/** The shared limit's choices (issue #39): the small numbers one by one, then the larger steps. */
const SHARED_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10, 12];

const range = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, index) => min + index);
const PARALLEL_OPTIONS = range(MIN_PARALLEL_DEVELOPERS, MAX_PARALLEL_DEVELOPERS_SETTING);
const PER_SQUAD_OPTIONS = range(MIN_SQUAD_LIMIT, MAX_DEVELOPERS_PER_SQUAD);
const ACTIVE_SQUAD_OPTIONS = range(MIN_SQUAD_LIMIT, MAX_ACTIVE_SQUADS);

/** One limit as a row of numbers to pick from. */
function LimitPicker({ label, testId, options, value, onPick }: { label: string; testId: string; options: number[]; value: number | null; onPick: (value: number) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap rounded-lg bg-[var(--color-background-button-secondary)] p-0.5" data-testid={testId}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onPick(option)}
          className={cn(
            "flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-ui-sm tabular-nums transition-colors",
            value === option ? "bg-[var(--color-background-surface)] text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/**
 * The limits of developers at work, from the widest (W08, #346, A10 Q22): in all projects, in the open project, per
 * squad and squads together. A developer starts only when every one of them allows it; each has one control.
 */
function DevelopersAtWorkGroup() {
  const project = useUi((s) => s.app?.project ?? null);
  const usable = Boolean(project && !project.isDemo && project.stateWritable);
  const limits = project ? squadLimits(project.document) : null;
  const shared = useUi((s) => (s.app ? sharedDevelopers(s.app.settings) : null));
  const t = useT();
  const unavailable = !project ? t("settings.squads.openProject") : project.isDemo ? t("settings.squads.demo") : null;
  const setProject = (setting: "parallelDevelopers" | "developersPerSquad" | "activeSquads") => (value: number) => void act("project:settings", { [setting]: value });
  return (
    <Group title={t("settings.parallel.title")} note={t("settings.squads.note")}>
      <Row
        label={t("settings.parallel.shared")}
        description={t("settings.parallel.sharedDescription")}
        control={
          <LimitPicker
            label={t("settings.parallel.sharedLabel")}
            testId="shared-developers"
            options={SHARED_OPTIONS}
            value={shared}
            onPick={(value) => void act("settings:update", { sharedDevelopers: value })}
          />
        }
      />
      <Row
        label={project ? t("settings.parallel.inProject", { name: project.name }) : t("settings.parallel.inOpenProject")}
        description={unavailable ?? t("settings.parallel.default")}
        control={
          usable && limits ? (
            <LimitPicker label={t("settings.parallel.projectLabel")} testId="parallel-developers" options={PARALLEL_OPTIONS} value={limits.project} onPick={setProject("parallelDevelopers")} />
          ) : null
        }
      />
      <Row
        label={t("settings.squads.developers")}
        description={unavailable ?? t("settings.squads.default")}
        control={
          usable && limits ? (
            <LimitPicker label={t("settings.squads.developers")} testId="squad-limit-developersPerSquad" options={PER_SQUAD_OPTIONS} value={limits.developersPerSquad} onPick={setProject("developersPerSquad")} />
          ) : null
        }
      />
      <Row
        label={t("settings.squads.active")}
        description={unavailable ?? t("settings.squads.default")}
        control={
          usable && limits ? (
            <LimitPicker label={t("settings.squads.active")} testId="squad-limit-activeSquads" options={ACTIVE_SQUAD_OPTIONS} value={limits.activeSquads} onPick={setProject("activeSquads")} />
          ) : null
        }
      />
    </Group>
  );
}

/**
 * A19 (issue #260): where the developers' work runs in the open project. Automatic unless the person changes it; the
 * cloud is offered only when the project's provider has one (Claude or Codex).
 */
function WorkPlaceGroup() {
  const t = useT();
  const project = useUi((s) => s.app?.project ?? null);
  const usable = project && !project.isDemo && project.stateWritable;
  const provider = project ? (project.document.coordinator.threadProvider ?? project.document.selectedProvider ?? "codex") : null;
  const cloud = offersCloud(provider);
  const setting = project ? workPlaceSetting(project.document) : null;
  const options = cloud ? WORK_PLACE_SETTINGS : WORK_PLACE_SETTINGS.filter((value) => value === "local");
  const selected = cloud ? setting : "local";
  return (
    <Group title={t("settings.workPlace.title")} note={t("settings.workPlace.note")}>
      <Row
        label={project ? t("settings.workPlace.inProject", { name: project.name }) : t("settings.workPlace.inOpenProject")}
        description={
          !project
            ? t("settings.workPlace.openProject")
            : project.isDemo
              ? t("settings.workPlace.demo")
              : !cloud
                ? t("settings.workPlace.localOnly", { provider: PROVIDERS.find((p) => p.id === provider)?.name ?? String(provider) })
                : t(`workPlace.setting.${setting!}.description`)
        }
        control={
          usable ? (
            <div role="radiogroup" aria-label={t("settings.workPlace.title")} className="flex flex-col rounded-lg bg-[var(--color-background-button-secondary)] p-0.5 @min-[560px]/chat:flex-row" data-testid="work-place">
              {options.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected === value}
                  disabled={!cloud}
                  onClick={() => void act("project:settings", { workPlace: value })}
                  className={cn(
                    "flex h-8 min-w-0 items-center justify-center rounded-md px-3 text-ui-sm transition-colors @min-[560px]/chat:px-4",
                    selected === value ? "bg-[var(--color-background-surface)] text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(`workPlace.setting.${value}`)}
                </button>
              ))}
            </div>
          ) : null
        }
      />
    </Group>
  );
}

/** The model of the discussions between agents (A12, Q17): the provider's lightest by default, or the role's. */
function DiscussionModelGroup() {
  const t = useT();
  const project = useUi((s) => s.app?.project ?? null);
  const usable = project && project.stateWritable;
  const setting = project ? discussionModelSetting(project.document) : null;
  return (
    <Group title={t("settings.discussions.title")} note={t("settings.discussions.note")}>
      <Row
        label={project ? t("settings.discussions.inProject", { name: project.name }) : t("settings.discussions.inOpenProject")}
        description={!project ? t("settings.discussions.openProject") : t(`settings.discussions.${setting!}.description`)}
        control={
          usable ? (
            <div role="radiogroup" aria-label={t("settings.discussions.inOpenProject")} className="flex flex-col rounded-lg bg-[var(--color-background-button-secondary)] p-0.5 @min-[560px]/chat:flex-row" data-testid="discussion-model">
              {(["light", "role"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={setting === value}
                  onClick={() => void act("project:settings", { discussionModel: value })}
                  className={cn(
                    "flex h-8 min-w-0 items-center justify-center rounded-md px-3 text-ui-sm transition-colors @min-[560px]/chat:px-4",
                    setting === value ? "bg-[var(--color-background-surface)] text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(`settings.discussions.${value}`)}
                </button>
              ))}
            </div>
          ) : null
        }
      />
    </Group>
  );
}

/**
 * The code standard moved to Regole (issue #334): it applies to the open project, so the rules and the note live with
 * the mandate and the Pact. Settings keeps this way there.
 */
function StandardSection() {
  const project = useUi((s) => s.app?.project ?? null);
  const setInspector = useUi((s) => s.setInspector);
  const t = useT();
  return (
    <>
      <PageHeader title={t("settings.section.standard")} description={t("settings.standard.description", { version: CLEAN_CODE_VERSION })} />
      <Group>
        {!project ? (
          <Row label={<span className="text-muted-foreground">{t("settings.standard.openProject")}</span>} />
        ) : (
          <Row
            label={<span className="text-muted-foreground">{t("settings.standard.moved")}</span>}
            control={
              <Button size="sm" variant="outline" data-testid="standard-open-rules" onClick={() => setInspector({ kind: "standard" })}>
                {t("settings.standard.open")}
              </Button>
            }
          />
        )}
      </Group>
    </>
  );
}

/**
 * The learning switches moved to Memoria, in Come impara (issue #335): they live next to the reviews and the upkeep
 * they turn on and off. Settings keeps this way there.
 */
function LearningSection() {
  const project = useUi((s) => s.app?.project ?? null);
  const setInspector = useUi((s) => s.setInspector);
  const t = useT();
  return (
    <>
      <PageHeader title={t("settings.section.learning")} description={t("settings.learning.description")} />
      <Group>
        {!project ? (
          <Row label={<span className="text-muted-foreground">{t("settings.learning.openProject")}</span>} />
        ) : (
          <Row
            label={<span className="text-muted-foreground">{t("settings.learning.moved")}</span>}
            control={
              <Button size="sm" variant="outline" data-testid="learning-open-memory" onClick={() => setInspector({ kind: "memory", howItLearns: true })}>
                {t("settings.learning.open")}
              </Button>
            }
          />
        )}
      </Group>
    </>
  );
}

function MonitorSection() {
  const monitor = useUi((s) => s.app!.monitor);
  const repository = useUi((s) => s.app?.project?.github.repository ?? null);
  const platform = useUi((s) => s.app!.platform);
  const monitored = repository ? monitor.repositories.includes(repository) : false;
  const t = useT();
  return (
    <>
      <PageHeader title={t("settings.section.monitor")} description={t("settings.monitor.description")} />
      {/* The summary: is it on, and how many repositories does it watch. */}
      <p className="mb-6 text-ui text-foreground" data-testid="monitor-summary">
        {monitor.enabled ? t("settings.monitor.summaryOn", { count: monitor.repositories.length }) : t("settings.monitor.summaryOff")}
      </p>
      <Group>
        <ToggleRow label={t("settings.monitor.enabled")} checked={monitor.enabled} onChange={(enabled) => void act("monitor:update", { enabled })} />
        {platform !== "linux" ? (
          <ToggleRow
            label={t("settings.monitor.openAtLogin")}
            checked={monitor.openAtLogin}
            onChange={(openAtLogin) => void act("monitor:update", { openAtLogin })}
          />
        ) : null}
      </Group>
      <Group title={t("settings.monitor.repositories")}>
        {/* The empty note never sits above the open project's repository: that row says it is not observed yet (issue #272). */}
        {monitor.repositories.length === 0 && !(repository && !monitored) ? (
          <Row label={<span className="text-muted-foreground">{t("settings.monitor.none")}</span>} />
        ) : null}
        {monitor.repositories.map((repo) => {
          const status = monitor.status[repo];
          return (
            <Row
              key={repo}
              label={<span className="font-mono text-ui-sm">{repo}</span>}
              description={status?.lastError ? <span className="text-destructive">{status.lastError}</span> : status?.lastSuccessAt ? t("settings.monitor.updated") : null}
              control={
                <Button variant="ghost" onClick={() => void act("monitor:update", { removeRepository: repo })}>
                  {t("settings.monitor.remove")}
                </Button>
              }
            />
          );
        })}
        {repository && !monitored ? (
          <Row
            label={<span className="font-mono text-ui-sm">{repository}</span>}
            description={t("settings.monitor.openRepository")}
            control={
              <Button variant="outline" onClick={() => void act("monitor:update", { enabled: true, addRepository: repository })}>
                <IconEye stroke={1.8} /> {t("settings.monitor.watch")}
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
  const t = useT();
  return (
    <>
      <PageHeader title={t("settings.presence.title")} description={t("settings.presence.description")} />
      <Group note={t("settings.presence.note")}>
        {!project ? (
          <Row label={<span className="text-muted-foreground">{t("settings.presence.openProject")}</span>} />
        ) : project.isDemo ? (
          <Row label={<span className="text-muted-foreground">{t("settings.presence.demo")}</span>} />
        ) : (
          <Row
            label={t("settings.presence.share", { name: project.name })}
            description={<PresenceStatus view={project.presence} />}
            control={<PresenceControls view={project.presence} consentChoice={project.document.presence?.choice ?? null} />}
          />
        )}
      </Group>
    </>
  );
}
