import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ParsedSessionFile } from "./ocx-usage-dashboard/data";
import type { HistoryIndex } from "./ocx-usage-dashboard/history";
import type { PiUsageSnapshot } from "../src/clients/pi-usage";

const exec = promisify(execFile);
// Resolve repository root dynamically, following symlinks if ghost-linked
const selfPath = realpathSync(fileURLToPath(import.meta.url));
const EXTENSIONS_DIR = dirname(selfPath);
const ROOT = resolve(EXTENSIONS_DIR, "..");
const DASHBOARD_ENTRY = join(EXTENSIONS_DIR, "ocx-usage-dashboard", "index.ts");
const HISTORY_ENTRY = join(EXTENSIONS_DIR, "ocx-usage-dashboard", "history.ts");
const REFRESH_MS = 30_000;
const STATUS = "opencodex-usage";
type Limit = {
  label: string;
  scope: { modelId: string; sharedGroup: string };
  window?: { id?: string; label?: string; resetsAt?: number };
  amount: { unit: string; used?: number; remaining?: number; limit?: number; usedFraction?: number };
  notes: string[];
};
export type Report = { fetchedAt: number; limits: Limit[]; notes: string[]; modelProviders?: Record<string, string> };

export function upstreamProvider(provider: string, model: string, catalog: Record<string, string>): string {
  if (provider !== "opencodex") return provider;
  return catalog[model] ? `ocx/${catalog[model]}` : "ocx/unresolved";
}
const safe = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f]/g, " ");

export function withActiveCodexQuota(snapshot: PiUsageSnapshot, activeId: string | null, accounts: unknown): PiUsageSnapshot {
  const rows = Array.isArray(accounts) ? accounts : [];
  const account = rows.find(row => row && typeof row === "object"
    && (activeId === null || activeId === "__main__" ? row.isMain === true : row.id === activeId));
  const quota = account?.quota;
  const reports = snapshot.quotas.reports.filter(report => report.provider !== "openai");
  const original = snapshot.quotas.reports.find(report => report.provider === "openai");
  if (original && quota && typeof quota === "object" && Number.isFinite(quota.updatedAt)) {
    const normalized = { ...quota,
      fiveHourPercent: quota.fiveHourPercent ?? quota.shortPercent,
      fiveHourResetAt: quota.fiveHourResetAt ?? quota.shortResetAt,
    };
    reports.push({ ...original, quota: normalized, aggregation: undefined, source: "codex:active-account" });
  }
  return { ...snapshot, quotas: { ...snapshot.quotas, reports } };
}

// Run the Bun-native OCX client outside Pi's Node process. It discovers and
// authenticates management locally, then checks the inference URL matches.
async function readReport(baseUrl: string, signal: AbortSignal): Promise<Report> {
  const script = `import { readPiUsageSnapshot } from ${JSON.stringify(join(ROOT, "src/clients/pi-usage-runtime.ts"))};
import { projectPiUsage } from ${JSON.stringify(join(ROOT, "src/clients/pi-usage.ts"))};
import { runtimeBaseUrl, runtimeRequest } from ${JSON.stringify(join(ROOT, "src/cli/runtime-api.ts"))};
import { withActiveCodexQuota } from ${JSON.stringify(selfPath)};
const signal = AbortSignal.timeout(15000);
const snapshot = await readPiUsageSnapshot(process.argv[1], signal);
const baseUrl = await runtimeBaseUrl();
const init = { signal, redirect: "error" };
let accounts = [];
let activeId = null;
try {
  const first = await runtimeRequest("/api/codex-auth/active", init, { baseUrl });
  const list = await runtimeRequest("/api/codex-auth/accounts", init, { baseUrl });
  const last = await runtimeRequest("/api/codex-auth/active", init, { baseUrl });
  const valid = value => value === null || (typeof value === "string" && value.length > 0);
  if (valid(first.activeCodexAccountId) && valid(last.activeCodexAccountId)
    && first.activeCodexAccountId === last.activeCodexAccountId) {
    activeId = last.activeCodexAccountId ?? null;
    accounts = list.accounts;
  }
} catch { /* Unknown account quota must not become pooled usage. */ }
const report = projectPiUsage(withActiveCodexQuota(snapshot, activeId, accounts));
const modelProviders = Object.fromEntries(snapshot.models.map(model => [model.namespaced, model.provider]));
console.log(JSON.stringify({ ...report, modelProviders }));`;
  const { stdout } = await exec(join(homedir(), ".bun/bin/bun"), ["-e", script, baseUrl], {
    signal, timeout: 20_000, maxBuffer: 4 * 1024 * 1024,
  });
  const report = JSON.parse(stdout);
  if (!Array.isArray(report.limits) || !Number.isFinite(report.fetchedAt)) throw new Error("Invalid quota report");
  return report;
}

export function formatFooterLimit(limit: Limit): string {
  const fraction = limit.amount.usedFraction;
  if (fraction === undefined || !Number.isFinite(fraction)) return formatLimit(limit);
  const window = limit.window?.id ?? limit.window?.label ?? limit.label.split(": ").at(-1) ?? "quota";
  const label = window.replace(/^5\s*hours?$/i, "5h").replace(/^7\s*days?$/i, "7d");
  const percent = Math.round(Math.max(0, fraction) * 100);
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * 15);
  return `${percent}% ${label} [${"█".repeat(filled)}${"░".repeat(15 - filled)}]`;
}

const historyCache = new Map<string, { index: HistoryIndex; sessions: ParsedSessionFile[]; at: number }>();

export async function readHistory(baseUrl: string, signal: AbortSignal): Promise<ParsedSessionFile[]> {
  const held = historyCache.get(baseUrl);
  const cached = held && Date.now() - held.at < REFRESH_MS ? held : undefined;
  const script = `import { runtimeBaseUrl, runtimeRequest } from ${JSON.stringify(join(ROOT, "src/cli/runtime-api.ts"))};
import { fetchHistorySnapshot } from ${JSON.stringify(HISTORY_ENTRY)};
const signal = AbortSignal.timeout(180000);
const normalize = value => {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Unsupported proxy URL");
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  url.pathname = url.pathname.replace(/\\/+$/, "");
  return url.href;
};
const expected = normalize(process.argv[1]);
const baseUrl = await runtimeBaseUrl();
const init = { signal, redirect: "error" };
const exported = await runtimeRequest("/api/client-config?client=pi", init, { baseUrl });
if (!exported.config?.providers?.opencodex || normalize(exported.config.providers.opencodex.baseUrl) !== expected) throw new Error("Pi and management target different proxies");
const result = await fetchHistorySnapshot(path => runtimeRequest(path, init, { baseUrl }), signal, JSON.parse(process.argv[2]));
console.log(JSON.stringify(result));`;
  const { stdout } = await exec(join(homedir(), ".bun/bin/bun"), ["-e", script, baseUrl, JSON.stringify(cached?.index ?? null)], {
    signal, timeout: 190_000, maxBuffer: 128 * 1024 * 1024,
  });
  signal.throwIfAborted();
  let result: { sessions?: ParsedSessionFile[]; index?: HistoryIndex };
  try { result = JSON.parse(stdout); } catch { throw new Error("Invalid OCX history response"); }
  if (result.sessions === undefined && cached && result.index) return cached.sessions;
  if (!Array.isArray(result.sessions)) throw new Error("Invalid OCX history");
  if (result.index) historyCache.set(baseUrl, { index: result.index, sessions: result.sessions, at: Date.now() });
  else historyCache.delete(baseUrl);
  return result.sessions;
}

export function formatLimit(limit: Limit): string {
  const a = limit.amount;
  const amount = a.usedFraction !== undefined ? `${Math.round(a.usedFraction * 100)}% used`
    : a.unit === "usd" && a.remaining !== undefined ? `$${a.remaining.toFixed(2)} left` : "unknown";
  const reset = limit.window?.resetsAt;
  const remaining = reset ? Math.max(0, Math.ceil((reset - Date.now()) / 60_000)) : undefined;
  return safe(`${amount}${remaining === undefined ? "" : ` · reset ${remaining}m`} · ${limit.label}`);
}

export function quotaLines(report: Report | null, modelId?: string): string[] {
  if (!report) return ["OCX quotas unavailable (router stopped, mismatch, or management read failed)."];
  const unique = new Map<string, Limit>();
  for (const limit of report.limits) {
    if (modelId && limit.scope.modelId !== modelId) continue;
    // A shared allowance repeats per model. Show it once, never sum it.
    const key = limit.scope.sharedGroup;
    const previous = unique.get(key);
    if (!previous || (limit.amount.usedFraction ?? -1) > (previous.amount.usedFraction ?? -1)) {
      unique.set(key, limit);
    }
  }
  return [
    `OCX live provider quotas · ${new Date(report.fetchedAt).toLocaleTimeString()}`,
    ...[...unique.values()].map(formatLimit),
    ...(!unique.size ? ["No measured quota for this model; allowance is unknown."] : []),
    "Live quotas · Codex selected account; other providers may show pooled capacity · not additive.",
    "History: $0 cost does not mean zero tokens. Press [m] for tokens or [v] for Table.",
  ];
}

export function installOcxUsage(
  pi: ExtensionAPI,
  usageExtension: (api: ExtensionAPI, resolveProvider?: (provider: string, model: string) => string,
    loadHistory?: (signal: AbortSignal) => Promise<ParsedSessionFile[]>) => void,
  load = readReport,
  clip: (text: string, width: number) => string = text => text,
): void {
  let context: ExtensionContext | undefined;
  let report: Report | null = null;
  let modelProviders: Record<string, string> = Object.create(null);
  let selection = "";
  let refreshedAt = 0;
  let revision = 0;
  let pending: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  function reset(): void {
    revision++;
    controller?.abort();
    controller = undefined;
    pending = undefined;
    report = null;
    refreshedAt = 0;
  }

  function refresh(ctx: ExtensionContext, force = false): Promise<void> {
    context = ctx;
    const model = ctx.model;
    const key = JSON.stringify([model?.provider, model?.id, model?.baseUrl]);
    if (key !== selection) { reset(); selection = key; }
    if (model?.provider !== "opencodex") {
      if (ctx.hasUI) ctx.ui.setStatus(STATUS, undefined);
      return Promise.resolve();
    }
    if (pending) return pending;
    if (!force && Date.now() - refreshedAt < REFRESH_MS) return Promise.resolve();
    const epoch = revision;
    const abort = new AbortController();
    controller = abort;
    pending = (async () => {
      let next: Report | null = null;
      try { next = await load(model.baseUrl, abort.signal); } catch { /* Unavailable is not zero usage. */ }
      if (epoch !== revision) return;
      report = next;
      if (next?.modelProviders) modelProviders = { ...modelProviders, ...next.modelProviders };
      refreshedAt = Date.now();
      if (ctx.hasUI) {
        const limits = report?.limits.filter(l => l.scope.modelId === model.id) ?? [];
        ctx.ui.setStatus(STATUS, limits.length ? safe(limits.map(formatFooterLimit).join(" · ")) : "ocx quota unavailable");
      }
    })().finally(() => { if (epoch === revision) pending = undefined; });
    return pending;
  }

  // Wrap, rather than fork, the installed dashboard. Its collector, graphs,
  // filters, exports and historical totals continue to belong to the package.
  usageExtension(new Proxy(pi, {
    get(target, property) {
      if (property !== "registerCommand") return Reflect.get(target, property);
      return (name: string, command: Parameters<ExtensionAPI["registerCommand"]>[1]) => {
        if (name !== "usage") return target.registerCommand(name, command);
        target.registerCommand(name, {
          ...command,
          handler: async (args, ctx) => {
            void refresh(ctx);
            const ui = new Proxy(ctx.ui, {
              get(uiTarget, key) {
                if (key !== "custom") return Reflect.get(uiTarget, key);
                return (factory: (...args: any[]) => any, options: any) => uiTarget.custom(async (...factoryArgs) => {
                  const component = await factory(...factoryArgs);
                  const theme = factoryArgs[1];
                  void pending?.then(() => factoryArgs[0]?.requestRender?.());
                  return new Proxy(component, {
                    get(componentTarget, member) {
                      if (member === "render") return (width: number) => {
                        const lines = ctx.model?.provider === "opencodex" ? quotaLines(report) : [];
                        return [
                          ...componentTarget.render(width), ...(lines.length ? [""] : []),
                          ...lines.map(line => clip(theme.fg("muted", line), width)),
                        ];
                      };
                      const value = Reflect.get(componentTarget, member);
                      return typeof value === "function" ? value.bind(componentTarget) : value;
                    },
                  });
                }, options);
              },
            });
            await command.handler(args, new Proxy(ctx, {
              get(target, key) { return key === "ui" ? ui : Reflect.get(target, key); },
            }));
          },
        });
      };
    },
  }), (provider, model) => upstreamProvider(provider, model, modelProviders), signal => {
    const model = context?.model;
    if (model?.provider !== "opencodex") throw new Error("Select the opencodex router to view its history");
    return readHistory(model.baseUrl, signal);
  });

  pi.registerCommand("ocx-usage", {
    description: "Refresh OCX quotas for the selected model",
    handler: async (_args, ctx) => {
      await refresh(ctx, true);
      if (ctx.hasUI) ctx.ui.notify(quotaLines(report, ctx.model?.id).join("\n"), "info");
    },
  });
  pi.on("session_start", (_event, ctx) => {
    context = ctx;
    clearInterval(timer);
    if (!ctx.hasUI) return;
    void refresh(ctx);
    timer = setInterval(() => { if (context) void refresh(context); }, 1_000);
    timer.unref();
  });
  pi.on("model_select", (_event, ctx) => { void refresh(ctx); });
  pi.on("agent_end", (_event, ctx) => { void refresh(ctx, true); });
  pi.on("session_shutdown", () => {
    clearInterval(timer);
    timer = undefined;
    reset();
    if (context?.hasUI) context.ui.setStatus(STATUS, undefined);
    context = undefined;
  });
}

export default async function (pi: ExtensionAPI): Promise<void> {
  const { default: usageExtension } = await import(DASHBOARD_ENTRY);
  const { truncateToWidth } = await import("@earendil-works/pi-tui");
  installOcxUsage(pi, usageExtension, readReport, truncateToWidth);
}
