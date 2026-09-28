import { Fragment, type ReactNode, createElement, useEffect } from "react";
import { DEFAULT_LANGUAGE, type Language, type Translate, translator } from "@shared/i18n";
import { useUi } from "@/lib/store";

/** The language Trama speaks now: the person's choice, else the system's, as the main process resolved it. */
export const currentLanguage = (): Language => useUi.getState().app?.language ?? DEFAULT_LANGUAGE;

export function useLanguage(): Language {
  return useUi((s) => s.app?.language ?? DEFAULT_LANGUAGE);
}

/** The translate function of the current language; a component that uses it re-renders when the language changes. */
export function useT(): Translate {
  return translator(useLanguage());
}

/**
 * A translated text with React nodes in place of its remaining placeholders, such as a command in `<code>`:
 * `withNodes(t("key"), { command: <code>gh auth login</code> })`.
 */
export function withNodes(text: string, nodes: Record<string, ReactNode>): ReactNode {
  const parts = text.split(/\{(\w+)\}/g);
  return parts.map((part, index) => createElement(Fragment, { key: index }, index % 2 === 1 ? (part in nodes ? nodes[part] : `{${part}}`) : part));
}

/** Keeps `<html lang>` on the current language, for screen readers and the browser's own texts. */
export function useDocumentLanguage(): void {
  const language = useLanguage();
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
}
