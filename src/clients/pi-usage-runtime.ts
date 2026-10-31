import { runtimeBaseUrl, runtimeRequest } from "../cli/runtime-api";
import type { ExportModel } from "./config-export/contracts";
import type { PiGeneratedConfig } from "./config-export";
import type { ProviderQuotaResponse } from "../providers/quota/report-cache";
import { projectPiUsage, type PiUsageReport, type PiUsageSnapshot } from "./pi-usage";

export const PI_USAGE_REFRESH_MS = 30_000;
const REQUEST_TIMEOUT_MS = 15_000;

function inferenceUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Unsupported Pi proxy URL"); }
  if (url.username || url.password || url.search || url.hash || url.protocol !== "http:") throw new Error("Unsupported Pi proxy URL");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Pi quota bridge requires a local proxy");
  // localhost and IPv4 loopback are the generated integration's equivalent spellings.
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.href;
}

/** Resolve management locally; never send management credentials to the model's base URL. */
export async function readPiUsageSnapshot(baseUrl: string, signal: AbortSignal): Promise<PiUsageSnapshot> {
  const expected = inferenceUrl(baseUrl);
  const managementOrigin = await runtimeBaseUrl();
  const init = { signal, redirect: "error" as const };
  const deps = { baseUrl: managementOrigin };
  const [models, quotas, exported] = await Promise.all([
    runtimeRequest<ExportModel[]>("/api/models", init, deps),
    runtimeRequest<ProviderQuotaResponse>("/api/provider-quotas", init, deps),
    runtimeRequest<{ config: PiGeneratedConfig }>("/api/client-config?client=pi", init, deps),
  ]);
  const provider = exported.config?.providers?.opencodex;
  if (!provider || inferenceUrl(provider.baseUrl) !== expected) throw new Error("Pi and management target different proxies");
  if (!Array.isArray(models) || !Array.isArray(quotas.reports) || !Array.isArray(provider.models)) throw new Error("Invalid opencodex quota snapshot");
  return { models, quotas, baseUrl, exportedIds: provider.models.map(model => model.id) };
}

/** One optional extension owns this cache; obsolete reads lose publication authority. */
export function createPiUsageSource(load = readPiUsageSnapshot, now = Date.now) {
  let generation = 0;
  let cached: { baseUrl: string; at: number; report: PiUsageReport } | undefined;
  let pending: { baseUrl: string; controller: AbortController; promise: Promise<PiUsageReport | null> } | undefined;

  function invalidate(): void {
    generation++;
    cached = undefined;
    pending?.controller.abort();
    pending = undefined;
  }

  async function read(baseUrl: string | undefined, signal?: AbortSignal): Promise<PiUsageReport | null> {
    if (!baseUrl || signal?.aborted) return null;
    if (cached?.baseUrl === baseUrl && now() - cached.at < PI_USAGE_REFRESH_MS) return cached.report;
    if (pending?.baseUrl === baseUrl) return pending.promise;
    invalidate();
    const epoch = generation;
    const controller = new AbortController();
    const signals = [controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...(signal ? [signal] : [])];
    const work = { baseUrl, controller, promise: Promise.resolve<PiUsageReport | null>(null) };
    work.promise = (async () => {
      try {
        const snapshot = await load(baseUrl, AbortSignal.any(signals));
        if (epoch !== generation || signals.some(item => item.aborted)) return null;
        const report = projectPiUsage(snapshot);
        cached = { baseUrl, at: now(), report };
        return report;
      } finally {
        if (pending === work) pending = undefined;
      }
    })();
    pending = work;
    return work.promise;
  }

  return { read, invalidate };
}
