import type { ParsedSessionFile, SessionMessage } from "./data.ts";
import { baseProviderLabel } from "../../src/providers/label.ts";

type Usage = { inputTokens?: number; outputTokens?: number; totalTokens?: number; cachedInputTokens?: number;
  cacheReadInputTokens?: number; cacheCreationInputTokens?: number; reasoningOutputTokens?: number };
type Target = { provider?: string; model?: string; usage?: Usage; totalTokens?: number; locallyAnswered?: boolean;
  displayMetrics?: { cost?: { kind: string; estimate?: { cost?: { total?: number };
    tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number } } } } };
export type HistoryRow = Target & { requestId: string; timestamp: number; conversationId?: string; attempts?: Target[] };
export type HistoryIndex = { indexedRows?: number; sourceSize?: number; sourceMtimeMs?: number; builtAtMs?: number; lastError?: unknown };
export type HistoryPage = { entries: HistoryRow[]; hasMore: boolean; nextCursor?: string; index?: HistoryIndex };

function sameIndex(a: HistoryIndex | undefined, b: HistoryIndex | undefined): boolean {
  return !!a && !!b && !a.lastError && !b.lastError
    && ["indexedRows", "sourceSize", "sourceMtimeMs", "builtAtMs"].every(key => {
      const field = key as keyof HistoryIndex;
      return typeof a[field] === "number" && Number.isFinite(a[field]) && a[field] === b[field];
    });
}

const count = (n: number | undefined) => typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0;

export function historySessions(rows: HistoryRow[]): ParsedSessionFile[] {
  const sessions = new Map<string, ParsedSessionFile>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.requestId) || !Number.isFinite(row.timestamp)) continue;
    seen.add(row.requestId);
    // Unknown conversation identity is not a fabricated session per request.
    const sessionId = row.conversationId || "ocx:unidentified-conversations";
    let session = sessions.get(sessionId);
    if (!session) {
      session = { sessionId, cwd: "", messages: [], toolUsages: [] };
      sessions.set(sessionId, session);
    }
    const targets = row.attempts?.length ? row.attempts : [row];
    targets.forEach((target, i) => {
      if (target.locallyAnswered) return;
      const u = target.usage;
      const cost = target.displayMetrics?.cost;
      const tokens = cost?.kind === "value" ? cost.estimate?.tokens : undefined;
      const read = count(u?.cacheReadInputTokens ?? u?.cachedInputTokens);
      const write = count(u?.cacheCreationInputTokens);
      const message: SessionMessage = {
        provider: `ocx/${baseProviderLabel(target.provider || "unresolved")}`, model: target.model || "unknown",
        timestamp: row.timestamp, thinkingLevel: "", source: "assistant",
        sourceId: `${row.requestId}:${i}`, afterContextChange: false,
        input: tokens ? count(tokens.input) : Math.max(0, count(u?.inputTokens) - read - write),
        output: count(u?.outputTokens), totalTokens: u ? Math.max(count(u.inputTokens) + count(u.outputTokens), count(u.totalTokens ?? target.totalTokens)) : 0,
        cacheRead: tokens ? count(tokens.cacheRead) : read,
        cacheWrite: tokens ? count(tokens.cacheWrite) : write, reasoning: count(u?.reasoningOutputTokens),
        cost: cost?.kind === "value" ? count(cost.estimate?.cost?.total) : 0,
      };
      session.messages.push(message);
    });
  }
  for (const session of sessions.values()) session.messages.sort((a, b) => a.timestamp - b.timestamp);
  return [...sessions.values()];
}

export async function fetchHistorySnapshot(
  request: (path: string) => Promise<HistoryPage>,
  signal?: AbortSignal,
  previousIndex?: HistoryIndex,
): Promise<{ sessions?: ParsedSessionFile[]; index?: HistoryIndex }> {
  const rows: HistoryRow[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let index: HistoryIndex | undefined;
  let stable = true;
  // Freeze the upper timestamp so incoming traffic cannot shift pagination.
  const until = Date.now();
  do {
    signal?.throwIfAborted();
    const query = new URLSearchParams({ limit: "100", to: String(until) });
    if (cursor) query.set("cursor", cursor);
    const page = await request(`/api/request-history?${query}`);
    if (!Array.isArray(page.entries) || typeof page.hasMore !== "boolean") throw new Error("Invalid OCX history response");
    if (!cursor) {
      index = page.index;
      if (sameIndex(index, previousIndex)) { signal?.throwIfAborted(); return { index }; }
    } else if (!sameIndex(index, page.index)) stable = false;
    rows.push(...page.entries);
    if (!page.hasMore) break;
    if (!page.nextCursor || cursors.has(page.nextCursor)) throw new Error("OCX history pagination stalled");
    cursor = page.nextCursor;
    cursors.add(cursor);
  } while (true);
  signal?.throwIfAborted();
  return { sessions: historySessions(rows), index: stable ? index : undefined };
}

export async function fetchHistory(request: (path: string) => Promise<HistoryPage>, signal?: AbortSignal): Promise<ParsedSessionFile[]> {
  return (await fetchHistorySnapshot(request, signal)).sessions!;
}
