import { useCallback, useEffect, useRef, useState } from "react";
import { useT, type TKey } from "../i18n/shared";
import { Switch } from "../ui";
import { createBoundedFetch } from "../bounded-fetch";
import { requireJson } from "./dashboard-shared";

type Category = "git" | "build" | "test" | "package" | "docker" | "system";
type Intensity = "minimal" | "standard" | "aggressive";
type Options = { caveman?: boolean; ponytail?: boolean; adhd?: boolean; cavemanLevel?: "lite" | "full" | "ultra" | "wenyan-lite" | "wenyan" | "wenyan-ultra"; cavemanLanguage?: "en" | "id"; cavemanAutoClarity?: boolean; cavemanInputMode?: boolean; cavemanPreserveKeywords?: string; ponytailLevel?: "lite" | "full" | "ultra"; adhdLevel?: "lite" | "full"; filters?: Record<string, boolean>; mode?: "simple" | "advance"; intensity: Intensity; maxLines: number; maxChars: number; deduplicate: boolean; categories?: Partial<Record<Category, boolean>> };
type Settings = { metrics?: { changed: number; savedBytes: number }; enabled: boolean; options: Options; filters: Array<{ id: string; label: string; description: string; category: Category; enabled: boolean }> };
type Preview = { text: string; originalBytes: number; compressedBytes: number; originalTokens?: number; compressedTokens?: number; savedPct?: number; techniquesUsed?: string[] };
const levelKeys = { caveman: "cavemanLevel", ponytail: "ponytailLevel", adhd: "adhdLevel" } as const;
const languageLabels = { en: "English", id: "Bahasa Indonesia" };
const categories: Category[] = ["git", "build", "test", "package", "docker", "system"];

function parseSettings(value: unknown): Settings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid settings");
  const settings = value as Settings, options = settings.options;
  if (typeof settings.enabled !== "boolean" || !options || !["minimal", "standard", "aggressive"].includes(options.intensity)
    || !Number.isInteger(options.maxLines) || options.maxLines < 20 || options.maxLines > 500
    || !Number.isInteger(options.maxChars) || options.maxChars < 1000 || options.maxChars > 10485760
    || typeof options.deduplicate !== "boolean" || !Array.isArray(settings.filters)
    || settings.filters.some(filter => !filter || typeof filter.id !== "string" || typeof filter.label !== "string" || typeof filter.description !== "string" || !categories.includes(filter.category) || typeof filter.enabled !== "boolean")) throw new Error("Invalid settings");
  return settings;
}

export default function TokenSaver({ apiBase }: { apiBase: string }) {
  return <TokenSaverControls key={apiBase} apiBase={apiBase} />;
}

function TokenSaverControls({ apiBase }: { apiBase: string }) {
  const t = useT();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<"load" | "failed" | "saved" | "preview" | null>(null);
  const [command, setCommand] = useState("git status");
  const [input, setInput] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewMode, setPreviewMode] = useState<"rtk" | "prompt" | "input">("rtk");
  const pending = useRef<ReturnType<typeof createBoundedFetch> | null>(null);
  const active = useRef(false);
  const load = useCallback(async () => {
    if (pending.current) return;
    const request = createBoundedFetch(15_000);
    pending.current = request; setFeedback(null);
    try {
      const result = parseSettings(await requireJson(await fetch(`${apiBase}/api/tool-result-compression`, { signal: request.signal })));
      if (active.current && pending.current === request && !request.signal.aborted) setSettings(result);
    } catch { if (active.current && pending.current === request) setFeedback("load"); }
    finally { request.clear(); if (pending.current === request) pending.current = null; }
  }, [apiBase]);
  useEffect(() => {
    active.current = true;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => { window.clearTimeout(timer); active.current = false; pending.current?.controller.abort(); pending.current?.clear(); pending.current = null; };
  }, [load]);
  const save = async (patch: Partial<Settings>) => {
    if (pending.current || !settings) return;
    const request = createBoundedFetch(15_000);
    pending.current = request; setBusy(true); setFeedback(null);
    try {
      const response = await fetch(`${apiBase}/api/tool-result-compression`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch), signal: request.signal });
      const result = parseSettings(await requireJson(response));
      if (active.current && pending.current === request && !request.signal.aborted) { setSettings(result); setFeedback("saved"); }
    } catch { if (active.current && pending.current === request) setFeedback("failed"); }
    finally { request.clear(); if (active.current) setBusy(false); if (pending.current === request) pending.current = null; }
  };
  const test = async () => {
    if (pending.current || !settings) return;
    const request = createBoundedFetch(15_000);
    pending.current = request; setBusy(true); setFeedback(null);
    try {
      const response = await fetch(`${apiBase}/api/tool-result-compression/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: input, command, mode: previewMode, options: settings.options }), signal: request.signal });
      const result = await requireJson(response) as Preview;
      if (typeof result.text !== "string" || typeof result.originalBytes !== "number" || typeof result.compressedBytes !== "number") throw new Error("Invalid preview");
      if (active.current && pending.current === request && !request.signal.aborted) setPreview(result);
    } catch { if (active.current && pending.current === request) setFeedback("preview"); }
    finally { request.clear(); if (active.current) setBusy(false); if (pending.current === request) pending.current = null; }
  };
  const option = (patch: Partial<Options>) => { if (settings) void save({ options: { ...settings.options, ...patch } }); };
  const disabled = busy || !settings;
  return <div className="stack" style={{ gap: "var(--space-4)" }}>
    <div><h2>{t("tokenSaver.title")}</h2><p className="muted">{t("tokenSaver.subtitle")}</p></div>
    <section className="panel" aria-busy={busy || (!settings && feedback !== "load")}>
      <div className="spread"><div><div className="font-semibold">{t("tokenSaver.rtk")}</div><p className="muted setting-hint">{t("tokenSaver.description")}</p></div>
        <Switch on={settings?.enabled === true} disabled={disabled} label={t("tokenSaver.rtk")} onClick={() => { void save({ enabled: !settings?.enabled }); }} />
      </div>
      <div className="notice notice-warn">{t("tokenSaver.warning")}</div>
      {settings?.metrics && <p className="muted setting-hint">{t("tokenSaver.metrics", { count: String(settings.metrics.changed), bytes: String(settings.metrics.savedBytes) })}</p>}
      <p className="muted setting-hint">{t("tokenSaver.limitations")}</p>
      {settings && <div className="stack" style={{ gap: "var(--space-3)" }}>
        <div className="spread"><h3>{t("tokenSaver.settings")}</h3><button className="btn btn-ghost btn-sm" type="button" onClick={() => setExpanded(value => !value)}>{t(expanded ? "tokenSaver.hideSettings" : "tokenSaver.configure")}</button></div>
        {expanded && <>
        <div className="row" role="group" aria-label={t("tokenSaver.settings")}>
          {(["simple", "advance"] as const).map(mode => <button key={mode} type="button" className={settings.options.mode === mode || mode === "simple" && !settings.options.mode ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"} disabled={disabled} aria-pressed={(settings.options.mode ?? "simple") === mode} onClick={() => option({ mode })}>{t(`tokenSaver.${mode}` as TKey)}</button>)}
        </div>
        <label>{t("tokenSaver.intensity")} <select className="input" value={settings.options.intensity} disabled={disabled} onChange={event => option({ intensity: event.target.value as Intensity })}>
          {(["minimal", "standard", "aggressive"] as const).map(value => <option key={value} value={value}>{t(`tokenSaver.${value}` as TKey)}</option>)}
        </select></label>
        <label>{t("tokenSaver.maxLines")} <input className="input" type="number" min={20} max={500} defaultValue={settings.options.maxLines} disabled={disabled} onBlur={event => { const n = event.currentTarget.valueAsNumber; if (Number.isInteger(n) && n >= 20 && n <= 500) option({ maxLines: n }); }} /></label>
        <label>{t("tokenSaver.maxChars")} <input className="input" type="number" min={1000} max={10485760} defaultValue={settings.options.maxChars} disabled={disabled} onBlur={event => { const n = event.currentTarget.valueAsNumber; if (Number.isInteger(n) && n >= 1000 && n <= 10485760) option({ maxChars: n }); }} /></label>
        <div className="spread"><span>{t("tokenSaver.deduplicate")}</span><Switch on={settings.options.deduplicate} disabled={disabled} label={t("tokenSaver.deduplicate")} onClick={() => option({ deduplicate: !settings.options.deduplicate })} /></div>
        {(settings.options.mode ?? "simple") === "advance" && <>
          <h3>{t("tokenSaver.categories")}</h3>
          {categories.map(cat => <details key={cat} className="panel"><summary>{t(`tokenSaver.${cat}` as TKey)} ({settings.filters.filter(filter => filter.category === cat).length})</summary>
            <div className="spread"><span>{t("tokenSaver.categoryEnabled")}</span><Switch on={settings.options.categories?.[cat] !== false} disabled={disabled} label={t(`tokenSaver.${cat}` as TKey)} onClick={() => option({ categories: { ...settings.options.categories, [cat]: settings.options.categories?.[cat] === false } })} /></div>
            {settings.filters.filter(filter => filter.category === cat).map(filter => <div className="spread" style={{ padding: "var(--space-3) 0" }} key={filter.id}><div><strong>{filter.label}</strong><p className="muted setting-hint">{filter.description}</p></div><Switch on={filter.enabled} disabled={disabled} label={filter.label} onClick={() => option({ filters: { ...settings.options.filters, [filter.id]: !filter.enabled } })} /></div>)}
          </details>)}
        </>}
        </>}
      </div>}
      {feedback === "load" && <div className="notice notice-err" role="alert">{t("tokenSaver.loadFailed")} <button type="button" className="btn btn-ghost btn-sm" onClick={() => { void load(); }}>{t("common.retry")}</button></div>}
      {feedback === "failed" && <div className="notice notice-err" role="alert">{t("tokenSaver.saveFailed")}</div>}
      {feedback === "saved" && <div className="muted setting-hint" role="status">{t("tokenSaver.saved")}</div>}
    </section>
    {settings && (["caveman", "ponytail", "adhd"] as const).map(mode => <section className="panel stack" style={{ gap: "var(--space-3)" }} key={mode}>
      <div className="spread"><div><h3 className="panel-title">{t(`tokenSaver.${mode}` as TKey)}</h3><p className="muted setting-hint">{t(`tokenSaver.${mode}Hint` as TKey)}</p></div><Switch on={settings.options[mode] === true} disabled={disabled} label={t(`tokenSaver.${mode}` as TKey)} onClick={() => option({ [mode]: !settings.options[mode] })} /></div>
      <label>{t("tokenSaver.level")}<select className="input" disabled={disabled} value={settings.options[levelKeys[mode]] ?? "full"} onChange={event => option({ [levelKeys[mode]]: event.target.value })}>{(mode === "adhd" ? ["lite", "full"] : mode === "caveman" ? ["lite", "full", "ultra", "wenyan-lite", "wenyan", "wenyan-ultra"] : ["lite", "full", "ultra"]).map(level => <option key={level} value={level}>{t(`tokenSaver.${level}` as TKey)}</option>)}</select></label>
      {mode === "caveman" && <details><summary>{t("tokenSaver.advanced")}</summary><div className="stack" style={{ gap: "var(--space-3)" }}>
        <label>{t("tokenSaver.language")}<select className="input" disabled={disabled} value={settings.options.cavemanLanguage ?? "en"} onChange={event => option({ cavemanLanguage: event.target.value as "en" | "id" })}>{Object.entries(languageLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <div className="spread"><span>{t("tokenSaver.autoClarity")}</span><Switch on={settings.options.cavemanAutoClarity !== false} disabled={disabled} label={t("tokenSaver.autoClarity")} onClick={() => option({ cavemanAutoClarity: settings.options.cavemanAutoClarity === false })} /></div>
        <div className="spread"><span>{t("tokenSaver.inputMode")}</span><Switch on={settings.options.cavemanInputMode === true} disabled={disabled} label={t("tokenSaver.inputMode")} onClick={() => option({ cavemanInputMode: !settings.options.cavemanInputMode })} /></div>
        <label>{t("tokenSaver.keywords")}<input className="input" disabled={disabled} defaultValue={settings.options.cavemanPreserveKeywords ?? ""} onBlur={event => option({ cavemanPreserveKeywords: event.currentTarget.value })} /></label>
      </div></details>}
    </section>)}
    <section className="panel stack" style={{ gap: "var(--space-3)" }}><h3 className="panel-title">{t("tokenSaver.preview")}</h3>
      <label>{t("tokenSaver.previewMode")}<select className="input" value={previewMode} onChange={event => { setPreviewMode(event.target.value as "rtk" | "prompt" | "input"); setPreview(null); }}>{(["rtk", "prompt", "input"] as const).map(mode => <option key={mode} value={mode}>{t(`tokenSaver.preview_${mode}` as TKey)}</option>)}</select></label>
      <div><label className="field-label" htmlFor="saver-command">{t("tokenSaver.command")}</label><input id="saver-command" className="input" value={command} onChange={event => setCommand(event.target.value)} /></div>
      <div><label className="field-label" htmlFor="saver-input">{t("tokenSaver.input")}</label><textarea id="saver-input" className="input" value={input} onChange={event => setInput(event.target.value)} rows={8} /></div>
      <div><button type="button" className="btn btn-primary" disabled={disabled || (previewMode !== "prompt" && !input)} onClick={() => { void test(); }}>{t("tokenSaver.run")}</button></div>
      {feedback === "preview" && <div className="notice notice-err" role="alert">{t("tokenSaver.previewFailed")}</div>}
      {preview && <div><h4>{t("tokenSaver.result")}</h4><p>{t("tokenSaver.bytes", { before: String(preview.originalBytes), after: String(preview.compressedBytes) })}</p><p className="muted setting-hint">{t("tokenSaver.tokens", { before: String(preview.originalTokens ?? 0), after: String(preview.compressedTokens ?? 0), saved: String(preview.savedPct ?? 0) })}</p><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "30rem", overflow: "auto" }}>{preview.text}</pre></div>}
    </section>
  </div>;
}
