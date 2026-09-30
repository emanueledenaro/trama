import { LANGUAGE_NAMES, LANGUAGES } from "@shared/i18n";
import { cn } from "@/lib/cn";
import { useLanguage, useT } from "@/lib/i18n";
import { act } from "@/lib/store";

/**
 * The interface language (issue #301), in the welcome and in Settings. Each language is named in itself; the
 * choice holds at once, without a restart, for the window and for the agents' next messages.
 */
export function LanguageChoice() {
  const t = useT();
  const language = useLanguage();
  return (
    <div role="radiogroup" aria-label={t("language.label")} className="flex rounded-lg bg-[var(--color-background-button-secondary)] p-0.5" data-testid="language-choice">
      {LANGUAGES.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          lang={value}
          aria-checked={language === value}
          onClick={() => void act("settings:update", { language: value })}
          className={cn(
            "flex h-8 items-center rounded-md px-3 text-ui-sm transition-colors",
            language === value ? "bg-[var(--color-background-surface)] text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {LANGUAGE_NAMES[value]}
        </button>
      ))}
    </div>
  );
}
