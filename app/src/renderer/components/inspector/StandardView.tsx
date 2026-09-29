import { useState } from "react";
import { activeRules, CLEAN_CODE_RULES, CLEAN_CODE_SOURCE, CLEAN_CODE_VERSION, cleanCodeRules } from "@shared/cleanCode";
import { RuleLabel } from "@/components/chat/RuleLabel";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { Badge, TextArea } from "@/components/ui/field";
import { useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";
import { InspectorSection } from "./Inspector";

/**
 * Trama's Clean Code standard for the open project (Q03, ADR 0016), in Regole since issue #334: each rule on or off,
 * and the person's note on how it applies here. Settings keeps a way here.
 */
export function StandardView() {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const settings = project.document.cleanCode;
  const [note, setNote] = useState<string | null>(null);
  const saved = settings?.note ?? "";
  const draft = note ?? saved;
  const on = new Set(activeRules(settings).map((rule) => rule.id));
  return (
    <div data-testid="clean-code-settings">
      <InspectorSection
        title={t("settings.standard.rulesFor", { name: project.name })}
        aside={
          <span className="shrink-0 text-ui-xs text-muted-foreground" data-testid="standard-summary">
            {t("rules.standard.summary", { on: on.size, total: CLEAN_CODE_RULES.length })}
          </span>
        }
      >
        <p className="text-ui-xs text-muted-foreground">{t("settings.standard.description", { version: CLEAN_CODE_VERSION })}</p>
        <p className="mt-1 text-ui-xs text-muted-foreground">{t("settings.standard.note", { source: CLEAN_CODE_SOURCE })}</p>
        <ul className="-mx-2 mt-2 flex flex-col">
          {cleanCodeRules(t).map((rule) => (
            <li key={rule.id} className="flex items-start gap-3 rounded-md px-2 py-1.5" data-testid="standard-rule">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-ui text-foreground">
                  <RuleLabel rule={rule} />
                  {rule.severity === "blocking" ? <Badge tone="warning">{t("settings.standard.blocking")}</Badge> : null}
                </div>
                <p className="mt-0.5 text-ui-xs text-muted-foreground">{rule.summary}</p>
              </div>
              <span className="mt-0.5">
                <Toggle checked={on.has(rule.id)} label={rule.label} onChange={(enabled) => void act("project:cleanCode", { rule: rule.id, enabled })} />
              </span>
            </li>
          ))}
        </ul>
      </InspectorSection>
      <InspectorSection title={t("settings.standard.adaptation")}>
        <p className="mb-2 text-ui-xs text-muted-foreground">{t("settings.standard.adaptationNote")}</p>
        <TextArea
          aria-label={t("settings.standard.noteLabel")}
          rows={3}
          value={draft}
          placeholder={t("settings.standard.notePlaceholder")}
          onChange={(event) => setNote(event.target.value)}
        />
        <div className="cta-row mt-2">
          <Button size="sm" variant="ghost" disabled={draft === saved} onClick={() => setNote(null)}>
            {t("settings.cancel")}
          </Button>
          <Button size="sm" disabled={draft === saved} onClick={() => void act("project:cleanCode", { note: draft }).then(() => setNote(null))}>
            {t("settings.save")}
          </Button>
        </div>
      </InspectorSection>
    </div>
  );
}
