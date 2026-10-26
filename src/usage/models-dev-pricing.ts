/**
 * Live pricing catalog from https://models.dev/api.json (devlog plan:
 * models.dev pricing replaces the stale bundled snapshot for cost estimates).
 *
 * The bundled `src/generated/model-metadata.ts` snapshot is a frozen copy of
 * opencode's models.json, so a model released or repriced after the last
 * regeneration prices as `—` until the next release. This module keeps a
 * bounded, cached copy of the public catalog so usage estimates can resolve
 * current rows, and so the Usage model table can offer "bill as" candidates
 * when one model id matches several published listings.
 *
 * Rules:
 * - The network read happens only through {@link ensureModelsDevPricing}
 *   (management `/api/usage` and the candidate endpoint), never from a cost
 *   lookup on a request path.
 * - The fetch is fixed-origin, credential-free, redirect-disabled, bounded to
 *   16 MiB and a five-second deadline, and cached per config directory for 24h.
 * - Missing or corrupt cache, offline, oversized or malformed responses all
 *   fall back to the bundled catalogs: an estimate must never fail because a
 *   public website did.
 * - Prices are USD per 1M tokens, matching {@link Cost4}.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile } from "../config/atomic-write";
import { getConfigDir } from "../config/paths";
import { readBoundedResponseBytes } from "../lib/bounded-body";
import { resolveMetadataProvider } from "../generated/model-metadata";

const SOURCE_URL = "https://models.dev/api.json";
const FILENAME = "models-dev-pricing-cache.json";
const TTL_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_PROVIDERS = 2_000;
const MAX_MODELS_PER_PROVIDER = 5_000;
const MAX_RATE = 1_000_000;

/** Provider ids opencodex exposes under a different name than models.dev. */
const PROVIDER_ALIASES: Record<string, string> = {
  "meta-model": "meta",
  "meta-muse": "meta",
  "opencode-zen": "opencode",
};

/** A published four-rate price in USD per 1M tokens. */
export interface ModelsDevPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelsDevCandidate {
  provider: string;
  model: string;
  price: ModelsDevPrice;
}

export interface ModelsDevPriceSnapshot {
  fetchedAt: number;
  providers: Map<string, Map<string, ModelsDevPrice>>;
}

type SerializedSnapshot = {
  version: 1;
  fetchedAt: number;
  providers: Record<string, Record<string, [number, number, number, number]>>;
};

type CacheState = {
  snapshot?: ModelsDevPriceSnapshot | null;
  inFlight?: Promise<void>;
  retryAfter: number;
};

const cacheByConfigDir = new Map<string, CacheState>();
let injectedSnapshot: ModelsDevPriceSnapshot | undefined;
let catalogVersion = 0;

function cacheState(configDir: string): CacheState {
  let state = cacheByConfigDir.get(configDir);
  if (!state) {
    state = { retryAfter: 0 };
    cacheByConfigDir.set(configDir, state);
  }
  return state;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function rate(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_RATE
    ? value : undefined;
}

function parsePrice(value: unknown): ModelsDevPrice | undefined {
  // Published rows are objects with snake_case keys; the on-disk cache stores
  // the compact [input, output, cacheRead, cacheWrite] tuple.
  const row = record(value);
  const tuple = Array.isArray(value) ? value : undefined;
  const input = rate(tuple ? tuple[0] : row?.input);
  const output = rate(tuple ? tuple[1] : row?.output);
  if (input === undefined || output === undefined) return undefined;
  return {
    input,
    output,
    cacheRead: rate(tuple ? tuple[2] : row?.cache_read ?? row?.cacheRead) ?? 0,
    cacheWrite: rate(tuple ? tuple[3] : row?.cache_write ?? row?.cacheWrite) ?? 0,
  };
}

/** Parse the published provider map. Rows without a usable cost are omitted. */
function parseProviders(value: unknown, published: boolean): Map<string, Map<string, ModelsDevPrice>> {
  const providers = new Map<string, Map<string, ModelsDevPrice>>();
  for (const [provider, entry] of Object.entries(record(value) ?? {}).slice(0, MAX_PROVIDERS)) {
    if (provider.length > 256) continue;
    const rawModels = published ? record(record(entry)?.models) : record(entry);
    if (!rawModels) continue;
    const models = new Map<string, ModelsDevPrice>();
    for (const [id, model] of Object.entries(rawModels).slice(0, MAX_MODELS_PER_PROVIDER)) {
      if (id.length > 256) continue;
      const price = parsePrice(published ? record(model)?.cost : model);
      if (price) models.set(id, price);
    }
    if (models.size) providers.set(provider, models);
  }
  return providers;
}

function loadSnapshot(configDir: string, state: CacheState): ModelsDevPriceSnapshot | null {
  if (state.snapshot !== undefined) return state.snapshot;
  state.snapshot = null;
  try {
    const raw = record(JSON.parse(readFileSync(join(configDir, FILENAME), "utf8")));
    if (raw?.version !== 1 || typeof raw.fetchedAt !== "number"
      || !Number.isFinite(raw.fetchedAt) || !record(raw.providers)) return state.snapshot;
    const providers = parseProviders(raw.providers, false);
    if (!providers.size) return state.snapshot;
    catalogVersion += 1;
    state.snapshot = { fetchedAt: raw.fetchedAt, providers };
  } catch { /* Missing or corrupt optional pricing leaves bundled rows in place. */ }
  return state.snapshot;
}

function serialize(snapshot: ModelsDevPriceSnapshot): string {
  const providers: SerializedSnapshot["providers"] = {};
  for (const [provider, models] of snapshot.providers) {
    const rows: Record<string, [number, number, number, number]> = {};
    for (const [id, price] of models) rows[id] = [price.input, price.output, price.cacheRead, price.cacheWrite];
    providers[provider] = rows;
  }
  const body: SerializedSnapshot = { version: 1, fetchedAt: snapshot.fetchedAt, providers };
  return JSON.stringify(body) + "\n";
}

/** Monotonic content version; retained usage aggregates rebuild when it moves. */
export function modelsDevPricingVersion(): number {
  return catalogVersion;
}

/** The provider key this catalog is keyed by, following opencodex aliases. */
export function modelsDevProviderKey(provider: string): string {
  const resolved = resolveMetadataProvider(provider) ?? provider;
  return (PROVIDER_ALIASES[resolved] ?? resolved).toLowerCase();
}

function snapshotFor(configDir: string): ModelsDevPriceSnapshot | null {
  if (injectedSnapshot !== undefined) return injectedSnapshot;
  return loadSnapshot(configDir, cacheState(configDir));
}

/**
 * Exact published price for a provider/model pair. `provider` is an
 * opencodex provider id; aliases are applied before lookup. Case-insensitive
 * model matching covers wire ids whose casing drifted upstream, but never
 * fuzzy-matches a different model.
 */
export function modelsDevPublishedPrice(
  provider: string,
  modelId: string,
  configDir = getConfigDir(),
): ModelsDevCandidate | undefined {
  const snapshot = snapshotFor(configDir);
  if (!snapshot) return undefined;
  const key = modelsDevProviderKey(provider);
  const models = snapshot.providers.get(key);
  if (!models) return undefined;
  const exact = models.get(modelId);
  if (exact) return { provider: key, model: modelId, price: exact };
  const lower = modelId.toLowerCase();
  for (const [id, price] of models) {
    if (id.toLowerCase() === lower) return { provider: key, model: id, price };
  }
  return undefined;
}

/**
 * Cross-provider canonical-vendor fallback, matching the bundled policy: a
 * model follows its official vendor's list price. Only vendors here are
 * considered, so a reseller listing never silently becomes the estimate.
 */
const VENDOR_PRIORITY = [
  "anthropic", "openai", "google", "moonshot", "minimax", "deepseek", "xai",
  "zai", "mistral", "cerebras", "xiaomi", "meta",
] as const;

export function modelsDevVendorPrice(
  modelId: string,
  configDir = getConfigDir(),
): ModelsDevCandidate | undefined {
  const snapshot = snapshotFor(configDir);
  if (!snapshot) return undefined;
  for (const key of VENDOR_PRIORITY) {
    const models = snapshot.providers.get(key);
    if (!models) continue;
    const exact = models.get(modelId)
      ?? (modelId.includes(".") ? models.get(modelId.replaceAll(".", "-")) : undefined);
    if (exact) return { provider: key, model: modelId, price: exact };
  }
  return undefined;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function modelTail(id: string): string {
  const slash = id.lastIndexOf("/");
  return slash === -1 ? id : id.slice(slash + 1);
}

/** Bounded edit distance; always ≤ limit. */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const previous = new Array<number>(b.length + 1);
  const current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowMin = current[0]!;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      rowMin = Math.min(rowMin, current[j]!);
    }
    if (rowMin > limit) return limit + 1;
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j]!;
  }
  return previous[b.length]!;
}

const SEARCH_LIMIT = 10;
const LEVENSHTEIN_MIN_LENGTH = 6;

function matchScore(provider: string, id: string, query: string): number {
  const raw = query.trim().toLowerCase();
  const wanted = normalize(query);
  const idLower = id.trim().toLowerCase();
  const idNormalized = normalize(id);
  const tail = normalize(modelTail(id));
  const full = `${provider.toLowerCase()}/${idLower}`;
  if (!wanted) return -1;
  if (full === raw || full === wanted) return 110;
  if (idLower === raw) return 104;
  if (idNormalized === wanted) return 100;
  if (tail === wanted) return 96;
  if (idLower.includes(raw)) return 80;
  if (idNormalized.includes(wanted)) return 78;
  if (raw.includes(tail)) return 70;
  if (tail.includes(wanted)) return 68;
  const distance = wanted.length >= LEVENSHTEIN_MIN_LENGTH
    ? editDistance(idNormalized, wanted, 2)
    : 3;
  if (distance <= 2) return 60 - distance;
  return -1;
}

/**
 * Rank published listings for a model name. The query may be a bare model id
 * (`muse-spark-1.3`), a provider-prefixed id (`opencode/deepseek-v4.1-flash`),
 * or a near miss; the caller decides which listing to bill as. Never more than
 * ten results, sorted by match quality then provider/model for determinism.
 */
export function searchModelsDevPrices(
  query: string,
  limit = SEARCH_LIMIT,
  preferredProvider?: string,
  configDir = getConfigDir(),
): ModelsDevCandidate[] {
  const snapshot = snapshotFor(configDir);
  if (!snapshot) return [];
  const wantedProvider = preferredProvider === undefined ? undefined : modelsDevProviderKey(preferredProvider);
  const scored: Array<{ candidate: ModelsDevCandidate; score: number }> = [];
  for (const [provider, models] of snapshot.providers) {
    for (const [model, price] of models) {
      let score = matchScore(provider, model, query);
      if (score < 0) continue;
      if (provider === wantedProvider) score += 3;
      scored.push({ candidate: { provider, model, price }, score });
    }
  }
  scored.sort((a, b) => b.score - a.score
    || (a.candidate.provider < b.candidate.provider ? -1 : a.candidate.provider > b.candidate.provider ? 1 : 0)
    || (a.candidate.model < b.candidate.model ? -1 : a.candidate.model > b.candidate.model ? 1 : 0));
  const bounded = Number.isFinite(limit) ? Math.max(1, Math.min(SEARCH_LIMIT, Math.trunc(limit))) : SEARCH_LIMIT;
  return scored.slice(0, bounded).map(entry => entry.candidate);
}

/**
 * Refresh once per day, coalesced per config directory and bounded. A stale
 * snapshot remains usable; a request only waits when there is no snapshot yet.
 */
export async function refreshModelsDevPricing(
  configDir = getConfigDir(),
  options: { force?: boolean } = {},
): Promise<void> {
  if (process.env["OPENCODEX_MODELS_DEV_PRICING"] === "0") return;
  const state = cacheState(configDir);
  const current = state.snapshot ?? loadSnapshot(configDir, state);
  if (!options.force && current && Date.now() - current.fetchedAt < TTL_MS) return;
  if (Date.now() < state.retryAfter) return;
  if (state.inFlight) return state.inFlight;
  const path = join(configDir, FILENAME);
  state.inFlight = (async () => {
    try {
      const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
      const response = await fetch(SOURCE_URL, {
        headers: { accept: "application/json", "user-agent": "opencodex" },
        redirect: "error",
        signal,
      });
      if (!response.ok) return;
      const body = await readBoundedResponseBytes(response, { maxBytes: MAX_BODY_BYTES, signal });
      if (body.oversized) return;
      const raw = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.bytes)));
      const providers = parseProviders(raw, true);
      if (!providers.size) return;
      const snapshot: ModelsDevPriceSnapshot = { fetchedAt: Date.now(), providers };
      if (injectedSnapshot === undefined) state.snapshot = snapshot;
      catalogVersion += 1;
      try { atomicWriteFile(path, serialize(snapshot)); } catch { /* Memory still serves pricing. */ }
    } catch { /* Offline or malformed: bundled/overlay rows stay authoritative. */ }
    finally { state.retryAfter = Date.now() + RETRY_MS; }
  })().finally(() => { state.inFlight = undefined; });
  return state.inFlight;
}

/**
 * Usage-path entry point: wait for the first catalog, background-refresh a
 * stale one. Returns only after the state needed to price this response is
 * settled, so a first visit is not served a snapshot the process is about to
 * replace.
 */
export async function ensureModelsDevPricing(configDir = getConfigDir()): Promise<void> {
  if (process.env["OPENCODEX_MODELS_DEV_PRICING"] === "0") return;
  const state = cacheState(configDir);
  const current = state.snapshot ?? loadSnapshot(configDir, state);
  if (!current) {
    await refreshModelsDevPricing(configDir);
    return;
  }
  if (Date.now() - current.fetchedAt >= TTL_MS && Date.now() >= state.retryAfter && !state.inFlight) {
    void refreshModelsDevPricing(configDir);
  }
}

/** Test seam: replace the catalog without network or disk. */
export function seedModelsDevPricingForTests(providers: Record<string, Record<string, ModelsDevPrice>>): void {
  const map = new Map<string, Map<string, ModelsDevPrice>>();
  for (const [provider, models] of Object.entries(providers)) {
    map.set(provider, new Map(Object.entries(models)));
  }
  injectedSnapshot = { fetchedAt: Date.now(), providers: map };
  catalogVersion += 1;
}

export function resetModelsDevPricingForTests(): void {
  injectedSnapshot = undefined;
  cacheByConfigDir.clear();
  catalogVersion += 1;
}

export const MODELS_DEV_SOURCE_URL = SOURCE_URL;
