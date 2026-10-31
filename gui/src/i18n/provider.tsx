import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { DICTS, I18nContext, interpolate, setActiveLocale, type Locale, type TFn, type TKey, type Vars } from "./shared";
import { useI18n } from "./shared";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale] = useState<Locale>("en");
  const setLocale = useCallback((_next: Locale) => setActiveLocale("en"), []);

  useEffect(() => {
    document.documentElement.lang = "en";
    try { localStorage.removeItem("ocx-lang"); } catch { /* ignore */ }
  }, []);

  const t: TFn = useCallback((key, vars) => interpolate(DICTS.en[key] ?? key, vars), []);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function Trans({ k, cmd, vars }: { k: TKey; cmd: string; vars?: Vars }) {
  const { t } = useI18n();
  const [pre, post = ""] = t(k, vars).split("{cmd}");
  return <>{pre}<code className="chip">{cmd}</code>{post}</>;
}
