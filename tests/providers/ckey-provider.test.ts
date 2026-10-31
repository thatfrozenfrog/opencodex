import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearProviderQuotaCache, fetchProviderQuotaReports } from "../../src/providers/quota";
import { PROVIDER_REGISTRY } from "../../src/providers/registry";
import { formatCostDual, formatCostUsd } from "../../gui/src/provider-workspace/usage";
import type { OcxConfig } from "../../src/types";
import { removeTreeWithRetry } from "../helpers/remove-tree";
import { ensureCkeyPricing } from "../../src/usage/ckey-pricing";
import { estimateRequestCost } from "../../src/usage/cost";

const originalFetch = globalThis.fetch;
const previousOpencodexHome = process.env.OPENCODEX_HOME;
let opencodexHome: string;

function ckeyConfig(baseUrl = "https://api.xah.io/v1", apiKey = "ck-prod-test-key-123"): OcxConfig {
  return {
    port: 0,
    defaultProvider: "ckey",
    providers: {
      ckey: {
        adapter: "openai-chat",
        authMode: "key",
        baseUrl,
        apiKey,
      },
    },
  } as OcxConfig;
}

beforeEach(() => {
  opencodexHome = mkdtempSync(join(tmpdir(), "ocx-ckey-provider-"));
  process.env.OPENCODEX_HOME = opencodexHome;
  clearProviderQuotaCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearProviderQuotaCache();
  if (previousOpencodexHome === undefined) delete process.env.OPENCODEX_HOME;
  else process.env.OPENCODEX_HOME = previousOpencodexHome;
  removeTreeWithRetry(opencodexHome);
});

describe("Ckey.vn provider", () => {
  test("registry entry has correct attributes and destination aliases", () => {
    const entry = PROVIDER_REGISTRY.find(p => p.id === "ckey");
    expect(entry).toBeDefined();
    expect(entry?.label).toBe("Ckey.vn");
    expect(entry?.authKind).toBe("key");
    expect(entry?.adapter).toBe("openai-chat");
    expect(entry?.baseUrl).toBe("https://api.xah.io/v1");
    expect(entry?.defaultModel).toBe("gpt-4o-mini");
    expect(entry?.destinationAliases).toContainEqual({
      baseUrl: "https://api.xah.io",
      adapter: "anthropic",
    });
  });

  test("quota probe formats both VND and USD for balance and usage", async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/profile")) {
        return new Response(JSON.stringify({
          success: true,
          status: 200,
          data: {
            profile: {
              balance_raw: 100000,
            },
          },
        }), { status: 200 });
      }
      if (urlStr.includes("/api/llm/usage-stats")) {
        return new Response(JSON.stringify({
          success: true,
          status: 200,
          data: {
            charged_vnd: 75.5,
            charged_vnd_text: "75,5 VND",
            requests: 42,
            total_tokens: 8000,
          },
        }), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const result = await fetchProviderQuotaReports(ckeyConfig(), true);
    expect(result.reports).toHaveLength(1);
    const report = result.reports[0]!;
    expect(report.source).toBe("ckey:profile");

    const customWindows = report.quota.customWindows;
    expect(customWindows).toBeDefined();
    expect(customWindows!.length).toBe(2);

    // Balance window: 100,000 VND (~$4.00 USD)
    expect(customWindows![0]?.label).toContain("100");
    expect(customWindows![0]?.label).toContain("VND");
    expect(customWindows![0]?.label).toContain("$4.00 USD");

    // Usage window: 76 VND (~$0.0030 USD)
    expect(customWindows![1]?.label).toContain("76 VND");
    expect(customWindows![1]?.label).toContain("$0.0030 USD");
    expect(customWindows![1]?.label).toContain("42 req");
    expect(customWindows![1]?.label).toContain("8,000 tok");

    // creditsUsd calculations
    expect(report.quota.creditsUsd).toBeDefined();
    expect(report.quota.creditsUsd?.remaining).toBe(4.00);
  });

  test("quota probe flags terminal failure on 400 bad API key", async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/profile")) {
        return new Response(JSON.stringify({
          success: false,
          status: 400,
          message: "Vui lòng nhập API key!",
          data: [],
        }), { status: 400 });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const result = await fetchProviderQuotaReports(ckeyConfig(), true);
    // TERMINAL_QUOTA_FAILURE suppresses report publication on bad key
    expect(result.reports).toHaveLength(0);
  });

  test("estimates token, request and minimum charges from the authenticated Ckey catalog", async () => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe("https://ckey.vn/api/llm/models");
      expect(url.searchParams.get("key")).toBe("ck-prod-test-key-123");
      expect(init?.redirect).toBe("error");
      return Response.json({ success: true, data: { models: [{ public_name: "seller/GPT-Demo", input_price_per_million_vnd: 5000, output_price_per_million_vnd: 15000, price_per_request_vnd: 2, min_charge_per_request_vnd: 10, cache_enabled: false, cache_read_price_per_million_vnd: 0, cache_write_price_per_million_vnd: 0 }] } });
    }) as typeof fetch;
    await ensureCkeyPricing(ckeyConfig());
    const estimate = estimateRequestCost({ provider: "ckey", model: "seller/GPT-Demo", usage: { inputTokens: 1000, outputTokens: 1000 }, usageStatus: "reported" });
    expect(estimate?.price?.source).toBe("ckey");
    expect(estimate?.cost.total).toBeCloseTo(22 / 25000);
    const minimum = estimateRequestCost({ provider: "ckey", model: "seller-GPT-Demo", usage: { inputTokens: 1, outputTokens: 1 }, usageStatus: "reported" });
    expect(minimum?.cost.total).toBeCloseTo(10 / 25000);
    expect(estimateRequestCost({ provider: "ckey", model: "unknown", usage: { inputTokens: 1, outputTokens: 1 }, usageStatus: "reported" })).toBeNull();
  });

  test("formatCostDual formats cost in both USD and VND", () => {
    expect(formatCostDual(null)).toBe("—");
    expect(formatCostDual(undefined)).toBe("—");
    expect(formatCostDual(0.003)).toContain("$0.0030");
    expect(formatCostDual(0.003)).toContain("75 VND");
    expect(formatCostDual(1.0)).toContain("$1.0000");
    expect(formatCostDual(1.0)).toContain("25");
    expect(formatCostDual(1.0)).toContain("VND");
  });
});
