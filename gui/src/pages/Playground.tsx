import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n/shared";
import { confirmAction, requestTextValue } from "../action-dialogs";
import { Notice } from "../ui";
import { PlaygroundCustomModel, PlaygroundSettings } from "./playground-panels";
import { PlaygroundMessageContent } from "./playground-message-content";
import { loadPlaygroundModels, sendPlaygroundMessage } from "./playground-transport";
import { DEFAULT_SETTINGS, type Conversation, type Message, type PlaygroundModel } from "./playground-types";
import "./playground.css";

function newConversation(): Conversation {
  return { id: crypto.randomUUID(), title: "", messages: [], settings: { ...DEFAULT_SETTINGS }, modelId: "", updatedAt: Date.now() };
}

/** Histories stay in memory: prompts and responses are not written to browser storage. */
export default function Playground({ apiBase }: { apiBase: string }) {
  const t = useT();
  const [conversations, setConversations] = useState<Conversation[]>(() => [newConversation()]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<PlaygroundModel[]>([]);
  const [customModels, setCustomModels] = useState<PlaygroundModel[]>([]);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [modelQuery, setModelQuery] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyActions, setHistoryActions] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [catalogError, setCatalogError] = useState(false);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const workspace = useRef<HTMLElement>(null);
  const flight = useRef<AbortController | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const followOutput = useRef(true);
  const picker = useRef<HTMLDivElement>(null);
  const pickerTrigger = useRef<HTMLButtonElement>(null);
  const historyTrigger = useRef<HTMLButtonElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const active = conversations.find(chat => chat.id === activeId) ?? conversations[0]!;
  const models = useMemo(() => [...customModels, ...catalog.filter(model => !customModels.some(row => row.id === model.id))], [catalog, customModels]);
  const draft = drafts[active.id] ?? "";
  const setDraft = (value: string) => setDrafts(rows => ({ ...rows, [active.id]: value }));
  const selected = active.modelId ? models.find(model => model.id === active.modelId) : models[0];
  const latest = [...active.messages].reverse().find(message => message.role === "assistant");

  useEffect(() => {
    const controller = new AbortController();
    void loadPlaygroundModels(apiBase, controller.signal).then(rows => { setCatalog(rows); setCatalogError(false); })
      .catch(() => { if (!controller.signal.aborted) setCatalogError(true); });
    void fetch(`${apiBase}/api/providers`, { signal: controller.signal }).then(async response => {
      if (!response.ok) return;
      const rows: unknown = await response.json();
      if (Array.isArray(rows)) setConfiguredProviders(rows.flatMap(row => row && typeof row === "object" && typeof row.name === "string" && row.disabled !== true ? [row.name] : []));
    }).catch(() => {});
    return () => { controller.abort(); flight.current?.abort(); };
  }, [apiBase, catalogRevision]);
  useEffect(() => { if (followOutput.current) transcript.current?.scrollTo({ top: transcript.current.scrollHeight }); }, [active.messages]);

  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === workspace.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  useEffect(() => {
    if (!pickerOpen) return;
    const dismiss = (event: PointerEvent) => { if (!picker.current?.contains(event.target as Node)) setPickerOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setPickerOpen(false); pickerTrigger.current?.focus(); } };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [pickerOpen]);
  useEffect(() => {
    if (!historyOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setHistoryOpen(false); historyTrigger.current?.focus(); } };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [historyOpen]);

  const updateChat = (id: string, change: (chat: Conversation) => Conversation) => {
    setConversations(rows => rows.map(chat => chat.id === id ? change(chat) : chat));
  };
  const chooseModel = (model: PlaygroundModel) => {
    updateChat(active.id, chat => ({ ...chat, modelId: model.id }));
    setRecent(rows => [model.id, ...rows.filter(id => id !== model.id)].slice(0, 8));
    setPickerOpen(false);
    pickerTrigger.current?.focus();
  };
  const createChat = () => {
    const chat = newConversation();
    chat.modelId = selected?.id ?? "";
    setConversations(rows => [chat, ...rows]); setActiveId(chat.id); followOutput.current = true; setHistoryOpen(false);
  };
  const send = useCallback(async (history: Message[], text?: string, target: Conversation = active) => {
    if (flight.current || !selected || (text !== undefined && !text.trim())) return;
    const controller = new AbortController(); flight.current = controller; setBusy(true); setFeedback(""); followOutput.current = true;
    const messages = text === undefined ? history : [...history, {
      id: crypto.randomUUID(), role: "user" as const, content: text.trim(), createdAt: Date.now(), status: "finished" as const,
    }];
    const assistant: Message = { id: crypto.randomUUID(), role: "assistant", content: "", createdAt: Date.now(), model: selected.model, provider: selected.provider, status: "pending" };
    const started = performance.now();
    updateChat(target.id, chat => ({ ...chat, messages: [...messages, assistant], title: chat.title || text?.trim().slice(0, 60) || "", updatedAt: Date.now(), modelId: selected.id }));
    if (text !== undefined && target.id === active.id && text === draft) setDrafts(rows => ({ ...rows, [target.id]: "" }));
    const patch = (change: Partial<Message>) => updateChat(target.id, chat => ({ ...chat, messages: chat.messages.map(message => message.id === assistant.id ? { ...message, ...change } : message) }));
    try {
      await sendPlaygroundMessage(apiBase, selected, messages.filter(message => message.status === "finished"), target.settings, controller.signal, patch);
      patch({ status: "finished" });
    } catch (error) {
      patch({ status: controller.signal.aborted ? "canceled" : "failed", error: controller.signal.aborted ? undefined : error instanceof Error ? error.message : t("playground.requestFailed") });
    } finally {
      updateChat(target.id, chat => ({ ...chat, messages: chat.messages.map(message => message.id === assistant.id ? { ...message, metadata: { ...message.metadata, durationMs: Math.round(performance.now() - started) } } : message) }));
      if (flight.current === controller) { flight.current = null; setBusy(false); }
    }
  }, [active, apiBase, draft, selected, t]);
  const editMessage = useCallback(async (message: Message, index: number) => {
    const value = await requestTextValue({ message: t("playground.editPrompt"), initialValue: message.content });
    if (!value?.trim()) return;
    const branch = await confirmAction({ message: t("playground.branchPrompt"), confirmLabel: t("playground.branch") });
    if (branch) {
      const chat = { ...active, id: crypto.randomUUID(), messages: active.messages.slice(0, index), updatedAt: Date.now() };
      setConversations(rows => [chat, ...rows]); setActiveId(chat.id);
      await send(chat.messages, value, chat);
    } else if (await confirmAction({ message: t("playground.replacePrompt"), confirmLabel: t("playground.replace"), tone: "danger" })) {
      await send(active.messages.slice(0, index), value);
    }
  }, [active, send, t]);
  const copy = async (content: string) => {
    try { await navigator.clipboard.writeText(content); setFeedback(t("playground.copied")); }
    catch { setFeedback(t("playground.copyFailed")); }
  };
  const filteredModels = models.filter(model => `${model.label} ${model.id}`.toLowerCase().includes(modelQuery.toLowerCase()));
  const groups = [
    { title: t("playground.favorites"), rows: filteredModels.filter(model => favorites.includes(model.id)) },
    { title: t("playground.recent"), rows: recent.flatMap(id => filteredModels.filter(model => model.id === id)) },
    ...[...new Set(filteredModels.map(model => model.provider))].map(provider => ({ title: provider, rows: filteredModels.filter(model => model.provider === provider) })),
  ];

  return (
    <section ref={workspace} className={`playground${historyOpen ? " playground-history-open" : ""}`}  aria-label={t("nav.playground")}>
      {historyOpen && <button className="playground-history-backdrop" aria-label={t("common.close")} onClick={() => { setHistoryOpen(false); historyTrigger.current?.focus(); }} />}
      <aside className="playground-sidebar" aria-label={t("playground.conversations")}>
        <div className="playground-sidebar-heading"><h2>{t("nav.playground")}</h2><button className="btn btn-ghost btn-sm playground-history-close" onClick={() => { setHistoryOpen(false); historyTrigger.current?.focus(); }}>{t("common.close")}</button></div>
        <button className="btn btn-primary" onClick={createChat} disabled={busy}>{t("playground.newChat")}</button>
        <input className="input" value={historyQuery} onChange={event => setHistoryQuery(event.target.value)} aria-label={t("playground.searchConversations")} placeholder={t("playground.searchConversations")} />
        <div className="playground-history-list">
          {conversations.filter(chat => (chat.title || t("playground.newChat")).toLowerCase().includes(historyQuery.toLowerCase())).map(chat => (
            <div className="playground-history-entry" key={chat.id} onKeyDown={event => { if (event.key === "Escape") { setHistoryActions(null); event.currentTarget.querySelector<HTMLButtonElement>(".playground-history-trigger")?.focus(); } }}>
              <div className={`playground-history${chat.id === active.id ? " active" : ""}`}>
              <button className="btn btn-ghost" disabled={busy} aria-current={chat.id === active.id ? "page" : undefined} onClick={() => { setActiveId(chat.id); followOutput.current = true; setHistoryOpen(false); }}>{chat.title || t("playground.newChat")}</button>
              <button type="button" className="playground-history-trigger" aria-label={t("playground.conversationActions")} aria-expanded={historyActions === chat.id} aria-controls={`playground-actions-${chat.id}`} onClick={() => setHistoryActions(value => value === chat.id ? null : chat.id)}>···</button>
              </div>
              {historyActions === chat.id && <div className="playground-history-actions" id={`playground-actions-${chat.id}`}>
                <button className="btn btn-ghost btn-sm" onClick={async () => { setHistoryActions(null); const title = await requestTextValue({ message: t("playground.rename"), initialValue: chat.title, maxLength: 100 }); if (title?.trim()) updateChat(chat.id, row => ({ ...row, title: title.trim() })); }}>{t("playground.rename")}</button>
                <button className="btn btn-danger btn-sm" disabled={busy} onClick={async () => { setHistoryActions(null); if (await confirmAction({ message: t("playground.deleteConfirm"), tone: "danger" })) setConversations(rows => rows.length === 1 ? [newConversation()] : rows.filter(row => row.id !== chat.id)); }}>{t("playground.delete")}</button>
              </div>}
            </div>
          ))}
        </div>
        <a className="btn btn-ghost" href="#providers">{t("playground.connections")}</a>
        <button className="btn btn-ghost" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(value => !value)}>{t("playground.settings")}</button>
        <p className="muted text-caption">{t("playground.memoryOnly")}</p>
      </aside>
      <div className="playground-main">
        <header className="playground-topbar">
          <button ref={historyTrigger} className="btn btn-ghost playground-history-toggle" aria-expanded={historyOpen} onClick={() => setHistoryOpen(value => !value)}>{t("playground.conversations")}</button>
          <div className="playground-model-control" ref={picker}>
            <button ref={pickerTrigger} className="btn btn-ghost playground-model-trigger" title={selected?.id} aria-label={t("playground.chooseModel")} aria-expanded={pickerOpen} onClick={() => setPickerOpen(value => !value)}>{selected?.label ?? t("playground.chooseModel")}</button>
            {pickerOpen && <div className="playground-model-picker" aria-label={t("playground.chooseModel")}>
              <div className="playground-picker-heading"><span className="text-label muted">{t("playground.chooseModel")}</span><button className="btn btn-ghost btn-sm" onClick={() => { setPickerOpen(false); pickerTrigger.current?.focus(); }}>{t("common.close")}</button></div>
              <input className="input" autoFocus value={modelQuery} onChange={event => setModelQuery(event.target.value)} placeholder={t("playground.searchModels")} aria-label={t("playground.searchModels")} />
              {!filteredModels.length && <p className="muted text-label">{t("playground.noModelsFound")}</p>}
              {groups.filter(group => group.rows.length).map(group => <div key={group.title}><h3 className="text-label muted">{group.title}</h3>{group.rows.map(model => <div className="playground-model-option" key={model.id}>
                <button className="btn btn-ghost" aria-pressed={selected?.id === model.id} onClick={() => chooseModel(model)}><span>{model.label}</span><code>{model.id}</code></button>
                <button className="btn btn-ghost btn-sm" aria-label={t("playground.favoriteModel", { model: model.label })} aria-pressed={favorites.includes(model.id)} onClick={() => setFavorites(rows => rows.includes(model.id) ? rows.filter(id => id !== model.id) : [...rows, model.id])}>{favorites.includes(model.id) ? "★" : "☆"}</button>
              </div>)}</div>)}
              <button className="btn btn-ghost" onClick={() => { setCustomOpen(true); setPickerOpen(false); }}>{t("playground.addModel")}</button>
            </div>}
          </div>
          <button className="btn btn-ghost" onClick={() => setCustomOpen(true)}>{t("playground.addModel")}</button>
          {typeof document.documentElement.requestFullscreen === "function" && <button className="btn btn-ghost playground-fullscreen" onClick={async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await workspace.current?.requestFullscreen(); } catch { setFeedback(t("playground.requestFailed")); } }}>{fullscreen ? t("playground.exitFullscreen") : t("playground.fullscreen")}</button>}
          <button className="btn btn-ghost" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(value => !value)}>{t("playground.settings")}</button>
        </header>
        {catalogError && <Notice tone="err">{t("playground.catalogFailed")} <button className="btn btn-ghost btn-sm" onClick={() => setCatalogRevision(value => value + 1)}>{t("common.retry")}</button></Notice>}
        {settingsOpen && <PlaygroundSettings settings={active.settings} onChange={settings => updateChat(active.id, chat => ({ ...chat, settings }))} onClose={() => setSettingsOpen(false)} />}
        <div className="playground-transcript" ref={transcript} onScroll={event => { const node = event.currentTarget; followOutput.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; }} role="log" aria-label={t("playground.messages")} aria-busy={busy}>
          {!active.messages.length && <div className="playground-empty"><h2>{t("playground.emptyTitle")}</h2><p className="muted">{t("playground.startHint")}</p></div>}
          {active.messages.map((message, index) => <article key={message.id} className={`playground-message playground-message-${message.role}`}>
            <header className="text-caption muted">{message.role === "user" ? t("playground.you") : `${message.provider ?? ""} / ${message.model ?? ""}`} · {new Date(message.createdAt).toLocaleTimeString()}</header>
            <div className="playground-message-content"><PlaygroundMessageContent content={message.content || (message.status === "pending" ? t("playground.pending") : "")} /></div>
            <span className="text-caption muted">{t(`playground.state.${message.status}`)}</span>
            {message.error && <Notice tone="err">{message.error}</Notice>}
            <div className="playground-message-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => void copy(message.content)} disabled={!message.content}>{t("playground.copy")}</button>
              {message.role === "user" && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void editMessage(message, index)}>{t("playground.editResend")}</button>}
              {message.role === "assistant" && index === active.messages.length - 1 && <button className="btn btn-ghost btn-sm" disabled={busy || !selected} onClick={() => void send(active.messages.slice(0, index))}>{message.status === "failed" ? t("playground.retry") : t("playground.regenerate")}</button>}
              {message.metadata && <details><summary>{t("playground.metadata")}</summary><pre className="mono">{JSON.stringify(message.metadata, null, 2)}</pre></details>}
            </div>
          </article>)}
        </div>
        <details className="muted text-caption playground-limitations"><summary>{t("playground.about")}</summary><p>{t("playground.limitations")}</p></details>
        <form id="playground-composer-form" className="playground-composer" onSubmit={event => { event.preventDefault(); void send(active.messages, draft); }}>
          <textarea ref={composer} className="input" rows={3} value={draft} onChange={event => setDraft(event.target.value)} placeholder={t("playground.prompt")} aria-label={t("playground.prompt")} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy && draft.trim()) event.currentTarget.form?.requestSubmit(); } }} />
          <div className="playground-toolbar">
            <span className="muted text-caption playground-composer-hint">{t("playground.keyboardHint")}</span>
            <button type="button" className="btn btn-ghost" onClick={() => { setSettingsOpen(true); requestAnimationFrame(() => workspace.current?.querySelector<HTMLTextAreaElement>(".playground-settings textarea")?.focus()); }}>{t("playground.systemPrompt")}</button>
            {busy ? <button type="button" className="btn btn-danger" onClick={() => flight.current?.abort()}>{t("playground.stop")}</button> : <button type="submit" className="btn btn-primary" disabled={!selected || !draft.trim()}>{t("playground.send")}</button>}
          </div>
        </form>
        <footer className="playground-status mono text-caption" role="status">
          <span>{busy ? t("playground.state.streaming") : selected ? t("playground.ready") : t("playground.noModel")}</span>
          <span>{t("playground.inputTokens")}: {latest?.metadata?.inputTokens ?? "—"}</span>
          <span>{t("playground.outputTokens")}: {latest?.metadata?.outputTokens ?? "—"}</span>
          <span>{t("playground.cachedTokens")}: {latest?.metadata?.cachedTokens ?? "—"}</span>
          <span>{t("playground.context")}: {selected?.contextWindow?.toLocaleString() ?? "—"}</span>
          <span>{t("playground.latency")}: {latest?.metadata?.durationMs ?? "—"} ms</span>
          <span>{t("playground.effort")}: {active.settings.reasoningEffort || t("playground.default")}</span>
          {feedback && <span>{feedback}</span>}
        </footer>
      </div>
      {customOpen && <PlaygroundCustomModel providers={[...new Set([...configuredProviders, ...models.map(model => model.provider)])]} onSave={model => { setCustomModels(rows => [...rows.filter(row => row.id !== model.id), model]); chooseModel(model); setCustomOpen(false); }} onClose={() => setCustomOpen(false)} />}
    </section>
  );
}
