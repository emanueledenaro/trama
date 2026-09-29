import { IconLockOpen } from "@tabler/icons-react";
import { useState } from "react";
import type { RequestedAction } from "@shared/domain";
import type { MessageKey } from "@shared/i18n";
import { requestedActionLine, requestedActionStatus } from "@shared/requestedActions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { useLanguage, useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";
import { CardFrame, Field } from "./Cards";
import { DisclosureChevron } from "./WorkSteps";

/**
 * An action a fixed ban stops, done or asked for because the person wrote it in the composer (issue #422). In the chat it
 * is one line that quotes the person's words ("Faccio un force push perché me l'hai chiesto: «…»") with its outcome, and
 * opens on the command and its result. One that waits for the confirmation is an item of "Aspetta te" with the card below.
 */

const TONES: Record<RequestedAction["status"], "secondary" | "info" | "success" | "warning" | "destructive"> = {
  waiting: "warning",
  running: "info",
  done: "success",
  failed: "destructive",
  declined: "secondary",
};

const WHY: Partial<Record<RequestedAction["ban"], MessageKey>> = {
  forcePush: "requestedAction.why.forcePush",
  deleteRemoteRef: "requestedAction.why.deleteRemoteRef",
  secrets: "requestedAction.why.secrets",
};

const useAction = (id: string | null) => useUi((s) => (id ? (s.app?.project?.document.requestedActions?.find((a) => a.id === id) ?? null) : null));

/** The chat line of the action; open, the command, the result and how the person confirmed it. */
export function RequestedActionLine({ actionId }: { actionId: string | null }) {
  const t = useT();
  const language = useLanguage();
  const action = useAction(actionId);
  const [open, setOpen] = useState(false);
  if (!action) return null;
  return (
    <div className="my-2" data-testid="requested-action" data-status={action.status} data-open={open || undefined}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left text-ui transition-colors hover:bg-[var(--color-background-button-secondary-hover)]"
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-3.5">
          <IconLockOpen stroke={1.8} />
        </span>
        <span className="min-w-0 flex-1 truncate text-foreground" data-testid="requested-action-line">
          {requestedActionLine(action, language)}
        </span>
        <Badge tone={TONES[action.status]}>{requestedActionStatus(action, language)}</Badge>
        <DisclosureChevron open={open} />
      </button>
      {open ? (
        <div className="mt-1 rounded-xl bg-[var(--color-background-button-secondary)] px-3.5 py-2.5" data-testid="requested-action-detail">
          <ActionFields action={action} />
          {action.confirmation?.confirmedAt ? (
            <p className="mt-2 text-ui-sm text-muted-foreground">
              {action.confirmation.by === "message" && action.confirmation.message
                ? t("requestedAction.card.confirmedBy.message", { quote: action.confirmation.message.quote })
                : t("requestedAction.card.confirmedBy.button")}
            </p>
          ) : null}
          {action.output ? (
            <Field label={t("requestedAction.card.output")}>
              <pre className="max-h-48 overflow-auto font-mono text-ui-sm break-all whitespace-pre-wrap text-foreground/90">{action.output}</pre>
            </Field>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ActionFields({ action }: { action: RequestedAction }) {
  const t = useT();
  return (
    <>
      <Field label={t("requestedAction.card.what")}>{action.summary}</Field>
      <Field label={t("requestedAction.card.command")}>
        <code className="block font-mono text-ui-sm break-all whitespace-pre-wrap text-foreground/90">{action.command}</code>
      </Field>
      <Field label={t("requestedAction.card.request")}>«{action.request.quote}»</Field>
    </>
  );
}

/** The item of "Aspetta te" for an action that deletes something or cannot be undone: what happens, why Trama asks. */
export function RequestedActionCard({ actionId }: { actionId: string }) {
  const t = useT();
  const language = useLanguage();
  const action = useAction(actionId);
  const [busy, setBusy] = useState(false);
  if (!action) return null;
  const why = WHY[action.ban];
  const answer = (channel: "requestedAction:confirm" | "requestedAction:decline") => {
    setBusy(true);
    void act(channel, { id: action.id }).finally(() => setBusy(false));
  };
  return (
    <CardFrame
      icon={<IconLockOpen stroke={1.8} />}
      title={t("requestedAction.card.title")}
      aside={<Badge tone={TONES[action.status]}>{requestedActionStatus(action, language)}</Badge>}
    >
      <div data-testid="requested-action-card">
        <p className="text-ui text-foreground/90">{t("requestedAction.card.intro")}</p>
        <ActionFields action={action} />
        {why ? <Field label={t("requestedAction.card.why")}>{t(why)}</Field> : null}
        {action.status === "waiting" ? (
          <>
            <p className="mt-2 text-ui-sm text-muted-foreground">{t("requestedAction.card.hint")}</p>
            <div className="cta-row mt-3">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => answer("requestedAction:decline")}>
                {t("requestedAction.card.decline")}
              </Button>
              <Button size="sm" disabled={busy} onClick={() => answer("requestedAction:confirm")}>
                {t("requestedAction.card.confirm")}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </CardFrame>
  );
}
