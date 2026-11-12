import { fallbackFilter } from "./tool-saver-fallback";
import type { SaverInstructions } from "./tool-saver-instructions";
import { applyFilter, deduplicateText, matchFilter, smartTruncate } from "./tool-saver-engine";

export type SaverCategory = "git" | "build" | "test" | "package" | "docker" | "system";
export type SaverIntensity = "minimal" | "standard" | "aggressive";
export interface SaverOptions extends SaverInstructions {
  mode?: "simple" | "advance";
  filters?: Record<string, boolean>;
  intensity?: SaverIntensity;
  maxLines?: number;
  maxChars?: number;
  deduplicate?: boolean;
  categories?: Partial<Record<SaverCategory, boolean>>;
}
export const SAVER_CATEGORIES: SaverCategory[] = ["git", "build", "test", "package", "docker", "system"];
const byteLength = (text: string) => Buffer.byteLength(text);

function detectCategory(text: string): string {
  if (/^(?:diff --git|--- a\/|[a-f0-9]{7,40}\s|commit\s[a-f0-9]{7,})/.test(text) || /On branch |Changes to be committed:|Changes not staged for commit:|Untracked files:/.test(text)) return "git";
  if (/error TS\d+:|\d+:\d+\s+error\s+|\[vite\]|\[webpack\]|Module build failed|Failed to compile|^.*\.go:\d+:\d+: /m.test(text) || text.includes("Found ") && text.includes(" error")) return "build";
  if (/(?:PASS |FAIL )[\s\S]*(?:Test Suites:|Tests:)|expect\(received\)\.to|=== FAILURES ===|=== test session starts ===|=== RUN |--- FAIL: |--- PASS: |running [\s\S]* tests\ntest /.test(text)) return "test";
  if (/npm WARN|npm ERR!|packages are looking for funding|Requirement already satisfied:|\[bun\]|bun install/.test(text) || text.includes("added ") && text.includes("packages in") || text.includes("Compiling ") && text.includes("crates")) return "package";
  const sample = text.split("\n").slice(0, 3);
  const grepOutput = text.split("\n").length >= 2 && sample.filter(line => line.split(":", 3).length >= 2).length >= 2;
  if (grepOutput || text.includes("* Connected to ") || text.includes("> GET ") && text.includes("< HTTP/")) return "docker";
  if (/^CONTAINER ID\s+IMAGE|^NAME\s+(?:READY\s+STATUS|TYPE\s+CLUSTER-IP)|├──|└──|^[dcbsp-][rwx-]{9}\s+|^total |^USER\s+PID\s+%(?:CPU|MEM)/im.test(text)) return "docker";
  return "general";
}
export function compressionLimits(options: SaverOptions): [number, number] {
  let lines = options.maxLines && options.maxLines > 0 ? options.maxLines : 250;
  let chars = options.maxChars && options.maxChars > 0 ? options.maxChars : 10 * 1024 * 1024;
  if (options.intensity === "minimal") { lines *= 2; chars *= 2; }
  if (options.intensity === "aggressive") { lines = Math.max(180, Math.floor(lines / 2)); chars = Math.max(100000, Math.floor(chars / 2)); }
  return [lines, chars];
}

/** Reference: 9router-go f1eb955f, CompressTextDetailedWithCommand. Token counts are byte/4 estimates. */
export function compressTextDetailed(text: string, command = "", options: SaverOptions = {}) {
  const originalTokens = Math.ceil(byteLength(text) / 4);
  if (!text) return { text, originalTokens: 0, compressedTokens: 0, savedTokens: 0, savedPct: 0, detectedCategory: "general", techniquesUsed: ["none"] };
  let current = text;
  const techniques: string[] = [];
  const [maxLines, maxChars] = compressionLimits(options);
  if (options.deduplicate !== false) {
    const reduced = deduplicateText(current);
    if (reduced !== current) { current = reduced; techniques.push("line-deduplication"); }
  }
  const trimmed = current.trim();
  let detectedCategory = detectCategory(trimmed);
  const filter = matchFilter(trimmed, command, options);
  if (filter) {
    detectedCategory = filter.category;
    const result = applyFilter(filter, trimmed, maxLines);
    if (result.text !== trimmed) { current = result.text; techniques.push(...result.techniques); }
  } else if (options.categories?.[detectedCategory as SaverCategory] !== false) {
    const result = fallbackFilter(trimmed, detectedCategory, maxLines);
    if (result.text !== trimmed) { current = result.text; if (result.technique) techniques.push(result.technique); }
  }
  const lines = current.split("\n"), threshold = filter ? Math.min(250, maxLines) : 250;
  if (lines.length >= threshold && lines.length > maxLines && byteLength(current) >= 500) {
    current = smartTruncate(lines, maxLines, filter); techniques.push("smart-truncation");
  }
  let compressedLength: number | undefined;
  if (byteLength(current) > maxChars) {
    const bytes = Buffer.from(current), prefix = bytes.subarray(0, maxChars);
    const newline = prefix.lastIndexOf(10), cut = newline > maxChars / 2 ? newline : maxChars;
    // Go's JSON encoder replaces each invalid UTF-8 byte separately at a byte cut.
    let validCut = cut;
    while (validCut > 0 && bytes[validCut] !== undefined && (bytes[validCut]! & 0xc0) === 0x80) validCut--;
    if (validCut === cut) current = bytes.subarray(0, cut).toString("utf8");
    else current = bytes.subarray(0, validCut).toString("utf8") + "\ufffd".repeat(cut - validCut);
    const marker = `\n... (output truncated at ${maxChars} chars)`;
    current += marker;
    compressedLength = cut + byteLength(marker);
    techniques.push("char-truncation");
  }
  const compressedTokens = Math.ceil((compressedLength ?? byteLength(current)) / 4), savedTokens = Math.max(0, originalTokens - compressedTokens);
  return { text: current, originalTokens, compressedTokens, savedTokens, savedPct: originalTokens && savedTokens ? Math.round(savedTokens / originalTokens * 1000) / 10 : 0, detectedCategory, techniquesUsed: techniques.length ? techniques : ["none"] };
}
export function filterToolText(text: string, command: string, options: SaverOptions = {}) {
  const result = compressTextDetailed(text, command, options);
  return { ...result, category: result.detectedCategory, techniques: result.techniquesUsed };
}
