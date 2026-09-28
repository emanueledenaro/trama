import * as i18n from "@shared/i18n";
import { currentLanguage } from "@/lib/i18n";

/** Short relative time: now, 5m, 3h, 2d, 1w, 4mo, 1y, in the current language. */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  return i18n.formatRelativeTime(currentLanguage(), iso, now);
}

export function formatTime(iso: string): string {
  return i18n.formatTime(currentLanguage(), iso);
}

export function formatDate(iso: string): string {
  return i18n.formatDate(currentLanguage(), iso);
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
