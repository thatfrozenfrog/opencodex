import type { ModelRow } from "./models-shared";
import type { GenerationSettings, Message, MessageMetadata, PlaygroundModel } from "./playground-types";

export interface PlaygroundRequest {
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  stream: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  reasoning_effort?: string;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : undefined;
}

export function buildPlaygroundRequest(
  model: PlaygroundModel,
  messages: readonly Message[],
  settings: GenerationSettings,
): PlaygroundRequest {
  if (!model.id.trim()) throw new Error("Invalid model");
  const body: PlaygroundRequest = {
    model: model.id,
    messages: [],
    stream: settings.stream,
  };
  if (settings.systemPrompt.trim()) body.messages.push({ role: "system", content: settings.systemPrompt });
  for (const message of messages) {
    if ((message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string") {
      throw new Error("Invalid message");
    }
    body.messages.push({ role: message.role, content: message.content });
  }
  if (!messages.length) throw new Error("Messages required");
  const numeric = (value: string, name: string, min: number, max: number, integer = false) => {
    if (!value.trim()) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isSafeInteger(parsed))) {
      throw new Error(name);
    }
    return parsed;
  };
  const temperature = numeric(settings.temperature, "temperature", 0, 2);
  const maxTokens = numeric(settings.maxTokens, "max_tokens", 1, 16384, true);
  const topP = numeric(settings.topP, "top_p", 0, 1);
  if (temperature !== undefined) body.temperature = temperature;
  if (maxTokens !== undefined) body.max_tokens = maxTokens;
  if (topP !== undefined) body.top_p = topP;
  if (settings.reasoningEffort.trim()) body.reasoning_effort = settings.reasoningEffort.trim();
  return body;
}

async function requireOk(response: Response): Promise<void> {
  // Do not surface raw server bodies: upstream error pages may contain private data.
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`HTTP ${response.status}`);
  }
}

export async function loadPlaygroundModels(apiBase: string, signal: AbortSignal): Promise<PlaygroundModel[]> {
  // fetch is wrapped by installApiAuthFetch, including session renewal and CSRF.
  const response = await fetch(`${apiBase}/api/models`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
  });
  await requireOk(response);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new Error("Invalid models response");
  return rows.flatMap((value: unknown): PlaygroundModel[] => {
    const raw = record(value);
    if (!raw || typeof raw.id !== "string" || typeof raw.provider !== "string"
      || typeof raw.namespaced !== "string" || !raw.namespaced || raw.disabled === true
      || raw.initialSelectionPending === true) return [];
    const row: Pick<ModelRow, "id" | "provider" | "namespaced" | "displayName" | "contextWindow" | "custom"> = {
      id: raw.id,
      provider: raw.provider,
      namespaced: raw.namespaced,
      displayName: typeof raw.displayName === "string" ? raw.displayName : undefined,
      contextWindow: typeof raw.contextWindow === "number" ? raw.contextWindow : undefined,
      custom: typeof raw.custom === "boolean" ? raw.custom : undefined,
    };
    return [{
      id: row.namespaced,
      provider: row.provider,
      model: row.id,
      label: row.displayName || row.id,
      ...(typeof row.contextWindow === "number" ? { contextWindow: row.contextWindow } : {}),
      ...(typeof row.custom === "boolean" ? { custom: row.custom } : {}),
    }];
  });
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export async function sendPlaygroundMessage(
  apiBase: string,
  model: PlaygroundModel,
  messages: readonly Message[],
  settings: GenerationSettings,
  signal: AbortSignal,
  onUpdate: (update: Partial<Message>) => void,
): Promise<void> {
  const body = buildPlaygroundRequest(model, messages, settings);
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(120000)]);
  deadline.throwIfAborted();
  const started = performance.now();
  let content = "";
  let actualModel = model.model;
  let provider = model.provider;
  const metadata: MessageMetadata = { request: { ...body } };
  const update = (status: Message["status"]) => {
    deadline.throwIfAborted();
    onUpdate({ content, model: actualModel, provider, status,
      metadata: { ...metadata, durationMs: performance.now() - started } });
  };
  const consume = (value: unknown, streaming: boolean) => {
    const data = record(value);
    if (!data || data.error != null) throw new Error("Invalid playground response or upstream error");
    if (data.modelIsRequested !== true && typeof data.model === "string" && data.model) actualModel = data.model;
    if (typeof data.provider === "string" && data.provider) provider = data.provider;
    const usage = record(data.usage);
    if (usage) {
      const input = tokenCount(usage.prompt_tokens ?? usage.input_tokens);
      const output = tokenCount(usage.completion_tokens ?? usage.output_tokens);
      const details = record(usage.prompt_tokens_details ?? usage.input_tokens_details);
      const cached = tokenCount(details?.cached_tokens ?? usage.cache_read_input_tokens ?? usage.cached_tokens);
      if (input !== undefined) metadata.inputTokens = input;
      if (output !== undefined) metadata.outputTokens = output;
      if (cached !== undefined) metadata.cachedTokens = cached;
    }
    if (!Array.isArray(data.choices)) throw new Error("Invalid playground choices");
    const choice = data.choices.map(record).find(item => item && (item.index === 0 || item.index === undefined));
    if (!choice && (!streaming || data.choices.length)) throw new Error("Invalid playground choice");
    if (choice) {
      const message = record(streaming ? choice.delta : choice.message);
      if (!message) throw new Error("Invalid playground message");
      if (message.content != null && typeof message.content !== "string") throw new Error("Invalid playground content");
      if (typeof message.content === "string") content += message.content;
      if (typeof choice.finish_reason === "string") metadata.finishReason = choice.finish_reason;
    }
    // Retain response payload only, never transport headers or credentials.
    metadata.response = Object.fromEntries(
      ["id", "object", "created", "model", "provider", "choices", "usage"]
        .filter(key => data[key] !== undefined).map(key => [key, data[key]]),
    );
    update(streaming ? "streaming" : "finished");
  };
  const response = await fetch(`${apiBase}/api/playground/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: settings.stream ? "text/event-stream" : "application/json" },
    body: JSON.stringify(body),
    signal: deadline,
  });
  await requireOk(response);
  if (!response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
    consume(await response.json(), false);
    return;
  }
  if (!response.body) throw new Error("Missing playground stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let dataLines: string[] = [];
  let eventType = "";
  let done = false;
  const dispatch = () => {
    if (eventType === "error") throw new Error("Playground stream error");
    eventType = "";
    if (!dataLines.length) return;
    const data = dataLines.join("\n");
    dataLines = [];
    if (data.trim() === "[DONE]") { done = true; return; }
    let parsed: unknown;
    try { parsed = JSON.parse(data); }
    catch { throw new Error("Invalid playground stream JSON"); }
    consume(parsed, true);
  };
  const line = (value: string) => {
    if (!value) { dispatch(); return; }
    if (value.startsWith(":")) return;
    const separator = value.indexOf(":");
    const field = separator < 0 ? value : value.slice(0, separator);
    let text = separator < 0 ? "" : value.slice(separator + 1);
    if (text.startsWith(" ")) text = text.slice(1);
    if (field === "data") dataLines.push(text);
    if (field === "event") eventType = text;
  };
  const drain = (eof: boolean) => {
    while (!done) {
      const match = /[\r\n]/.exec(buffer);
      if (!match) break;
      const index = match.index;
      if (buffer[index] === "\r" && index + 1 === buffer.length && !eof) break;
      const width = buffer[index] === "\r" && buffer[index + 1] === "\n" ? 2 : 1;
      const value = buffer.slice(0, index);
      buffer = buffer.slice(index + width);
      line(value);
    }
    if (eof && !done) {
      if (buffer) { line(buffer); buffer = ""; }
      dispatch();
    }
  };
  const cancel = () => { void reader.cancel().catch(() => {}); };
  deadline.addEventListener("abort", cancel, { once: true });
  try {
    deadline.throwIfAborted();
    while (!done) {
      const chunk = await reader.read();
      deadline.throwIfAborted();
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      drain(chunk.done);
      if (chunk.done && !done) throw new Error("Premature playground stream EOF");
    }
    update("finished");
  } finally {
    deadline.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
