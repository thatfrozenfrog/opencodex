import { en, type TKey } from "./en";
import { LAB_CATALOG_OVERRIDES } from "./lab-translations";

/** The single supported dashboard catalog. */
export type Locale = "en";
export const DICTS: Record<Locale, Record<TKey, string>> = { en: { ...en, ...LAB_CATALOG_OVERRIDES.en } };
export const LOCALES = [{ code: "en" as const, htmlLang: "en" }];
export function localeDisplayName(_locale: Locale): string { return "English"; }

export function catalogValue(locale: Locale, key: TKey): string {
  return DICTS[locale][key];
}

export type { TKey };
