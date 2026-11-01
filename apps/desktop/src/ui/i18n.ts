import { useSyncExternalStore } from "react";
import { readPreference, writePreference } from "./preferences";

/*
 * Two languages, written side by side where the text is used: `t("Bonjour", "Hello")`. Keeping both
 * at the call site means a string can't be added in one language and forgotten in the other.
 */
export type Lang = "fr" | "en";

const isLang = (value: unknown): value is Lang => value === "fr" || value === "en";

function systemLang(): Lang {
  const language = typeof navigator !== "undefined" ? navigator.language : "en";
  return language?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

let lang: Lang = readPreference<Lang | null>("language", null, (value): value is Lang | null => value === null || isLang(value)) ?? systemLang();
const listeners = new Set<() => void>();

export function t(fr: string, en: string) {
  return lang === "fr" ? fr : en;
}

export function currentLang(): Lang {
  return lang;
}

/** Locale for numbers and dates. */
export function locale() {
  return lang === "fr" ? "fr-FR" : "en-US";
}

export function setLang(next: Lang | null) {
  writePreference("language", next);
  lang = next ?? systemLang();
  listeners.forEach((listener) => listener());
}

/** Re-renders the calling component (the app root) when the language changes. */
export function useLang(): Lang {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => lang);
}
