import { describe, expect, mock, test } from "bun:test";
mock.module("@earendil-works/pi-tui", () => ({ truncateToWidth: (s: string, w: number) => s.slice(0, w) }));
import { formatFooterLimit, installOcxUsage, quotaLines, upstreamProvider, type Report } from "../pi-ocx";
import { collectUsageData } from "../ocx-usage-dashboard/data";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const report: Report = {
  fetchedAt: Date.now(), notes: [],
  limits: ["a", "b"].map(modelId => ({
    label: "Provider: 5h", scope: { modelId, sharedGroup: "provider:5h" },
    amount: { unit: "percent", usedFraction: 0.42 }, notes: [],
  })),
};
function harness(load: (base: string, signal: AbortSignal) => Promise<Report> = async () => report) {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const statuses: unknown[] = [];
  let rendered: string[] = [];
  const ctx: any = {
    hasUI: true, model: { provider: "opencodex", id: "a", baseUrl: "http://127.0.0.1:10110/v1" },
    ui: {
      setStatus: (_key: string, text: unknown) => statuses.push(text), notify: () => {},
      custom: async (factory: Function) => {
        const c = await factory({}, { fg: (_color: string, text: string) => text }, {}, () => {});
        rendered = c.render(80);
      },
    },
  };
  const pi: any = {
    on: (event: string, handler: Function) => handlers.set(event, handler),
    registerCommand: (name: string, command: any) => commands.set(name, command),
  };
  const usage = (api: any) => api.registerCommand("usage", {
    description: "upstream",
    handler: async (_args: string, ctx: any) => ctx.ui.custom(() => ({ render: () => ["Historical totals: 123"], invalidate() {} })),
  });
  installOcxUsage(pi, usage, load);
  return { handlers, commands, ctx, statuses, rendered: () => rendered };
}

describe("Pi OCX usage bridge", () => {
  test("resolves exact catalog selectors and keeps dynamic routes unresolved", () => {
    const catalog = { "gpt-6.1-sol": "openai", "xpiki/claude-opus-5": "xpiki" };
    expect(upstreamProvider("opencodex", "gpt-6.1-sol", catalog)).toBe("ocx/openai");
    expect(upstreamProvider("opencodex", "xpiki/claude-opus-5", catalog)).toBe("ocx/xpiki");
    expect(upstreamProvider("opencodex", "policy/auto", catalog)).toBe("ocx/unresolved");
    expect(upstreamProvider("anthropic", "claude", catalog)).toBe("anthropic");
  });
  test("collector splits providers in tables and graph buckets even on a warm raw cache", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-ocx-"));
    try {
      const now = Date.now();
      const entries = [{ type: "session", id: "test", cwd: "/tmp" },
        ...["native", "xpiki/claude", "google-antigravity/gemini"].map((model, i) => ({
          type: "message", message: { role: "assistant", provider: "opencodex", model,
            timestamp: now - i, usage: { input: 10, output: 5, cost: { total: 0 } } },
        }))];
      await writeFile(join(dir, "session.jsonl"), entries.map(e => JSON.stringify(e)).join("\n") + "\n");
      const options = { sessionsDir: dir, cachePath: join(dir, "cache.json") };
      const raw = await collectUsageData(options);
      expect([...raw!.allTime.providers.keys()]).toEqual(["opencodex"]);
      const catalog = { native: "openai", "xpiki/claude": "xpiki", "google-antigravity/gemini": "google-antigravity" };
      const split = await collectUsageData({ ...options,
        providerForModel: (p: string, m: string) => upstreamProvider(p, m, catalog),
      });
      expect([...split!.allTime.providers.keys()].sort()).toEqual(["ocx/google-antigravity", "ocx/openai", "ocx/xpiki"]);
      expect(split!.allTime.totals.tokens.total).toBe(raw!.allTime.totals.tokens.total);
      expect(split!.allTime.totals.messages).toBe(3);
      expect(JSON.stringify([...split!.hourly.values()].map(bucket => [...bucket.keys()]))).toContain("ocx/xpiki");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  test("deduplicates shared limits without changing historical totals", async () => {
    expect(quotaLines(report).filter(l => l.includes("42% used"))).toHaveLength(1);
    const h = harness();
    await h.commands.get("usage").handler("", h.ctx);
    expect(h.rendered().join("\n")).toContain("42% used");
    expect(h.rendered()[0]).toBe("Historical totals: 123");
    expect(h.rendered().at(-1)).toContain("$0 cost does not mean zero tokens");
    expect(h.statuses.at(-1)).toContain("42% 5h [██████░░░░░░░░░]");
  });
  test("opens history without waiting for a slow quota refresh", async () => {
    let finish!: (value: Report) => void;
    const h = harness(() => new Promise<Report>(resolve => { finish = resolve; }));
    await h.commands.get("usage").handler("", h.ctx);
    expect(h.rendered()[0]).toBe("Historical totals: 123");
    expect(h.rendered().join("\n")).toContain("unavailable");
    finish(report);
    await Promise.resolve();
  });
  test("formats measured window usage as compact bars", () => {
    const limit = report.limits[0];
    expect(formatFooterLimit({ ...limit, window: { id: "5h" }, amount: { unit: "percent", usedFraction: 0.05 } })).toBe("5% 5h [█░░░░░░░░░░░░░░]");
    expect(formatFooterLimit({ ...limit, window: { id: "7d" }, amount: { unit: "percent", usedFraction: 0.8 } })).toBe("80% 7d [████████████░░░]");
    expect(formatFooterLimit({ ...limit, amount: { unit: "percent" } })).toContain("unknown");
  });
  test("keeps quotas visible in the final viewport of a tall dashboard", async () => {
    const h = harness();
    await h.commands.get("usage").handler("", h.ctx);
    expect(h.rendered().slice(-6).join("\n")).toContain("OCX live provider quotas");
  });
  test("shared balance chooses highest measured utilization", () => {
    const pooled = structuredClone(report);
    pooled.limits[1].label = "Provider: model b";
    pooled.limits[1].amount.usedFraction = 0.8;
    const lines = quotaLines(pooled).join("\n");
    expect(lines).toContain("80% used");
    expect(lines).not.toContain("42% used");
  });
  test("caches reads and forces refresh on explicit command", async () => {
    let reads = 0;
    const h = harness(async () => { reads++; return report; });
    await h.commands.get("usage").handler("", h.ctx);
    await h.commands.get("usage").handler("", h.ctx);
    expect(reads).toBe(1);
    await h.commands.get("ocx-usage").handler("", h.ctx);
    expect(reads).toBe(2);
  });
  test("preserves upstream dashboard for non-OCX models", async () => {
    let reads = 0;
    const h = harness(async () => { reads++; return report; });
    h.ctx.model.provider = "anthropic";
    await h.commands.get("usage").handler("", h.ctx);
    expect(reads).toBe(0);
    expect(h.rendered()).toEqual(["Historical totals: 123"]);
  });
  test("failed reads show unknown rather than stale quota or zero", async () => {
    const h = harness(async () => { throw new Error("offline"); });
    await h.commands.get("usage").handler("", h.ctx);
    expect(h.rendered().join("\n")).toContain("unavailable");
    expect(h.statuses.at(-1)).toBe("ocx quota unavailable");
  });
  test("shutdown aborts pending reads and prevents late publication", async () => {
    let signal: AbortSignal | undefined;
    let finish!: (report: Report) => void;
    const h = harness((_base: string, s: AbortSignal) => {
      signal = s;
      return new Promise<Report>(resolve => { finish = resolve; });
    });
    const work = h.commands.get("usage").handler("", h.ctx);
    h.handlers.get("session_shutdown")!();
    expect(signal?.aborted).toBe(true);
    finish(report);
    await work;
    expect(h.statuses).not.toContain("Provider: 5h: 42% used");
  });
  test("model switch discards obsolete responses", async () => {
    const pending: ((r: Report) => void)[] = [];
    const h = harness(() => new Promise<Report>(resolve => pending.push(resolve)));
    const first = h.commands.get("usage").handler("", h.ctx);
    h.ctx.model = { ...h.ctx.model, id: "b" };
    const second = h.commands.get("usage").handler("", h.ctx);
    pending[1](report);
    await second;
    const before = h.statuses.length;
    pending[0](report);
    await first;
    expect(h.statuses).toHaveLength(before);
  });
});

test("Codex quota uses only the selected account, never pooled utilization", async () => {
  const { withActiveCodexQuota } = await import("../pi-ocx");
  const { projectPiUsage } = await import("../../src/clients/pi-usage");
  const now = Date.now();
  const snapshot = {
    models: [{ provider: "openai", id: "gpt", namespaced: "gpt" }], exportedIds: ["gpt"],
    baseUrl: "http://127.0.0.1/v1", quotas: { generatedAt: now, reports: [
      { provider: "openai", label: "OpenAI", source: "pool", updatedAt: now, quota: { updatedAt: now, fiveHourPercent: 8, weeklyPercent: 7 }, aggregation: {} as any },
    ] },
  };
  const accounts = [
    { id: "one", quota: { updatedAt: now, shortPercent: 12, shortWindowSeconds: 18000, weeklyPercent: 7 } },
    { id: "two", quota: { updatedAt: now, shortPercent: 0, shortWindowSeconds: 18000, weeklyPercent: 8 } },
    { id: "__main__", isMain: true, quota: { updatedAt: now, fiveHourPercent: 33 } },
  ];
  const usage = (id: string | null, rows: unknown) => projectPiUsage(withActiveCodexQuota(snapshot, id, rows))
    .limits.map(limit => [limit.window?.id, limit.amount.used]);
  expect(usage("one", accounts)).toEqual([["5h", 12], ["7d", 7]]);
  expect(usage("two", accounts)).toEqual([["7d", 8], ["5h", 0]]);
  expect(usage(null, accounts)).toEqual([["5h", 33]]);
  expect(usage("missing", accounts)).toEqual([]);
  expect(usage("one", [])).toEqual([]);
  expect(snapshot.quotas.reports[0].quota.fiveHourPercent).toBe(8);
});
