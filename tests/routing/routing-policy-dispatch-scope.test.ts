import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OcxConfig } from "../../src/types";
import { createTranslatorBudget } from "../../src/lib/translator-budget";
import { handleResponsesWithPolicyFallback, type PolicyFallbackDeps } from "../../src/server/responses/policy-fallback";
import { prepareResponsesRequest } from "../../src/server/responses/request-prepare";
import type { ResponsesAdmissionState } from "../../src/server/responses/core-options";
import { beginRequestAttempt, type RequestLogContext } from "../../src/server/request-log";
import { releaseUpstreamHostAdmission } from "../../src/codex/upstream-host-health";
import { removeTreeWithRetry } from "../helpers/remove-tree";
import { closeRequestHistoryIndex } from "../../src/routing/history/indexer";

const originalFetch = globalThis.fetch;
let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ocx-policy-scope-"));
  previousHome = process.env.OPENCODEX_HOME;
  process.env.OPENCODEX_HOME = home;
  process.env.CODEX_HOME = home;
  globalThis.fetch = (() => { throw new Error("unexpected network access in policy scope fixture"); }) as unknown as typeof fetch;
  closeRequestHistoryIndex();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  closeRequestHistoryIndex();
  removeTreeWithRetry(home);
  if (previousHome === undefined) delete process.env.OPENCODEX_HOME;
  else process.env.OPENCODEX_HOME = previousHome;
});

function configFor(ids = ["a", "b", "c", "d"]): OcxConfig {
  return {
    port: 0, defaultProvider: "a", multiAgentGuidanceEnabled: false,
    providers: Object.fromEntries([...ids, "outside"].map(id => [id, {
      adapter: "openai-chat", baseUrl: `https://${id}.example/v1`, authMode: "key", apiKey: "fixture-key",
      models: ["model"], modelContextWindows: { model: 200_000 },
    }])),
    routingProfiles: { daily: { candidates: ids.map(provider => ({ provider, model: "model" })) } },
  } as OcxConfig;
}

/** Exercise the real parser, route selection, subagent recovery, normalization and auth preparation.
 * Only physical dispatch is replaced, so no fixture can fall through to a real provider. */
async function execute(config: OcxConfig, options: {
  spawn?: boolean; failures?: number; selector?: string;
  onDispatch?: (context: RequestLogContext) => void;
} = {}) {
  const destinations: string[] = [];
  const selectors: string[] = [];
  const scopes: Array<ReadonlySet<string> | undefined> = [];
  const routeKinds: string[] = [];
  const log: RequestLogContext = { model: "", provider: "", attempts: [] };
  let comboDispatches = 0;
  const runCore: NonNullable<PolicyFallbackDeps["runCore"]> = async (req, currentConfig, ctx, coreOptions = {}) => {
    selectors.push((await req.clone().json() as { model: string }).model);
    const budget = createTranslatorBudget();
    const admission: ResponsesAdmissionState = { pendingHostAdmissionLease: null, authCtx: { kind: "main", accountId: null } };
    try {
      const prepared = await prepareResponsesRequest({ req, config: currentConfig, logCtx: ctx,
        options: { ...coreOptions, translatorBudget: budget } }, admission, {
        handleResponses: async () => { throw new Error("unexpected recursive dispatch"); },
        handleComboResponses: async () => { comboDispatches += 1; throw new Error("policy candidate entered a combo"); },
      });
      if (prepared instanceof Response) return prepared;
      destinations.push(`${prepared.route.providerName}/${prepared.parsed.modelId}`);
      routeKinds.push(prepared.route.routeKind);
      scopes.push(ctx.policyEligibility);
      const attempt = beginRequestAttempt(destinations.length, prepared.route.providerName, prepared.parsed.modelId, "test");
      ctx.attempts!.push(attempt);
      ctx.activeAttempt = attempt;
      ctx.activeAttemptStartedAt = Date.now();
      options.onDispatch?.(ctx);
      return destinations.length <= (options.failures ?? 1)
        ? Response.json({ error: { type: "rate_limit_error", message: "fixture busy" } }, { status: 429 })
        : Response.json({ status: "completed" });
    } finally {
      if (admission.pendingHostAdmissionLease) releaseUpstreamHostAdmission(admission.pendingHostAdmissionLease);
      budget.dispose();
    }
  };
  const response = await handleResponsesWithPolicyFallback(new Request("http://localhost/v1/responses", {
    method: "POST", headers: { "content-type": "application/json", ...(options.spawn ? { "x-openai-subagent": "collab_spawn" } : {}) },
    body: JSON.stringify({ model: options.selector ?? "policy/daily", input: "hello", stream: false }),
  }), config, log, {}, { runCore });
  return { response, destinations, selectors, log, scopes, comboDispatches, routeKinds };
}

describe("policy scope through real request preparation", () => {
  test.each([false, true])("a concrete retry ignores a colliding combo alias (redirects=%s)", async redirects => {
    const config = configFor();
    config.combos = { hijack: { alias: "b/model", strategy: "round-robin", targets: [
      { provider: "outside", model: "model" }, { provider: "d", model: "model" },
    ] } };
    if (redirects) config.blockedModelRedirects = { "unrelated/model": "a/model" };
    const result = await execute(config);
    expect(result.response.status).toBe(200);
    expect(result.destinations).toEqual(["a/model", "b/model"]);
    expect(result.comboDispatches).toBe(0);
    // Compaction recovery reads the physical route kind, not the log's preserved decision.
    expect(result.routeKinds).toEqual(["policy", "policy"]);
    expect(result.log.routeDecision?.routeKind).toBe("policy");
    expect(result.scopes[1]).toBe(result.scopes[0]);
  });

  test("redirected candidates do not send the same physical destination twice", async () => {
    const config = configFor();
    config.blockedModelRedirects = { "b/model": "c/model" };
    const result = await execute(config, { failures: 2 });
    expect(result.response.status).toBe(200);
    expect(result.destinations).toEqual(["a/model", "c/model", "d/model"]);
    expect(result.selectors).toEqual(["policy/daily", "b/model", "d/model"]);
    expect(result.log.attempts).toHaveLength(3);
  });

  test("an initially redirected selection and later redirects cannot revisit the initial destination", async () => {
    const config = configFor();
    config.blockedModelRedirects = { "a/model": "b/model", "c/model": "b/model" };
    const result = await execute(config);
    expect(result.destinations).toEqual(["b/model", "d/model"]);
    expect(result.selectors).toEqual(["policy/daily", "d/model"]);
  });

  test.each(["model", "model-mini"])("a declined policy shadow target does not scope the %s request", async selector => {
    const config = configFor(["a", "b"]);
    config.providers.a!.models = ["model", "model-mini"];
    // The source prefix resolves on provider a and policy/daily selects a/model, so the targets
    // intersect and interception is declined. "model-mini" also sits outside the profile's
    // eligibility, which the probe used to capture and then refuse with a 409.
    config.shadowCallIntercept = { enabled: true, model: "policy/daily", sourceModels: ["model"] };
    const result = await execute(config, { selector, failures: 0 });
    expect(result.response.status).toBe(200);
    expect(result.destinations).toEqual([`a/${selector}`]);
    expect(result.routeKinds).toEqual(["explicit-provider"]);
    expect(result.scopes).toEqual([undefined]);
    expect(result.log.routeDecision?.routeKind).toBe("explicit-provider");
    expect(result.log.shadowCallRewrittenFrom).toBeUndefined();
  });

  test("redirect membership includes eligible candidates beyond the bounded trace", async () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "last"];
    const config = configFor(ids);
    config.blockedModelRedirects = { "b/model": "last/model" };
    const result = await execute(config);
    expect(result.destinations).toEqual(["a/model", "last/model"]);
    expect(result.log.routeDecision?.candidates.some(candidate => candidate.provider === "last")).toBe(false);
    expect(result.log.policyEligibility?.has("last\u0000model")).toBe(true);
  });

  test("an admitted virtual model keeps its wire mapping without expanding policy membership", async () => {
    const config = configFor(["a"]);
    config.providers["openai-apikey"] = {
      adapter: "openai-responses", baseUrl: "https://api.openai.com/v1", authMode: "key", apiKey: "fixture-key",
      models: ["gpt-5.6-sol-pro", "gpt-5.6-sol"],
    };
    config.routingProfiles!.daily.candidates.push({ provider: "openai-apikey", model: "gpt-5.6-sol-pro" });
    const result = await execute(config);
    expect(result.response.status).toBe(200);
    expect(result.destinations).toEqual(["a/model", "openai-apikey/gpt-5.6-sol"]);
    expect(result.log.policyEligibility?.has("openai-apikey\u0000gpt-5.6-sol-pro")).toBe(true);
    expect(result.log.policyEligibility?.has("openai-apikey\u0000gpt-5.6-sol")).toBe(false);
  });

  test("virtual and wire-model candidates do not repeat one physical destination", async () => {
    const config = configFor(["a"]);
    config.providers["openai-apikey"] = {
      adapter: "openai-responses", baseUrl: "https://api.openai.com/v1", authMode: "key", apiKey: "fixture-key",
      models: ["gpt-5.6-sol-pro", "gpt-5.6-sol"],
    };
    config.routingProfiles!.daily.candidates = [
      { provider: "openai-apikey", model: "gpt-5.6-sol-pro" },
      { provider: "openai-apikey", model: "gpt-5.6-sol" },
      { provider: "a", model: "model" },
    ];
    const result = await execute(config);
    expect(result.destinations).toEqual(["openai-apikey/gpt-5.6-sol", "a/model"]);
    expect(result.selectors).toEqual(["policy/daily", "a/model"]);
  });
});
