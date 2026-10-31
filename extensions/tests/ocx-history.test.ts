import { expect, test } from "bun:test";
import { fetchHistory, fetchHistorySnapshot, historySessions, type HistoryRow } from "../ocx-usage-dashboard/history";
import { collectUsageData } from "../ocx-usage-dashboard/data";
import { buildGraphModel } from "../ocx-usage-dashboard/graph";
const row = (id: string, timestamp = Date.now()): HistoryRow => ({ requestId: id, timestamp,
  provider: "openai", model: "gpt", usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 60 } });

test("paginates all history without a day cutoff and deduplicates request IDs", async () => {
  const paths: string[] = [];
  const sessions = await fetchHistory(async (path: string) => {
    paths.push(path);
    return paths.length === 1 ? { entries: [row("a")], hasMore: true, nextCursor: "cursor" }
      : { entries: [row("a"), row("b", Date.now() - 90 * 86400000)], hasMore: false };
  });
  expect(paths[1]).toContain("cursor=cursor");
  expect(paths[0]).not.toContain("from=");
  expect(sessions.flatMap((s: { messages: unknown[] }) => s.messages)).toHaveLength(2);
  const data = await collectUsageData({ historySessions: sessions });
  expect(data!.allTime.totals.messages).toBe(2);
  expect(data!.today.totals.messages).toBe(1);
  expect(data!.allTime.totals.tokens.total).toBe(240);
});
test("attributes attempts to real upstreams and excludes parent duplicate usage", async () => {
  const r = row("a");
  r.attempts = [
    { provider: "xpiki", model: "claude", usage: { inputTokens: 10, outputTokens: 5 } },
    { provider: "google-antigravity", model: "gemini", usage: { inputTokens: 10, outputTokens: 5 } },
  ];
  const data = await collectUsageData({ historySessions: historySessions([r]) });
  expect([...data!.allTime.providers.keys()].sort()).toEqual(["ocx/google-antigravity", "ocx/xpiki"]);
  // Identical tokens/timestamps on two attempts must not collide in Pi's deduper.
  expect(data!.allTime.totals.messages).toBe(2);
  expect(data!.allTime.totals.tokens.total).toBe(30);
});
test("groups account-qualified providers like the OCX usage summary", async () => {
  const providers = ["openai", "openai-p15b7e7", "openai-p278b12", "chatgpt-main", "openai-multi", "custom-main"];
  const rows = providers.map((provider, i) => ({ ...row(String(i), Date.now() - 3600000), provider }));
  const data = (await collectUsageData({ historySessions: historySessions(rows) }))!;
  const graph = buildGraphModel(data.hourly, { period: "allTime", metric: "tokens", groupBy: "provider", cumulative: true, bounds: data.bounds });
  expect(data.allTime.providers.get("ocx/openai")?.tokens.total).toBe(600);
  expect(data.allTime.providers.get("ocx/custom-main")?.tokens.total).toBe(120);
  expect(graph.series.find(s => s.key === "ocx/openai")?.total).toBe(600);
  expect(graph.series[0].total).toBe(720);
});
test("normalizes inclusive cache input and uses OCX cost estimate", () => {
  const r = row("a");
  r.displayMetrics = { cost: { kind: "value", estimate: { cost: { total: 0.25 },
    tokens: { input: 40, output: 20, cacheRead: 60, cacheWrite: 0 } } } };
  const m = historySessions([r])[0].messages[0];
  expect(m.input).toBe(40);
  expect(m.cacheRead).toBe(60);
  expect(m.cost).toBe(0.25);
});
test("graph and table include cache reads and honor explicit OCX totals", async () => {
  const r = row("cache", Date.now() - 3600000);
  r.usage = { inputTokens: 100_000_000, outputTokens: 10_000_000, cachedInputTokens: 90_000_000, totalTokens: 120_000_000 };
  const data = (await collectUsageData({ historySessions: historySessions([r]) }))!;
  const graph = buildGraphModel(data.hourly, { period: "allTime", metric: "tokens", groupBy: "provider", cumulative: true, bounds: data.bounds });
  expect(data.allTime.totals.tokens.total).toBe(120_000_000);
  expect(graph.series[0].total).toBe(120_000_000);
  expect(graph.series[1].total).toBe(120_000_000);
});
test("unchanged complete history index avoids further pages; changed index rebuilds", async () => {
  const index = { indexedRows: 200, sourceSize: 1234, sourceMtimeMs: 1000, builtAtMs: 10, lastError: null };
  let calls = 0;
  const request = async () => {
    calls++;
    return calls % 2 ? { entries: [row("a")], hasMore: true, nextCursor: "next", index }
      : { entries: [row("b")], hasMore: false, index };
  };
  const first = await fetchHistorySnapshot(request);
  expect(first.sessions!.flatMap(s => s.messages)).toHaveLength(2);
  const warm = await fetchHistorySnapshot(request, undefined, first.index);
  expect(calls).toBe(3);
  expect(warm.sessions).toBeUndefined();
  calls = 0;
  const changed = await fetchHistorySnapshot(request, undefined, { ...index, sourceSize: 99 });
  expect(calls).toBe(2);
  expect(changed.sessions!.flatMap(s => s.messages)).toHaveLength(2);
});
test("a changing index is not cached", async () => {
  let calls = 0;
  const result = await fetchHistorySnapshot(async () => ({ entries: [row(String(calls))], hasMore: calls++ === 0,
    nextCursor: "next", index: { indexedRows: calls, sourceSize: 10, sourceMtimeMs: 10, builtAtMs: 10 } }));
  expect(result.index).toBeUndefined();
});
test("pagination failures never return partial totals", async () => {
  let n = 0;
  await expect(fetchHistory(async () => {
    if (++n === 1) return { entries: [row("a")], hasMore: true, nextCursor: "same" };
    return { entries: [], hasMore: true, nextCursor: "same" };
  })).rejects.toThrow("stalled");
});
test("aborted history loading stops before requesting", async () => {
  const c = new AbortController(); c.abort();
  let called = false;
  await expect(fetchHistory(async () => { called = true; return { entries: [], hasMore: false }; }, c.signal)).rejects.toThrow();
  expect(called).toBe(false);
});
