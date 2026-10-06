import { IconDeviceDesktop, IconWorld } from "@/components/icons";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";
import { CardFrame, Field } from "./Cards";

interface ConsentCardProps {
  icon: ReactNode;
  title: string;
  intro: string;
  /** What the consent is about, when the card shows it apart (the address of a site). */
  detail?: { label: string; value: string };
  hint: string;
  confirm: string;
  decline: string;
  testId: string;
  subject: string;
  onAnswer: (answer: "confirm" | "decline") => Promise<unknown>;
}

/** The card of a request for a consent: the same for a site and for an app, with the yes of the person on the right. */
function ConsentCard({ icon, title, intro, detail, hint, confirm, decline, testId, subject, onAnswer }: ConsentCardProps) {
  const [busy, setBusy] = useState(false);
  const answer = (value: "confirm" | "decline") => {
    setBusy(true);
    void onAnswer(value).finally(() => setBusy(false));
  };
  return (
    <CardFrame icon={icon} title={title}>
      <div data-testid={testId} data-subject={subject}>
        <p className="text-ui text-foreground/90">{intro}</p>
        {detail ? (
          <Field label={detail.label}>
            <code className="block font-mono text-ui-sm break-all text-foreground/90">{detail.value}</code>
          </Field>
        ) : null}
        <p className="mt-2 text-ui-sm text-muted-foreground">{hint}</p>
        <div className="cta-row mt-3">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => answer("decline")}>
            {decline}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => answer("confirm")}>
            {confirm}
          </Button>
        </div>
      </div>
    </CardFrame>
  );
}

/**
 * The item of "Aspetta te" for a site the Operator wants to open in the person's Chrome without a consent (ADR 0020,
 * issue #410). With the yes the consent is recorded for this project; with the no nothing is.
 */
export function SiteConsentCard({ requestId }: { requestId: string }) {
  const t = useT();
  const request = useUi((s) => s.app?.project?.document.siteConsentRequests?.find((r) => r.id === requestId) ?? null);
  if (!request) return null;
  return (
    <ConsentCard
      icon={<IconWorld stroke={1.8} />}
      title={t("siteConsent.card.title")}
      intro={t("siteConsent.card.intro", { agent: request.agent, site: request.host })}
      detail={{ label: t("siteConsent.card.site"), value: request.address }}
      hint={t("siteConsent.card.hint")}
      confirm={t("siteConsent.card.confirm", { site: request.host })}
      decline={t("siteConsent.card.decline")}
      testId="site-consent-card"
      subject={request.host}
      onAnswer={(answer) => act(answer === "confirm" ? "siteConsent:confirm" : "siteConsent:decline", { id: request.id })}
    />
  );
}

/** The same for an app the Operator wants to use on the screen, with the mouse and the keyboard (issue #412). */
export function AppConsentCard({ requestId }: { requestId: string }) {
  const t = useT();
  const request = useUi((s) => s.app?.project?.document.appConsentRequests?.find((r) => r.id === requestId) ?? null);
  if (!request) return null;
  return (
    <ConsentCard
      icon={<IconDeviceDesktop stroke={1.8} />}
      title={t("appConsent.card.title")}
      intro={t("appConsent.card.intro", { agent: request.agent, app: request.app })}
      hint={t("appConsent.card.hint")}
      confirm={t("appConsent.card.confirm", { app: request.app })}
      decline={t("appConsent.card.decline")}
      testId="app-consent-card"
      subject={request.app}
      onAnswer={(answer) => act(answer === "confirm" ? "appConsent:confirm" : "appConsent:decline", { id: request.id })}
    />
  );
}
