import { useState } from "react";
import { activeRules, CLEAN_CODE_RULES, CLEAN_CODE_SOURCE, CLEAN_CODE_VERSION, cleanCodeRules } from "@shared/cleanCode";
import { RuleLabel } from "@/components/chat/RuleLabel";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { Badge, TextArea } from "@/components/ui/field";
import { useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";
import { DisclosureChevron } from "@/components/chat/WorkSteps";
import { DisclosureSection, InspectorSection } from "./Inspector";

/**
 * Trama's Clean Code standard for the open project (Q03, ADR 0016), in Regole since issue #334: each rule on or off,
 * and the person's note on how it applies here. Settings keeps a way here.
 */
export function StandardView() {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const settings = project.document.cleanCode;
  const [note, setNote] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  // A rule opens to show what it says (issue #334: a compact list, the detail on request).
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const toggleRule = (id: string) => setOpened((current) => new Set(current.has(id) ? [...current].filter((r) => r !== id) : [...current, id]));
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
        <ul className="-mx-2 flex flex-col">
          {cleanCodeRules(t).map((rule) => (
            <li key={rule.id} className="rounded-md px-2" data-testid="standard-rule" data-open={opened.has(rule.id) ? "true" : "false"}>
              <div className="flex min-h-8 items-center gap-3">
                <button
                  type="button"
                  aria-expanded={opened.has(rule.id)}
                  title={rule.summary}
                  className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md text-left text-ui text-foreground transition-colors hover:text-foreground/80"
                  onClick={() => toggleRule(rule.id)}
                >
                  <DisclosureChevron open={opened.has(rule.id)} />
                  <span className="min-w-0 truncate">
                    <RuleLabel rule={rule} />
                  </span>
                  {rule.severity === "blocking" ? <Badge tone="warning">{t("settings.standard.blocking")}</Badge> : null}
                </button>
                <Toggle checked={on.has(rule.id)} label={rule.label} onChange={(enabled) => void act("project:cleanCode", { rule: rule.id, enabled })} />
              </div>
              {opened.has(rule.id) ? <p className="pb-2 pl-6 text-ui-xs text-muted-foreground">{rule.summary}</p> : null}
            </li>
          ))}
        </ul>
      </InspectorSection>
      <DisclosureSection title={t("rules.standard.about")} open={aboutOpen} onToggle={() => setAboutOpen(!aboutOpen)} testId="standard-about">
        <p className="text-ui-xs text-muted-foreground">{t("settings.standard.description", { version: CLEAN_CODE_VERSION })}</p>
        <p className="mt-2 text-ui-xs text-muted-foreground">{t("settings.standard.note", { source: CLEAN_CODE_SOURCE })}</p>
      </DisclosureSection>
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
