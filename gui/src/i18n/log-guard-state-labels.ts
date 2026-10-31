import type { Locale } from "./catalogs";

export type LogGuardSchemaState = "compatible" | "missing" | "unreadable" | "unsupported";
export type LogGuardProtectionState = "off" | "active" | "drifted" | "unsupported" | "unknown";
export type LogGuardProtectionMode = "off" | "compat" | "quiet" | "collision";

type StateLabels = {
  schema: Record<LogGuardSchemaState, string>;
  protection: Record<LogGuardProtectionState, string>;
  mode: Record<LogGuardProtectionMode, string>;
};

const LABELS: Record<Locale, StateLabels> = {
  en: {
    schema: { compatible: "Compatible", missing: "Database not found", unreadable: "Database unavailable", unsupported: "Unsupported" },
    protection: { off: "Off", active: "Active", drifted: "Needs repair", unsupported: "Unsupported", unknown: "Unknown" },
    mode: { off: "Off", compat: "Compatibility", quiet: "Quiet", collision: "Unknown" },
  },
};

export function logGuardSchemaStateLabel(locale: Locale, state: LogGuardSchemaState): string {
  return LABELS[locale].schema[state];
}

export function logGuardProtectionStateLabel(locale: Locale, state: LogGuardProtectionState): string {
  return LABELS[locale].protection[state];
}

export function logGuardProtectionModeLabel(locale: Locale, mode: LogGuardProtectionMode): string {
  return LABELS[locale].mode[mode];
}
