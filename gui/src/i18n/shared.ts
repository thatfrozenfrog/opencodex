import { createContext, useContext } from "react";
import type { Locale, TKey } from "./catalogs";

export { DICTS, LOCALES, localeDisplayName, type Locale, type TKey } from "./catalogs";

let activeLocale: Locale = "en";

/** Dashboard copy is English-only; navigator and stored language preferences are ignored. */
export function getActiveLocale(): Locale {
  return activeLocale;
}

export function setActiveLocale(_locale: Locale): void {
  activeLocale = "en";
}

export type Vars = Record<string, string | number>;
export type TFn = (key: TKey, vars?: Vars) => string;

export interface I18nContextValue { locale: Locale; setLocale: (l: Locale) => void; t: TFn }

export const I18nContext = createContext<I18nContextValue | null>(null);

export function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s;
  let out = s;
  for (const k of Object.keys(vars)) out = out.split(`{${k}}`).join(String(vars[k]));
  return out;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within LanguageProvider");
  return ctx;
}

export function useT(): TFn {
  return useI18n().t;
}
