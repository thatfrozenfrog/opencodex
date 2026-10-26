import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { UsageProvider } from "@oh-my-pi/pi-ai";
import { createOmpUsageSource, OMP_USAGE_REFRESH_MS } from "../src/clients/omp-usage-runtime";
const PROVIDER = "opencodex";
const STATUS_KEY = "opencodex-usage";
/** Optional OMP bridge. See structure/decisions/ADR-7281-omp-model-usage.md. */
export default function opencodexUsage(pi: ExtensionAPI): void {
  const source = createOmpUsageSource();
  let context: ExtensionContext | undefined;
  let timer: NodeJS.Timeout | undefined;
  let selection = "";
  let refreshedAt = 0;
  let revision = 0;
  let refreshing = false;

  const usage: UsageProvider = {
    id: PROVIDER,
    cacheVersion: 1,
    async fetchUsage(params) {
      try { return await source.read(params.baseUrl, params.signal); }
      catch { return null; }
    },
  };
  pi.registerProvider(PROVIDER, { usage, apiKey: "opencodex-loopback" });

  async function refresh(force = false): Promise<void> {
    const ctx = context;
    if (!ctx) return;
    const model = ctx.model;
    const key = model ? JSON.stringify([model.provider, model.id, model.baseUrl]) : "";
    const changed = key !== selection;
    if (changed || force) {
      selection = key;
      refreshedAt = 0;
      revision++;
      source.invalidate();
    }
    if (model?.provider !== PROVIDER || (refreshing && !changed && !force)) return;
    if (!changed && !force && Date.now() - refreshedAt < OMP_USAGE_REFRESH_MS) return;
    const epoch = revision;
    refreshing = true;
    refreshedAt = Date.now();
    try {
      await ctx.modelRegistry.authStorage.usage.invalidate(PROVIDER);
      await source.read(model.baseUrl);
    } catch {
      // Background refresh failure; next attempt will retry
    } finally {
      refreshing = false;
    }
  }

  function start(ctx: ExtensionContext): void {
    context = ctx;
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
    // Supply a usage-only credential, never override the model's inference key.
    ctx.modelRegistry.authStorage.usage.setProvider(PROVIDER, usage, "opencodex-loopback");
    clearInterval(timer);
    timer = setInterval(() => { void refresh(); }, 1_000);
    timer.unref();
    void refresh(true);
  }

  pi.on("session_start", (_event, ctx) => { start(ctx); });
  pi.on("session_switch", (_event, ctx) => { start(ctx); });
  pi.on("agent_end", () => { void refresh(true); });
  pi.on("session_shutdown", () => {
    revision++;
    clearInterval(timer);
    timer = undefined;
    source.invalidate();
    if (context?.hasUI) context.ui.setStatus(STATUS_KEY, undefined);
    context = undefined;
  });
}
