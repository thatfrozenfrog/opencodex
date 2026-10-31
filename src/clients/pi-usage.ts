import type { ExportModel } from "./config-export/contracts";
import { normalizeExportModels } from "./config-export/model-metadata";
import { anthropicModelFamily } from "../oauth/anthropic-model-family";
import { classifyModelFamilyForQuota } from "../oauth/account-quota-rank";
import type { ProviderQuotaResponse, ProviderQuotaReport } from "../providers/quota/report-cache";
import type { ProviderQuotaWindow } from "../providers/quota-types";

// The host adapter checks these structural types against Pi's UsageProvider contract.
export interface PiUsageLimit {
  id: string;
  label: string;
  scope: { provider: string; modelId: string; windowId?: string; sharedGroup: string };
  window?: { id: string; label: string; durationMs?: number; resetsAt?: number };
  amount: { unit: "percent" | "usd" | "credits"; used?: number; limit?: number; remaining?: number; usedFraction?: number };
  status?: "exhausted";
  notes: string[];
}

export interface PiUsageReport {
  provider: string;
  fetchedAt: number;
  limits: PiUsageLimit[];
  notes: string[];
}

export interface PiUsageSnapshot {
  models: ExportModel[];
  quotas: ProviderQuotaResponse;
  baseUrl: string;
  exportedIds: string[];
}

const HOUR = 3_600_000;
const WINDOWS = {
  "5h": { id: "5h", label: "5 Hour", durationMs: 5 * HOUR },
  "7d": { id: "7d", label: "7 Day", durationMs: 7 * 24 * HOUR },
  daily: { id: "daily", label: "Daily", durationMs: 24 * HOUR },
  monthly: { id: "monthly", label: "Monthly" },
} as const;

function finite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function customWindowId(window: ProviderQuotaWindow, report: ProviderQuotaReport): keyof typeof WINDOWS | undefined {
  if (window.scope === "model") return "7d"; // Producers define Anthropic family windows as seven-day limits.
  if (report.source === "google-antigravity:retrieveUserQuotaSummary"
    && /^(Gem|Cla|Argon)( \(Weekly\))?$/.test(window.label)) {
    return window.label.endsWith(" (Weekly)") ? "7d" : "5h";
  }
  if (report.source === "xpiki:key-status" || report.provider === "xpiki") {
    return "5h";
  }
  const label = window.label.trim().toLowerCase();
  if (/^(5h|5 hour|5 hours)$/.test(label)) return "5h";
  if (/^(7d|7 day|7 days|weekly)$/.test(label)) return "7d";
  if (/^(daily|24h|1d)$/.test(label)) return "daily";
  if (/^(monthly|30d)$/.test(label)) return "monthly";
  return undefined;
}

function matchesModel(window: ProviderQuotaWindow, model: ExportModel): boolean {
  if (window.modelId !== undefined) return window.modelId === model.id || window.modelId === model.namespaced;
  if (window.scope === "model") return anthropicModelFamily(model.id)?.toLowerCase() === window.label.toLowerCase();
  // These two canonical fallback buckets are produced by antigravityWindowsFromModels.
  if (model.provider === "google-antigravity" && /^(Gem|Cla)( \(Weekly\))?$/.test(window.label)) {
    return classifyModelFamilyForQuota(model.provider, model.id) === (window.label.startsWith("Gem") ? "gem" : "cla");
  }
  if (model.provider === "xpiki") {
    return window.label.startsWith(`${model.id} ·`) || window.label === model.id;
  }
  return true;
}

function baseLimit(model: ExportModel, report: ProviderQuotaReport, key: string, label: string): PiUsageLimit {
  const sharedGroup = report.provider === "xpiki" || report.source === "xpiki:key-status"
    ? `${report.provider}:shared-balance`
    : `${report.provider}:${key}`;
  return {
    id: JSON.stringify([model.namespaced, report.provider, key]),
    label: `${report.label}: ${label}`,
    scope: { provider: "opencodex", modelId: model.namespaced, sharedGroup },
    amount: { unit: "percent" },
    notes: [`Source: ${report.source}`, `Observed: ${new Date(report.quota.updatedAt).toISOString()}`,
      ...(report.observed ? ["Passive observation; not a live quota probe."] : []),
      ...(report.aggregation ? ["Provider pool capacity; not a single account's allowance."] : [])],
  };
}

function percentLimit(model: ExportModel, report: ProviderQuotaReport, key: string, percent: number | undefined,
  resetAt?: number, windowId?: keyof typeof WINDOWS, label = key): PiUsageLimit | undefined {
  if (!finite(percent)) return undefined;
  const limit = baseLimit(model, report, key, label);
  limit.amount = { unit: "percent", used: percent, limit: 100, usedFraction: percent / 100 };
  if (percent >= 100) limit.status = "exhausted";
  limit.window = { ...(windowId ? WINDOWS[windowId] : { id: key, label }),
    ...(finite(resetAt) ? { resetsAt: resetAt } : {}) };
  if (windowId) limit.scope.windowId = windowId;
  return limit;
}

function modelLimits(model: ExportModel, report: ProviderQuotaReport): PiUsageLimit[] {
  const quota = report.quota;
  const limits: PiUsageLimit[] = [];
  for (const [windowId, percent, reset] of [
    ["5h", quota.fiveHourPercent, quota.fiveHourResetAt],
    ["7d", quota.weeklyPercent, quota.weeklyResetAt],
    ["monthly", quota.monthlyPercent, quota.monthlyResetAt],
  ] as const) {
    const limit = percentLimit(model, report, windowId, percent, reset, windowId, WINDOWS[windowId].label);
    if (limit) limits.push(limit);
  }
  for (const [index, window] of (quota.customWindows ?? []).entries()) {
    if (!matchesModel(window, model)) continue;
    const limit = percentLimit(model, report, `custom:${index}:${window.label}`, window.percent,
      window.resetAt, customWindowId(window, report), window.label);
    if (!limit) continue;
    if (finite(window.passiveObservedAt)) limit.notes.push(`Window observed: ${new Date(window.passiveObservedAt).toISOString()}`);
    if (window.rejected) limit.notes.push("Upstream refused this model family.");
    limits.push(limit);
  }
  const credits = quota.creditsUsd;
  if (credits && finite(credits.used) && finite(credits.remaining) && finite(credits.limit)) {
    const limit = baseLimit(model, report, "usd", "USD credits");
    limit.amount = { unit: "usd", used: credits.used, remaining: credits.remaining,
      ...(!credits.unlimited && credits.limit > 0 ? { limit: credits.limit, usedFraction: credits.used / credits.limit } : {}) };
    if (credits.unlimited) limit.notes.push("Unlimited allowance; no utilization percentage.");
    if (finite(credits.expiresAt)) limit.notes.push(`Credits expire: ${new Date(credits.expiresAt).toISOString()}`);
    limits.push(limit);
  }
  if (finite(quota.kiroCreditsUsed) && finite(quota.kiroCreditsLimit) && quota.kiroCreditsLimit > 0) {
    const limit = baseLimit(model, report, "kiro-credits", "Plan credits");
    limit.amount = { unit: "credits", used: quota.kiroCreditsUsed, limit: quota.kiroCreditsLimit,
      remaining: Math.max(0, quota.kiroCreditsLimit - quota.kiroCreditsUsed), usedFraction: quota.kiroCreditsUsed / quota.kiroCreditsLimit };
    limits.push(limit);
  }
  // Pi's native statusline selects the first candidate for each recognized window.
  return limits.sort((a, b) => (b.amount.usedFraction ?? -1) - (a.amount.usedFraction ?? -1));
}

/** ADR-7281: exact exported selectors own usage; never infer the upstream from a display name. */
export function projectPiUsage(snapshot: PiUsageSnapshot): PiUsageReport {
  const exported = new Set(snapshot.exportedIds);
  const reports = new Map(snapshot.quotas.reports.map(report => [report.provider, report]));
  const limits: PiUsageLimit[] = [];
  for (const model of normalizeExportModels(snapshot.models)) {
    // Account-pinned native rows need account evidence, not the provider's pooled report.
    if (model.native && model.id.includes("/")) continue;
    if (!exported.has(model.namespaced)) continue;
    const report = reports.get(model.provider);
    if (!report || !finite(report.quota.updatedAt) || !Number.isFinite(new Date(report.quota.updatedAt).getTime())) continue;
    limits.push(...modelLimits(model, report));
  }
  return { provider: "opencodex", fetchedAt: snapshot.quotas.generatedAt, limits,
    notes: ["Quotas reported by opencodex. Shared provider allowances repeat per model; do not add them.",
      "Models without measured quota, including dynamic combo/policy routes, have unknown allowance."] };
}

export function piUsageStatus(report: PiUsageReport | null, modelId: string): string {
  const limits = report?.limits.filter(limit => limit.scope.modelId === modelId) ?? [];
  if (!limits.length) return "ocx quota unavailable";
  return limits.map(limit => {
    const amount = limit.amount;
    const usage = amount.usedFraction !== undefined ? `${Math.round(amount.usedFraction * 100)}% used`
      : amount.unit === "usd" ? `$${amount.remaining?.toFixed(2)} left` : "unknown";
    return `${limit.label} ${usage}`;
  }).join(" · ");
}
