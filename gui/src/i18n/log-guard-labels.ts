import type { Locale } from "./catalogs";

export type LogGuardLabelKey =
  | "inspectionOnly"
  | "externalSqliteHome"
  | "inspectionUnavailable"
  | "metricsSkippedLarge"
  | "protection"
  | "compat"
  | "quiet"
  | "disable"
  | "repair"
  | "compact"
  | "pagesUnit"
  | "compactComplete"
  | "compactPartial"
  | "confirmCompact"
  | "cancel"
  | "applying"
  | "error.generic"
  | "error.codex_running"
  | "error.process_enumeration_failed"
  | "error.busy"
  | "error.unsupported_schema"
  | "error.trigger_collision"
  | "error.unsafe_path"
  | "error.database_error"
  | "error.config_write_failed";

const LABELS: Record<Locale, Record<LogGuardLabelKey, string>> = {
  en: {
    compact: 'Compact',
    compactComplete: "Compaction complete (logical / on-disk reclaimed)",
    pagesUnit: "pages",
    compactPartial: "Compaction partial (logical / on-disk reclaimed)",
    confirmCompact: 'Confirm compaction',
    cancel: 'Cancel',
    inspectionOnly: 'Inspection only',
    externalSqliteHome: 'External SQLite storage',
    inspectionUnavailable: "Diagnostic log inspection is unavailable.",
    metricsSkippedLarge: "Row metrics skipped: the database is above {threshold}, and scanning it would stall the proxy.",
    protection: "Protection",
    compat: "Compatibility",
    quiet: "Quiet",
    disable: "Disable protection",
    repair: "Repair protection",
    applying: "Applying protection…",
    "error.generic": "Could not change Codex log protection.",
    "error.codex_running": "Quit Codex before changing log protection.",
    "error.process_enumeration_failed": "Could not verify that Codex is stopped. Protection was not changed.",
    "error.busy": "The Codex logs database is busy. Quit Codex and try again.",
    "error.unsupported_schema": "This Codex logs schema is not supported for protection.",
    "error.trigger_collision": "A reserved Log Guard trigger name is already in use. Protection was not changed.",
    "error.unsafe_path": "The Codex logs database path failed the safety check.",
    "error.database_error": "Could not update the Codex logs database.",
    "error.config_write_failed": "The database changed, but OpenCodex could not save the protection setting. Fix config storage, then run Repair.",
  },
};

export function logGuardLabel(locale: Locale, key: LogGuardLabelKey): string {
  return LABELS[locale][key];
}
