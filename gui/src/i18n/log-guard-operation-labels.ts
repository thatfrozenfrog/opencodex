import type { Locale } from "./catalogs";

export type LogGuardOperationLabelKey =
  | "applying"
  | "error.generic"
  | "error.codex_running"
  | "error.process_enumeration_failed"
  | "error.busy"
  | "error.unsupported_schema"
  | "error.unsafe_path"
  | "error.database_error"
  | "error.auto_vacuum_not_incremental"
  | "error.integrity_check_failed";

const LABELS: Record<Locale, Record<LogGuardOperationLabelKey, string>> = {
  en: {
    applying: "Applying Log Guard change…",
    "error.generic": "Could not update Codex log storage.",
    "error.codex_running": "Quit Codex before changing Codex log storage.",
    "error.process_enumeration_failed": "Could not verify that Codex is stopped. The Log Guard operation was not started.",
    "error.busy": "The Codex logs database is busy. Quit Codex and try again.",
    "error.unsupported_schema": "This Codex logs schema is not supported for this operation.",
    "error.unsafe_path": "The Codex logs database path failed the safety check.",
    "error.database_error": "Could not update the Codex logs database.",
    "error.auto_vacuum_not_incremental": "This Codex logs database is not configured for incremental vacuum, so space cannot be reclaimed without a full rebuild.",
    "error.integrity_check_failed": "The Codex logs database failed its integrity check. No space was reclaimed.",
  },
};

export function logGuardOperationLabel(locale: Locale, key: LogGuardOperationLabelKey): string {
  return LABELS[locale][key];
}
