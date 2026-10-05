import { IconWorld } from "@/components/icons";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";
import { CardFrame, Field } from "./Cards";

/**
 * The item of "Aspetta te" for a site the Operator wants to open in the person's Chrome without a consent (ADR 0020,
 * issue #410). With the yes the consent is recorded for this project; with the no nothing is.
 */
export function SiteConsentCard({ requestId }: { requestId: string }) {
  const t = useT();
  const request = useUi((s) => s.app?.project?.document.siteConsentRequests?.find((r) => r.id === requestId) ?? null);
  const [busy, setBusy] = useState(false);
  if (!request) return null;
  const answer = (channel: "siteConsent:confirm" | "siteConsent:decline") => {
    setBusy(true);
    void act(channel, { id: request.id }).finally(() => setBusy(false));
  };
  return (
    <CardFrame icon={<IconWorld stroke={1.8} />} title={t("siteConsent.card.title")}>
      <div data-testid="site-consent-card" data-site={request.host}>
        <p className="text-ui text-foreground/90">{t("siteConsent.card.intro", { agent: request.agent, site: request.host })}</p>
        <Field label={t("siteConsent.card.site")}>
          <code className="block font-mono text-ui-sm break-all text-foreground/90">{request.address}</code>
        </Field>
        <p className="mt-2 text-ui-sm text-muted-foreground">{t("siteConsent.card.hint")}</p>
        <div className="cta-row mt-3">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => answer("siteConsent:decline")}>
            {t("siteConsent.card.decline")}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => answer("siteConsent:confirm")}>
            {t("siteConsent.card.confirm", { site: request.host })}
          </Button>
        </div>
      </div>
    </CardFrame>
  );
}
