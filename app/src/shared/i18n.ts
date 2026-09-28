// Trama's interface languages (issue #301): one catalog per language, one translate function for the renderer
// and the main process, and the formatters for dates, times and numbers.
import { en } from "./messages/en";
import { it, type MessageKey } from "./messages/it";

export type { MessageKey } from "./messages/it";

export type Language = "it" | "en";
export const LANGUAGES: Language[] = ["it", "en"];
/** The language Trama falls back to when the system asks for one it does not have. */
export const DEFAULT_LANGUAGE: Language = "it";

/** Each language names itself, so a person can find their own whatever the current one. */
export const LANGUAGE_NAMES: Record<Language, string> = { it: "Italiano", en: "English" };

export const CATALOGS: Record<Language, Record<MessageKey, string>> = { it, en };

/** The language's name in English, for the instructions Trama gives the agents. */
export const LANGUAGE_NAMES_IN_ENGLISH: Record<Language, string> = { it: "Italian", en: "English" };

const LOCALES: Record<Language, string> = { it: "it-IT", en: "en-US" };

export const isLanguage = (value: unknown): value is Language => LANGUAGES.includes(value as Language);

/** The BCP 47 locale the formatters use for a language. */
export const localeOf = (language: Language): string => LOCALES[language];

/**
 * The interface language for the system's preferred languages, in order: the first one Trama has, else Italian.
 * `en-GB`, `en_US.UTF-8` and `EN` all count as English.
 */
export function languageFromSystem(preferred: readonly (string | null | undefined)[]): Language {
  for (const tag of preferred) {
    const base = tag?.trim().toLowerCase().split(/[-_.@]/)[0];
    if (isLanguage(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}

export type MessageParams = Record<string, string | number>;

/**
 * The text of `key` in `language`, with each `{name}` replaced by its parameter. A number parameter is formatted
 * for the language. A key that has a `.one` variant uses it when `count` is 1.
 */
export function translate(language: Language, key: MessageKey, params?: MessageParams): string {
  const catalog = CATALOGS[language] ?? CATALOGS[DEFAULT_LANGUAGE];
  const singular = params?.count === 1 ? (catalog as Record<string, string>)[`${key}.one`] : undefined;
  const template = singular ?? catalog[key] ?? CATALOGS[DEFAULT_LANGUAGE][key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    return typeof value === "number" ? formatNumber(language, value) : value;
  });
}

export type Translate = (key: MessageKey, params?: MessageParams) => string;

/** A translate function bound to one language. */
export const translator = (language: Language | null | undefined): Translate => {
  const resolved = isLanguage(language) ? language : DEFAULT_LANGUAGE;
  return (key, params) => translate(resolved, key, params);
};

/** The placeholders a template uses, sorted: the catalogs must agree on them. */
export const placeholders = (template: string): string[] => [...new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))].sort();

// MARK: Formatters

export function formatNumber(language: Language, value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(localeOf(language), options).format(value);
}

/** Hours and minutes, as the language writes them. */
export function formatTime(language: Language, iso: string): string {
  return new Date(iso).toLocaleTimeString(localeOf(language), { hour: "2-digit", minute: "2-digit" });
}

/** Day, short month and time. */
export function formatDate(language: Language, iso: string): string {
  return new Date(iso).toLocaleString(localeOf(language), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Full date and time, for a moment farther away such as when a provider unlocks. */
export function formatDateTime(language: Language, iso: string): string {
  return new Date(iso).toLocaleString(localeOf(language));
}

/** Short relative time: now, 5m, 3h, 2d, 1w, 4mo, 1y, with the units of the language. */
export function formatRelativeTime(language: Language, iso: string, now = Date.now()): string {
  const t = translator(language);
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (seconds < 60) return t("time.now");
  const minutes = seconds / 60;
  if (minutes < 60) return t("time.minutes", { count: Math.floor(minutes) });
  const hours = minutes / 60;
  if (hours < 24) return t("time.hours", { count: Math.floor(hours) });
  const days = hours / 24;
  if (days < 7) return t("time.days", { count: Math.floor(days) });
  if (days < 30) return t("time.weeks", { count: Math.floor(days / 7) });
  if (days < 365) return t("time.months", { count: Math.floor(days / 30) });
  return t("time.years", { count: Math.floor(days / 365) });
}

/** How long ago, as a phrase: "5m fa", "5m ago"; "ora" and "now" stay as they are. */
export function formatAgo(language: Language, iso: string, now = Date.now()): string {
  const relative = formatRelativeTime(language, iso, now);
  return relative === translate(language, "time.now") ? relative : translate(language, "time.ago", { time: relative });
}
