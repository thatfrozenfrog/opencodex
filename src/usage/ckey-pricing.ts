import { createHash } from "node:crypto";
import { resolveProviderApiKey } from "../providers/api-key-resolve";
import { readBoundedResponseBytes } from "../lib/bounded-body";
import type { OcxConfig } from "../types";

export type CkeyPrice = { input: number; output: number; cacheRead: number; cacheWrite: number; request: number; minimum: number };
const VND_PER_USD = 25_000;
let prices = new Map<string, CkeyPrice>();
let identity = "";
let refreshedAt = 0;
let version = 0;
let flight: Promise<void> | undefined;

export function ckeyPricingVersion(): number { return version; }
export function ckeyPrice(provider: string, model: string): CkeyPrice | undefined {
  if (provider !== "ckey" && provider !== "ckey-vn") return undefined;
  return prices.get(model) ?? prices.get(model.replace("/", "-"));
}

export async function ensureCkeyPricing(config: OcxConfig): Promise<void> {
  const provider = config.providers?.ckey ?? config.providers?.["ckey-vn"];
  const base = provider?.baseUrl?.replace(/\/+$/, "").toLowerCase();
  const key = provider && ["https://api.xah.io/v1", "https://api.xah.io", "https://ckey.vn", "https://ckey.vn/api"].includes(base ?? "")
    ? resolveProviderApiKey(provider.apiKey)?.trim() : undefined;
  const nextIdentity = key ? createHash("sha256").update(key).digest("hex") : "";
  if (nextIdentity !== identity) { identity = nextIdentity; prices = new Map(); refreshedAt = 0; version++; flight = undefined; }
  if (!key || Date.now() - refreshedAt < 300_000) return;
  if (flight) return flight;
  const current = identity;
  const generation = version;
  const task = (async () => {
    try {
      const url = new URL("https://ckey.vn/api/llm/models");
      url.searchParams.set("key", key);
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
      if (!response.ok) return;
      const bytes = await readBoundedResponseBytes(response, { maxBytes: 16 * 1024 * 1024 });
      if (bytes.oversized) return;
      const body = JSON.parse(new TextDecoder().decode(bytes.bytes));
      if (body?.success !== true || !Array.isArray(body.data?.models)) return;
      const next = new Map<string, CkeyPrice>();
      for (const row of body.data.models) {
        if (typeof row?.public_name !== "string" || !row.public_name) continue;
        const values = [row.input_price_per_million_vnd, row.output_price_per_million_vnd, row.price_per_request_vnd, row.min_charge_per_request_vnd, row.cache_read_price_per_million_vnd, row.cache_write_price_per_million_vnd];
        if (!values.every(value => typeof value === "number" && Number.isFinite(value) && value >= 0)) continue;
        const [input, output, request, minimum, cacheRead, cacheWrite] = values.map(value => value / VND_PER_USD);
        const price = { input, output, request, minimum, cacheRead: row.cache_enabled ? cacheRead : input, cacheWrite: row.cache_enabled ? cacheWrite : input };
        next.set(row.public_name, price);
        next.set(row.public_name.replace("/", "-"), price);
      }
      if (identity !== current || version !== generation) return;
      prices = next;
      refreshedAt = Date.now();
      version++;
    } catch { /* Pricing is unavailable; do not expose credential-bearing errors. */ }
  })();
  flight = task;
  try { await task; } finally { if (flight === task) flight = undefined; }
}
