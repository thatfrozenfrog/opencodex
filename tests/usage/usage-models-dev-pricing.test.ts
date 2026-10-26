import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MODELS_DEV_SOURCE_URL,
  modelsDevPricingVersion,
  modelsDevPublishedPrice,
  modelsDevVendorPrice,
  refreshModelsDevPricing,
  resetModelsDevPricingForTests,
  searchModelsDevPrices,
  seedModelsDevPricingForTests,
} from "../../src/usage/models-dev-pricing";
import { resolveMatchedPrice } from "../../src/usage/cost";
import { removeTreeWithRetry } from "../helpers/remove-tree";

const originalFetch = globalThis.fetch;
let dir = "";
let previousFlag: string | undefined;

const published = {
  deepseek: { models: { "deepseek-v4-flash": { cost: { input: 0.15, output: 0.6, cache_read: 0.003 } } } },
  meta: {
    models: {
      "muse-spark-1.3": { cost: { input: 1.25, output: 4.25, cache_read: 0.15 } },
      "muse-spark-1.2": { cost: { input: 1.25, output: 4.25, cache_read: 0.15 } },
    },
  },
  opencode: { models: { "deepseek-v4.1-flash": { cost: { input: 0.3, output: 1.2, cache_read: 0.006 } } } },
};

beforeEach(() => {
  previousFlag = process.env.OPENCODEX_MODELS_DEV_PRICING;
  delete process.env.OPENCODEX_MODELS_DEV_PRICING;
  dir = mkdtempSync(join(tmpdir(), "ocx-models-dev-pricing-"));
  resetModelsDevPricingForTests();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetModelsDevPricingForTests();
  if (previousFlag === undefined) delete process.env.OPENCODEX_MODELS_DEV_PRICING;
  else process.env.OPENCODEX_MODELS_DEV_PRICING = previousFlag;
  if (dir) removeTreeWithRetry(dir);
});

function stubFetch(body: unknown, status = 200) {
  const stub = mock(async () => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  }));
  globalThis.fetch = stub as unknown as typeof fetch;
  return stub;
}

describe("models.dev pricing catalog", () => {
  test("refreshes from the public payload, caches per config dir, and resolves aliases", async () => {
    const stub = stubFetch(published);
    await refreshModelsDevPricing(dir, { force: true });

    expect(stub).toHaveBeenCalledTimes(1);
    expect(String((stub.mock.calls[0] as unknown[])[0])).toBe(MODELS_DEV_SOURCE_URL);
    expect(existsSync(join(dir, "models-dev-pricing-cache.json"))).toBe(true);
    expect(modelsDevPublishedPrice("deepseek", "deepseek-v4-flash", dir)).toEqual({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      price: { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
    });
    // opencodex exposes Meta under provider ids models.dev does not publish.
    expect(modelsDevPublishedPrice("meta-model", "muse-spark-1.3", dir)?.provider).toBe("meta");
    expect(modelsDevPublishedPrice("meta-muse", "muse-spark-1.2", dir)?.provider).toBe("meta");

    // A second call inside the TTL does not refetch.
    await refreshModelsDevPricing(dir);
    expect(stub).toHaveBeenCalledTimes(1);
  });

  test("a cached file survives a process reset and still resolves offline", async () => {
    stubFetch(published);
    await refreshModelsDevPricing(dir, { force: true });
    resetModelsDevPricingForTests();
    globalThis.fetch = mock(async () => { throw new Error("offline"); }) as unknown as typeof fetch;

    expect(modelsDevPublishedPrice("opencode", "deepseek-v4.1-flash", dir)?.price).toEqual({
      input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0,
    });
    expect(modelsDevVendorPrice("deepseek-v4-flash", dir)?.provider).toBe("deepseek");
    expect(JSON.parse(readFileSync(join(dir, "models-dev-pricing-cache.json"), "utf8")).version).toBe(1);
  });

  test("malformed or failed responses leave the previous snapshot usable", async () => {
    seedModelsDevPricingForTests({ meta: { "muse-spark-1.3": { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 } } });
    stubFetch({ meta: { models: { "muse-spark-1.3": { cost: { input: "bad" } } } } });
    await refreshModelsDevPricing(dir, { force: true });
    expect(modelsDevPublishedPrice("meta", "muse-spark-1.3", dir)?.price.input).toBe(1.25);

    globalThis.fetch = mock(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    await refreshModelsDevPricing(dir, { force: true });
    expect(modelsDevPublishedPrice("meta", "muse-spark-1.3", dir)?.price.input).toBe(1.25);
  });

  test("ranking returns at most ten deterministic candidates and honours the preferred provider", () => {
    const providers: Record<string, Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>> = {};
    for (let index = 0; index < 14; index += 1) {
      providers[`vendor-${String(index).padStart(2, "0")}`] = {
        "muse-spark-1.3": { input: index, output: 1, cacheRead: 0, cacheWrite: 0 },
      };
    }
    providers.meta = { "muse-spark-1.3": { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 } };
    providers.opencode = { "deepseek-v4.1-flash": { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 } };
    seedModelsDevPricingForTests(providers);

    const candidates = searchModelsDevPrices("muse-spark-1.3", 99, "meta-model");
    expect(candidates).toHaveLength(10);
    expect(candidates[0]).toMatchObject({ provider: "meta", model: "muse-spark-1.3" });
    expect(candidates.every(candidate => candidate.model === "muse-spark-1.3")).toBe(true);

    const spaced = searchModelsDevPrices("muse spark 1.3");
    expect(spaced[0]).toMatchObject({ provider: "meta", model: "muse-spark-1.3" });
    expect(searchModelsDevPrices("deepseek-v4.1-flash")[0]).toMatchObject({
      provider: "opencode", model: "deepseek-v4.1-flash",
    });
    expect(searchModelsDevPrices("nothing-remotely-similar-here")).toEqual([]);
  });

  test("live rows beat the frozen bundle but not an official verified correction", () => {
    seedModelsDevPricingForTests({
      deepseek: { "deepseek-v4-flash": { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 } },
      meta: { "muse-spark-1.2": { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 } },
      anthropic: { "claude-haiku-5-5": { input: 9, output: 9, cacheRead: 9, cacheWrite: 9 } },
    });

    const staleBundleRow = resolveMatchedPrice("deepseek", "deepseek-v4-flash");
    expect(staleBundleRow).toMatchObject({
      source: "modelsdev",
      cost4: { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
      modelsDevProvider: "deepseek",
    });
    expect(resolveMatchedPrice("meta-model", "muse-spark-1.2")).toMatchObject({
      source: "modelsdev", modelsDevProvider: "meta",
    });
    // A curated overlay (Venice's 1.25x mapping of the published listing) keeps its
    // precedence over the catalog copy it was derived from.
    seedModelsDevPricingForTests({
      venice: { "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 } },
    });
    expect(resolveMatchedPrice("venice", "claude-sonnet-5-5")).toMatchObject({
      source: "expected",
      cost4: { input: 2.5, output: 12.5, cacheRead: 0.125, cacheWrite: 3.125 },
    });
    // The DeepSeek page lags the model id, so the curated official vendor row prices it
    // without falling back to a serving-provider or reseller listing.
    expect(resolveMatchedPrice("deepseek", "deepseek-v4.1-flash")).toMatchObject({
      source: "expected",
      cost4: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
    });
  });

  test("prices a routing-prefixed model by its official vendor name, not the serving provider", () => {
    // `deepseek/deepseek-v4.1-flash` has no row on models.dev's deepseek page, so the
    // curated official list price is the authority; the serving provider is irrelevant.
    expect(resolveMatchedPrice("ZenMuxBug", "deepseek/deepseek-v4.1-flash")).toMatchObject({
      source: "expected",
      cost4: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
    });
    seedModelsDevPricingForTests({
      meta: { "muse-spark-1.3": { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 } },
    });
    expect(resolveMatchedPrice("MuseRouter", "meta/muse-spark-1.3")).toMatchObject({
      source: "modelsdev",
      modelsDevProvider: "meta",
      cost4: { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
    });
  });

  test("a catalog refresh busts the price memo", () => {
    seedModelsDevPricingForTests({ deepseek: { "deepseek-v4-flash": { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 } } });
    const first = resolveMatchedPrice("deepseek", "deepseek-v4-flash");
    expect(first?.cost4.input).toBe(0.15);
    const before = modelsDevPricingVersion();
    seedModelsDevPricingForTests({ deepseek: { "deepseek-v4-flash": { input: 0.2, output: 0.8, cacheRead: 0.004, cacheWrite: 0 } } });
    expect(modelsDevPricingVersion()).toBeGreaterThan(before);
    expect(resolveMatchedPrice("deepseek", "deepseek-v4-flash")?.cost4.input).toBe(0.2);
  });

  test("the opt-out flag disables the network read", async () => {
    process.env.OPENCODEX_MODELS_DEV_PRICING = "0";
    const stub = stubFetch(published);
    await refreshModelsDevPricing(dir, { force: true });
    expect(stub).not.toHaveBeenCalled();
    expect(modelsDevPublishedPrice("deepseek", "deepseek-v4-flash", dir)).toBeUndefined();
  });
});
