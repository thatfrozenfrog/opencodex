import { describe, expect, test } from "bun:test";
import opencodexUsage from "../../extensions/omp-usage";
import { ompUsageStatus, projectOmpUsage, type OmpUsageSnapshot } from "../../src/clients/omp-usage";
import { createOmpUsageSource } from "../../src/clients/omp-usage-runtime";
import type { ExportModel } from "../../src/clients/config-export/contracts";
import type { ProviderQuota } from "../../src/providers/quota-types";

const NOW = 1_790_000_000_000;
const model = (provider: string, id: string, namespaced = `${provider}/${id}`): ExportModel => ({ provider, id, namespaced });
const quota = (provider: string, data: Partial<ProviderQuota>) => ({
  provider, label: provider, source: `${provider}:quota`, updatedAt: NOW, quota: { updatedAt: NOW, ...data },
});
function snapshot(models: ExportModel[], reports: OmpUsageSnapshot["quotas"]["reports"]): OmpUsageSnapshot {
  return { models, quotas: { generatedAt: NOW, reports }, baseUrl: "http://127.0.0.1:10100/v1", exportedIds: models.map(row => row.namespaced) };
}

describe("OMP model usage", () => {
  test("joins exact catalog ownership, not model name prefixes or the visible provider", () => {
    const data = snapshot([model("one", "same", "alias/opaque"), model("two", "same")], [
      quota("one", { fiveHourPercent: 25, fiveHourResetAt: NOW + 60_000 }),
      quota("two", { weeklyPercent: 80 }),
    ]);
    const report = projectOmpUsage(data);
    expect(report.limits.map(limit => [limit.scope.modelId, limit.scope.windowId, limit.amount.usedFraction]))
      .toEqual([["alias/opaque", "5h", 0.25], ["two/same", "7d", 0.8]]);
    expect(report.limits[0]!.window!.resetsAt).toBe(NOW + 60_000);
    expect(ompUsageStatus(report, "two/same")).toBe("two: 7 Day 80% used");
    expect(ompUsageStatus(report, "missing")).toBe("ocx quota unavailable");
  });

  test("same selector changes quota when its classified provider changes", () => {
    const reports = [quota("old", { fiveHourPercent: 90 }), quota("new", { fiveHourPercent: 10 })];
    const first = projectOmpUsage(snapshot([model("old", "raw", "stable")], reports));
    const next = projectOmpUsage(snapshot([model("new", "raw", "stable")], reports));
    expect(ompUsageStatus(first, "stable")).toBe("old: 5 Hour 90% used");
    expect(ompUsageStatus(next, "stable")).toBe("new: 5 Hour 10% used");
    expect(next.limits[0]!.scope.sharedGroup).not.toBe(first.limits[0]!.scope.sharedGroup);
  });

  test("keeps native selectors and hides models absent from the current export", () => {
    const data = snapshot([model("openai", "gpt-example", "gpt-example"), model("one", "hidden")], [
      quota("openai", { fiveHourPercent: 0 }), quota("one", { fiveHourPercent: 40 }),
    ]);
    data.exportedIds = ["gpt-example"];
    expect(projectOmpUsage(data).limits.map(limit => [limit.scope.modelId, limit.amount.usedFraction]))
      .toEqual([["gpt-example", 0]]);
  });

  test("Antigravity summary windows retain duration and never cross model families", () => {
    const models = [model("google-antigravity", "gemini-4-pro"), model("google-antigravity", "claude-opus-4-8")];
    const row = quota("google-antigravity", { customWindows: [
      { label: "Gem", percent: 10 }, { label: "Gem (Weekly)", percent: 20 },
      { label: "Cla", percent: 80 }, { label: "Cla (Weekly)", percent: 90 },
    ] });
    row.source = "google-antigravity:retrieveUserQuotaSummary";
    const report = projectOmpUsage(snapshot(models, [row]));
    expect(report.limits.filter(limit => limit.scope.modelId === models[0]!.namespaced)
      .map(limit => [limit.scope.windowId, limit.amount.usedFraction])).toEqual([["7d", 0.2], ["5h", 0.1]]);
    expect(report.limits.filter(limit => limit.scope.modelId === models[1]!.namespaced)
      .map(limit => [limit.scope.windowId, limit.amount.usedFraction])).toEqual([["7d", 0.9], ["5h", 0.8]]);
    row.source = "google-antigravity:fetchAvailableModels";
    row.quota.customWindows = [{ label: "Gem", percent: 15 }];
    expect(projectOmpUsage(snapshot(models, [row])).limits[0]!.scope.windowId).toBeUndefined();
  });

  test("Fast aliases retain shared provider quota while pinned native accounts never borrow pool totals", () => {
    const fast = { ...model("one", "raw"), fastRowAvailable: true };
    const pinned = { ...model("openai", "account/gpt-example", "account/gpt-example"), native: true };
    const data = snapshot([fast, pinned], [quota("one", { weeklyPercent: 30 }), quota("openai", { weeklyPercent: 90 })]);
    data.exportedIds.push("one/raw--fast");
    const report = projectOmpUsage(data);
    expect(report.limits.map(limit => limit.scope.modelId)).toEqual(["one/raw", "one/raw--fast"]);
    expect(report.limits[0]!.scope.sharedGroup).toBe(report.limits[1]!.scope.sharedGroup);
    expect(ompUsageStatus(report, pinned.namespaced)).toBe("ocx quota unavailable");
  });

  test("scopes exact models and structurally scoped families without mixing unrelated quotas", () => {
    const data = snapshot([model("anthropic", "claude-opus-4-8"), model("anthropic", "claude-sonnet-5"), model("other", "raw")], [
      quota("anthropic", { weeklyPercent: 20, customWindows: [
        { label: "Opus", scope: "model", percent: 95, resetAt: NOW + 100_000 },
        { label: "Sonnet", scope: "model", percent: 50 },
        { label: "Exact", modelId: "claude-sonnet-5", percent: 60 },
      ] }),
      quota("other", { customWindows: [{ label: "Opus", percent: 30 }] }),
    ]);
    const report = projectOmpUsage(data);
    const opus = report.limits.filter(limit => limit.scope.modelId === "anthropic/claude-opus-4-8");
    expect(opus.map(limit => limit.amount.usedFraction)).toEqual([0.95, 0.2]);
    expect(opus[0]!.scope.windowId).toBe("7d");
    const sonnet = report.limits.filter(limit => limit.scope.modelId === "anthropic/claude-sonnet-5");
    expect(sonnet.map(limit => limit.amount.usedFraction)).toEqual([0.6, 0.5, 0.2]);
    expect(report.limits.find(limit => limit.scope.modelId === "other/raw")!.amount.usedFraction).toBe(0.3);
  });

  test("keeps monthly, custom windows, USD balances and credits in their real units", () => {
    const report = projectOmpUsage(snapshot([model("kiro", "raw")], [quota("kiro", {
      monthlyPercent: 40, monthlyResetAt: NOW + 1_000_000,
      customWindows: [{ label: "Burst", percent: 12, resetAt: NOW + 10_000 }],
      creditsUsd: { used: 20, limit: 100, remaining: 80, percent: 20 },
      kiroCreditsUsed: 50, kiroCreditsLimit: 200,
    })]));
    expect(report.limits.find(limit => limit.scope.windowId === "monthly")!.amount.usedFraction).toBe(0.4);
    const burst = report.limits.find(limit => limit.label.endsWith("Burst"))!;
    expect(burst.scope.windowId).toBeUndefined();
    expect(burst.window!.resetsAt).toBe(NOW + 10_000);
    expect(report.limits.find(limit => limit.amount.unit === "usd")!.amount)
      .toEqual({ unit: "usd", used: 20, remaining: 80, limit: 100, usedFraction: 0.2 });
    expect(report.limits.find(limit => limit.amount.unit === "credits")!.amount.usedFraction).toBe(0.25);
    expect(ompUsageStatus(report, "kiro/raw")).toContain("Monthly 40% used");
  });

  test("unknown and invalid readings never become zero utilization; overage remains measured", () => {
    const data = snapshot([model("unknown", "raw"), model("combo", "code"), model("one", "raw")], [
      quota("one", { fiveHourPercent: Number.NaN, weeklyPercent: -1, monthlyPercent: 120 }),
    ]);
    const report = projectOmpUsage(data);
    expect(ompUsageStatus(report, "unknown/raw")).toBe("ocx quota unavailable");
    expect(ompUsageStatus(report, "combo/code")).toBe("ocx quota unavailable");
    expect(report.limits.map(limit => [limit.amount.usedFraction, limit.status])).toEqual([[1.2, "exhausted"]]);
  });

  test("unlimited credits have no invented utilization percentage", () => {
    const report = projectOmpUsage(snapshot([model("one", "raw")], [quota("one", {
      creditsUsd: { used: 25, limit: 0, remaining: 200, percent: 0, unlimited: true },
    })]));
    expect(report.limits[0]!.amount.usedFraction).toBeUndefined();
    expect(ompUsageStatus(report, "one/raw")).toBe("one: USD credits $200.00 left");
  });
  test("Xpiki custom windows map to 5h short quota and scope to the active model", () => {
    const sonnet = model("xpiki", "claude-sonnet-5");
    const opus = model("xpiki", "claude-opus-5-5");
    const xpikiReport = quota("xpiki", {
      customWindows: [
        { label: "claude-sonnet-5 · shared balance · 166.7M input / 33.3M output tokens capacity (150M / 30M remaining)", percent: 10 },
        { label: "claude-opus-5-5 · shared balance · 100M input / 20M output tokens capacity (90M / 18M remaining)", percent: 10 },
      ],
    });
    xpikiReport.source = "xpiki:key-status";
    const report = projectOmpUsage(snapshot([sonnet, opus], [xpikiReport]));

    const sonnetLimits = report.limits.filter(limit => limit.scope.modelId === sonnet.namespaced);
    expect(sonnetLimits).toHaveLength(1);
    expect(sonnetLimits[0]!.scope.windowId).toBe("5h");
    expect(sonnetLimits[0]!.window?.durationMs).toBe(5 * 3_600_000);
    expect(sonnetLimits[0]!.amount.usedFraction).toBe(0.1);
    expect(sonnetLimits[0]!.label).toContain("claude-sonnet-5");

    const opusLimits = report.limits.filter(limit => limit.scope.modelId === opus.namespaced);
    expect(opusLimits).toHaveLength(1);
    expect(opusLimits[0]!.scope.windowId).toBe("5h");
    expect(opusLimits[0]!.window?.durationMs).toBe(5 * 3_600_000);
    expect(opusLimits[0]!.amount.usedFraction).toBe(0.1);
    expect(opusLimits[0]!.label).toContain("claude-opus-5-5");

    expect(sonnetLimits[0]!.scope.sharedGroup).toBe(opusLimits[0]!.scope.sharedGroup);
    expect(ompUsageStatus(report, sonnet.namespaced)).toContain("claude-sonnet-5");
    expect(ompUsageStatus(report, sonnet.namespaced)).not.toContain("claude-opus-5-5");
  });
});

describe("OMP refresh publication", () => {
  test("poll expiry re-reads source ownership even when the model ID stays unchanged", async () => {
    let now = NOW;
    let provider = "old";
    const source = createOmpUsageSource(async () => snapshot([model(provider, "raw", "stable")], [
      quota("old", { weeklyPercent: 90 }), quota("new", { weeklyPercent: 5 }),
    ]), () => now);
    expect(ompUsageStatus(await source.read("http://localhost/v1"), "stable")).toContain("old: 7 Day 90%");
    provider = "new";
    now += 30_000;
    expect(ompUsageStatus(await source.read("http://localhost/v1"), "stable")).toBe("new: 7 Day 5% used");
  });

  test("a late response for a previous proxy cannot overwrite the new selection", async () => {
    const old = Promise.withResolvers<OmpUsageSnapshot>();
    let oldSignal: AbortSignal | undefined;
    const source = createOmpUsageSource(async (baseUrl, signal) => {
      if (baseUrl === "old") { oldSignal = signal; return old.promise; }
      return snapshot([model("new", "raw")], [quota("new", { weeklyPercent: 5 })]);
    });
    const previous = source.read("old");
    const current = await source.read("new");
    expect(oldSignal!.aborted).toBe(true);
    old.resolve(snapshot([model("old", "raw")], [quota("old", { weeklyPercent: 99 })]));
    expect(await previous).toBeNull();
    expect(ompUsageStatus(current, "new/raw")).toBe("new: 7 Day 5% used");
    expect(ompUsageStatus(await source.read("new"), "old/raw")).toBe("ocx quota unavailable");
  });

  test("failed refresh cannot replay an invalidated last-good model quota", async () => {
    let fails = false;
    const source = createOmpUsageSource(async () => {
      if (fails) throw new Error("unavailable");
      return snapshot([model("one", "raw")], [quota("one", { fiveHourPercent: 25 })]);
    });
    await source.read("proxy");
    source.invalidate();
    fails = true;
    await expect(source.read("proxy")).rejects.toThrow("unavailable");
    fails = false;
    expect(ompUsageStatus(await source.read("proxy"), "one/raw")).toBe("one: 5 Hour 25% used");
  });
});

describe("OMP extension bottom line", () => {
  test("registers usage provider with loopback apiKey at extension load", async () => {
    const handlers: Record<string, ((event: unknown, ctx: unknown) => void)[]> = {};
    let registeredOptions: { usage?: unknown; apiKey?: string } | undefined;
    let registeredProviderId = "";
    const pi = {
      registerProvider: (id: string, opts: { usage?: unknown; apiKey?: string }) => {
        registeredProviderId = id;
        registeredOptions = opts;
      },
      on: (event: string, handler: (event: unknown, ctx: unknown) => void) => {
        (handlers[event] ??= []).push(handler);
      },
    };

    opencodexUsage(pi as never);
    expect(registeredProviderId).toBe("opencodex");
    expect(registeredOptions?.usage).toBeDefined();
    expect(registeredOptions?.apiKey).toBe("opencodex-loopback");
  });

  test("does not set a bottom usage status line in the UI and resets refreshing state", async () => {
    const handlers: Record<string, ((event: unknown, ctx: unknown) => void)[]> = {};
    let registeredUsageProvider: unknown;
    const pi = {
      registerProvider: (_id: string, opts: { usage: unknown }) => {
        registeredUsageProvider = opts.usage;
      },
      on: (event: string, handler: (event: unknown, ctx: unknown) => void) => {
        (handlers[event] ??= []).push(handler);
      },
    };

    const statusCalls: Array<{ key: string; text: string | undefined }> = [];
    const ctx = {
      hasUI: true,
      model: { provider: "opencodex", id: "xpiki/claude-sonnet-5", baseUrl: "http://127.0.0.1:10100/v1" },
      ui: {
        setStatus: (key: string, text: string | undefined) => {
          statusCalls.push({ key, text });
        },
      },
      modelRegistry: {
        authStorage: {
          usage: {
            setProvider: () => {},
            invalidate: async () => {},
          },
        },
      },
    };

    opencodexUsage(pi as never);
    expect(registeredUsageProvider).toBeDefined();

    for (const h of handlers["session_start"] ?? []) {
      h({}, ctx);
    }

    // Status should never be set to any truthy text (no bottom line showing usage)
    expect(statusCalls.every(call => call.text === undefined)).toBe(true);

    for (const h of handlers["session_shutdown"] ?? []) {
      h({}, ctx);
    }
    expect(statusCalls.every(call => call.text === undefined)).toBe(true);
  });
});
