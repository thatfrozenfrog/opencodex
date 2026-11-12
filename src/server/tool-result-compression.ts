import { observeToolCompression } from "./tool-saver-metrics";
import { injectSaverInstructions } from "./tool-saver-instructions";
import { structuredOutput } from "./tool-saver-engine";
import { filterToolText, type SaverOptions } from "./tool-saver-filter";

type RecordValue = Record<string, unknown>;

const PROTECTED = new Set(["read", "grep", "edit", "write", "patch", "anchor", "glob", "view", "list_dir"]);

function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
}

function commandFrom(value: unknown): string {
  try {
    const args = record(typeof value === "string" ? JSON.parse(value) : value);
    const command = args?.command ?? args?.cmd ?? args?.CommandLine;
    return typeof command === "string" ? command.trim() : "";
  } catch {
    return "";
  }
}

function compressContent(value: unknown, command: string, options: SaverOptions): unknown {
  if (typeof value === "string") {
    if (Buffer.byteLength(value) <= 500 || structuredOutput(value)) return value;
    const result = filterToolText(value, command, options).text;
    observeToolCompression(value, result);
    return result;
  }
  if (!Array.isArray(value)) return value;
  return value.map(part => {
    const obj = record(part);
    if (!obj || (obj.type !== "text" && obj.type !== "input_text") || typeof obj.text !== "string") return part;
    if (Buffer.byteLength(obj.text) <= 500 || structuredOutput(obj.text)) return part;
    const result = filterToolText(obj.text, command, options).text;
    observeToolCompression(obj.text, result);
    return { ...obj, text: result };
  });
}

function callDetails(item: RecordValue): Array<[string, string, string]> {
  const calls: Array<[string, string, string]> = [];
  if (item.type === "function_call" && typeof item.call_id === "string" && typeof item.name === "string") {
    calls.push([item.call_id, item.name, commandFrom(item.arguments)]);
  }
  if (Array.isArray(item.tool_calls)) for (const call of item.tool_calls) {
    const entry = record(call), fn = record(entry?.function);
    if (typeof entry?.id === "string" && typeof fn?.name === "string") calls.push([entry.id, fn.name, commandFrom(fn.arguments)]);
  }
  if (Array.isArray(item.content)) for (const part of item.content) {
    const block = record(part);
    if (block?.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
      calls.push([block.id, block.name, commandFrom(block.input)]);
    }
  }
  return calls;
}

function compressResult(item: RecordValue, calls: Map<string, [string, string]>, options: SaverOptions): void {
  const id = item.role === "tool" ? item.tool_call_id : item.type === "function_call_output" ? item.call_id : item.type === "tool_result" ? item.tool_use_id : undefined;
  if (typeof id !== "string" || item.is_error === true || item.isError === true || item.status === "error") return;
  const call = calls.get(id);
  if (!call || PROTECTED.has(call[0].trim().toLowerCase())) return;
  const key = item.type === "function_call_output" ? "output" : "content";
  const errorText = item[key];
  const parts = Array.isArray(errorText) ? errorText.map(part => record(part)?.text) : [errorText];
  if (parts.some(text => typeof text === "string" && /^(?:Error:|Exception:|Traceback \(most recent call last\):)/.test(text.trim()))) return;
  item[key] = compressContent(item[key], call[1], options);
}

/** Mutates only parsed, request-local tool results when explicitly enabled. */
export function compressToolResults(body: unknown, enabled: boolean | undefined, options: SaverOptions = {}, wire?: "messages"): void {
  if (enabled !== true) { injectSaverInstructions(body, options, wire); return; }
  const root = record(body);
  const items = Array.isArray(root?.messages) ? root.messages : Array.isArray(root?.input) ? root.input : undefined;
  if (!items) { injectSaverInstructions(body, options, wire); return; }
  const calls = new Map<string, [string, string]>();
  for (const value of items) {
    const item = record(value);
    if (item) for (const [id, name, command] of callDetails(item)) calls.set(id, [name, command]);
  }
  for (const value of items) {
    const item = record(value);
    if (!item) continue;
    compressResult(item, calls, options);
    if (Array.isArray(item.content)) for (const part of item.content) {
      const block = record(part);
      if (block) compressResult(block, calls, options);
    }
  }
  injectSaverInstructions(body, options, wire);
}
