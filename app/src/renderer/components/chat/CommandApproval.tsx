import { IconLockOpen } from "@/components/icons";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";
import { CardFrame, Field } from "./Cards";

/**
 * The item of "Aspetta te" for a command of the Operator that cannot be undone (ADR 0020, issue #409): what it would
 * do and why Trama asks. With the person's yes Trama runs it itself; with a no it never runs.
 */
export function CommandApprovalCard({ approvalId }: { approvalId: string }) {
  const t = useT();
  const approval = useUi((s) => s.app?.project?.document.commandApprovals?.find((a) => a.id === approvalId) ?? null);
  const [busy, setBusy] = useState(false);
  if (!approval) return null;
  const answer = (channel: "commandApproval:confirm" | "commandApproval:decline") => {
    setBusy(true);
    void act(channel, { id: approval.id }).finally(() => setBusy(false));
  };
  return (
    <CardFrame icon={<IconLockOpen stroke={1.8} />} title={t("commandApproval.card.title")}>
      <div data-testid="command-approval-card" data-reason={approval.reason}>
        <p className="text-ui text-foreground/90">{t("commandApproval.card.intro", { agent: approval.agent })}</p>
        <Field label={t("commandApproval.card.command")}>
          <code className="block font-mono text-ui-sm break-all whitespace-pre-wrap text-foreground/90">{approval.command}</code>
        </Field>
        <Field label={t("commandApproval.card.folder")}>
          <code className="block font-mono text-ui-sm break-all text-foreground/90">{approval.cwd}</code>
        </Field>
        <Field label={t("commandApproval.card.why")}>{t(`commandApproval.why.${approval.reason}`)}</Field>
        <p className="mt-2 text-ui-sm text-muted-foreground">{t("commandApproval.card.hint")}</p>
        <div className="cta-row mt-3">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => answer("commandApproval:decline")}>
            {t("commandApproval.card.decline")}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => answer("commandApproval:confirm")}>
            {t("commandApproval.card.confirm")}
          </Button>
        </div>
      </div>
    </CardFrame>
  );
}
