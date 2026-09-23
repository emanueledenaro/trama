import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-react";
import { useState } from "react";
import type { ThemePreference } from "@shared/domain";
import { capabilityLines, PROVIDERS, type ProviderDescriptor } from "@shared/providers";
import { Button } from "@/components/ui/button";
import { Input, Label, TextArea } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";
import { act, useUi } from "@/lib/store";

function SettingsDialog() {
  const open = useUi((s) => s.dialog === "settings");
  const setDialog = useUi((s) => s.setDialog);
  const theme = useUi((s) => s.app?.settings.theme ?? "system");
  const options: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
    { value: "system", label: "Sistema", icon: <IconDeviceDesktop className="size-4" stroke={1.7} /> },
    { value: "light", label: "Chiaro", icon: <IconSun className="size-4" stroke={1.7} /> },
    { value: "dark", label: "Scuro", icon: <IconMoon className="size-4" stroke={1.7} /> },
  ];
  return (
    <Dialog open={open} onOpenChange={(value) => setDialog(value ? "settings" : null)} title="Impostazioni di Trama">
      <div className="space-y-5 pt-2">
        <section>
          <h4 className="mb-2 text-ui-sm font-medium text-muted-foreground">Aspetto</h4>
          <div className="grid grid-cols-3 gap-2">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => void act("settings:update", { theme: option.value })}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-ui transition-colors",
                  theme === option.value
                    ? "border-[color:var(--color-text-accent)] bg-[color-mix(in_srgb,var(--color-text-accent)_6%,transparent)] text-foreground"
                    : "border-[color:var(--color-border)] text-muted-foreground hover:bg-[var(--color-background-button-secondary-hover)]",
                )}
              >
                {option.icon}
                {option.label}
              </button>
            ))}
          </div>
        </section>
        <MonitorSettings />
        <MethodSettings />
        <section>
          <h4 className="mb-2 text-ui-sm font-medium text-muted-foreground">Codex di OpenAI</h4>
          <Button variant="outline" size="sm" onClick={() => setDialog("connections")}>
            Apri Collegamenti
          </Button>
        </section>
      </div>
    </Dialog>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1 text-ui text-foreground/90">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-[var(--color-text-accent)]" : "bg-[var(--color-border-heavy)]",
        )}
      >
        <span className={cn("inline-block size-[14px] rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-[14px]" : "translate-x-[2px]")} />
      </button>
    </label>
  );
}

function MonitorSettings() {
  const monitor = useUi((s) => s.app!.monitor);
  const repository = useUi((s) => s.app?.project?.github.repository ?? null);
  const platform = useUi((s) => s.app!.platform);
  const monitored = repository ? monitor.repositories.includes(repository) : false;
  return (
    <section>
      <h4 className="mb-1 text-ui-sm font-medium text-muted-foreground">Monitor in background</h4>
      <p className="mb-2 text-ui-xs text-muted-foreground">
        Legge branch e pull request dei colleghi con GitHub CLI e ti avvisa delle novità mentre Trama è aperto o in background.
      </p>
      <Toggle checked={monitor.enabled} onChange={(enabled) => void act("monitor:update", { enabled })} label="Monitor attivo" />
      {platform !== "linux" ? (
        <Toggle checked={monitor.openAtLogin} onChange={(openAtLogin) => void act("monitor:update", { openAtLogin })} label="Avvia Trama all'accesso, in background" />
      ) : null}
      <div className="mt-2 space-y-1">
        {monitor.repositories.map((repo) => {
          const status = monitor.status[repo];
          return (
            <div key={repo} className="flex items-center gap-2 text-ui">
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{repo}</span>
              <span className="text-ui-xs text-muted-foreground">{status?.lastError ? "errore" : status?.lastSuccessAt ? "aggiornato" : ""}</span>
              <button type="button" className="text-ui-xs text-muted-foreground hover:text-destructive" onClick={() => void act("monitor:update", { removeRepository: repo })}>
                Togli
              </button>
            </div>
          );
        })}
      </div>
      {repository && !monitored ? (
        <Button size="sm" variant="outline" className="mt-2" onClick={() => void act("monitor:update", { enabled: true, addRepository: repository })}>
          Abilita per il repository corrente
        </Button>
      ) : null}
    </section>
  );
}

function MethodSettings() {
  const project = useUi((s) => s.app?.project ?? null);
  const [report, setReport] = useState<{ pathsCreated: string[]; existingPreserved: string[]; warnings: string[]; version: string } | null>(null);
  const [running, setRunning] = useState(false);
  return (
    <section>
      <h4 className="mb-1 text-ui-sm font-medium text-muted-foreground">Metodo di lavoro</h4>
      <p className="mb-2 text-ui-xs text-muted-foreground">
        Copia nel progetto un sottoinsieme fissato delle skill AI Hero di Matt Pocock (licenza MIT), senza installer e senza cambiare le impostazioni globali di Codex. I file esistenti restano invariati.
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={!project || project.isDemo || running}
        onClick={async () => {
          setRunning(true);
          setReport((await act("skills:prepare", undefined)) ?? null);
          setRunning(false);
        }}
      >
        {running ? <Spinner /> : null} Prepara il metodo di lavoro nel progetto
      </Button>
      {report ? (
        <p className="mt-2 text-ui-xs text-muted-foreground">
          AI Hero {report.version}: {report.pathsCreated.length} percorsi creati, {report.existingPreserved.length} preservati.
          {report.warnings.length ? ` ${report.warnings.join(" ")}` : ""}
        </p>
      ) : null}
    </section>
  );
}

function ProviderRow({ provider }: { provider: ProviderDescriptor }) {
  const [open, setOpen] = useState(false);
  const account = useUi((s) => s.app!.codex.account);
  const state = !provider.available
    ? "Non disponibile"
    : account?.kind === "chatgpt"
      ? "Collegato"
      : account?.kind === "signedOut" || account?.kind === "unsupported"
        ? "Accesso richiesto"
        : "Stato sconosciuto";
  return (
    <div className="py-2">
      <div className="flex items-center gap-2 text-ui">
        <span className="text-foreground">{provider.name}</span>
        {!provider.available ? <span className="text-ui-xs text-muted-foreground">adattatore non ancora disponibile</span> : null}
        <span className={cn("ml-auto text-ui-xs", state === "Collegato" ? "text-success" : "text-muted-foreground")}>{state}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-ui-xs text-muted-foreground">
        <span>
          Accesso: <code className="font-mono">{provider.signInCommand}</code>
        </span>
        <button type="button" className="ml-auto hover:text-foreground" onClick={() => setOpen(!open)}>
          {open ? "Nascondi capacità" : "Capacità"}
        </button>
      </div>
      {open ? (
        <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-ui-xs">
          {capabilityLines(provider.capabilities).map((line) => (
            <div key={line.label} className="flex justify-between gap-2">
              <span className="text-muted-foreground">{line.label}</span>
              <span className="text-foreground/90">{line.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ConnectionsDialog() {
  const open = useUi((s) => s.dialog === "connections");
  const setDialog = useUi((s) => s.setDialog);
  const codex = useUi((s) => s.app!.codex);
  const account = codex.account;
  const status =
    account === null
      ? "Verifica in corso"
      : account.kind === "chatgpt"
        ? `Account riconosciuto${account.email ? `: ${account.email}` : ""} · piano ${account.plan}`
        : account.kind === "signedOut"
          ? "Nessun account collegato"
          : account.kind === "unsupported"
            ? `Codex usa un account di tipo ${account.type}. Trama accetta solo un account ChatGPT per evitare la fatturazione API.`
            : account.message;
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => setDialog(value ? "connections" : null)}
      title="Collegamenti"
      description="L'accesso avviene nel browser ufficiale. Trama non copia le credenziali."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => void act("codex:refresh", undefined)}>
            Verifica collegamento
          </Button>
          {account?.kind === "signedOut" ? (
            <Button size="sm" onClick={() => void act("codex:login", undefined)}>
              Accedi con ChatGPT
            </Button>
          ) : null}
        </>
      }
    >
      <div className="mt-2 flex items-start gap-3 rounded-xl border border-[color:var(--color-border)] p-3">
        <span
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full",
            account?.kind === "chatgpt" ? "bg-success" : account === null || codex.checking ? "bg-muted-foreground/40" : "bg-warning",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-ui text-foreground">
            Codex di OpenAI {codex.checking ? <Spinner /> : null}
          </div>
          <p className="mt-0.5 text-ui-sm text-muted-foreground">{status}</p>
          {account?.kind === "chatgpt" ? (
            <p className="mt-1 text-ui-xs text-muted-foreground/70">{codex.models.length} modelli disponibili.</p>
          ) : null}
        </div>
      </div>
      <p className="mt-3 text-ui-xs text-muted-foreground">
        Per GitHub, Trama usa GitHub CLI: esegui <code className="font-mono">gh auth login</code> nel terminale.
      </p>
      <h4 className="mt-4 mb-1 text-ui-sm font-medium text-muted-foreground">Provider</h4>
      <div className="divide-y divide-[color:var(--app-surface-divider)]">
        {PROVIDERS.map((provider) => (
          <ProviderRow key={provider.id} provider={provider} />
        ))}
      </div>
    </Dialog>
  );
}

function CreateProjectDialog() {
  const open = useUi((s) => s.dialog === "createProject");
  const setDialog = useUi((s) => s.setDialog);
  const [name, setName] = useState("");
  const [idea, setIdea] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => setDialog(value ? "createProject" : null)}
      title="Crea un progetto"
      description="Trama crea la cartella con un README che descrive l'idea."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => setDialog(null)}>
            Annulla
          </Button>
          <Button
            size="sm"
            disabled={!name.trim()}
            onClick={() =>
              void act("project:create", { name, idea }).then(() => {
                setName("");
                setIdea("");
                setDialog(null);
              })
            }
          >
            Scegli la cartella
          </Button>
        </>
      }
    >
      <div className="space-y-3 pt-2">
        <div>
          <Label>Nome del progetto</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <Label>Cosa vuoi costruire?</Label>
          <TextArea value={idea} onChange={(e) => setIdea(e.target.value)} />
        </div>
      </div>
    </Dialog>
  );
}

export function Dialogs() {
  return (
    <>
      <SettingsDialog />
      <ConnectionsDialog />
      <CreateProjectDialog />
    </>
  );
}
