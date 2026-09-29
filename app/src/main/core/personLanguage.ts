import { DEFAULT_LANGUAGE, type Language, type Translate, translator } from "@shared/i18n";

/**
 * The person's language in the main process (issue #301). The controller sets it whenever the language resolves, at start and on
 * every change in Settings; the core modules read it through `t` for the texts the person sees: errors, Activity rows, notices,
 * status lines and recaps. Text written for the model does not go through here: the agents get the language in their rules.
 */
let current: Language = DEFAULT_LANGUAGE;

export function setPersonLanguage(language: Language): void {
  current = language;
}

export const personLanguage = (): Language => current;

/** The text of a catalog key in the person's language. */
export const t: Translate = (key, params) => translator(current)(key, params);
