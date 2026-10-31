import type { Locale } from "./catalogs";

type CompatibilityFieldLabels = {
  maxEvidenceAgeMs: string;
  unknownEvidence: string;
  degradedEvidence: string;
};

/**
 * Small closed translation surface for the CL-06 compatibility editor fields.
 * Keeping all supported locales together prevents raw config keys from leaking
 * into the UI without widening the compile-checked base catalog for three
 * CL-06-only labels.
 */
export const ROUTING_COMPATIBILITY_FIELD_LABELS: Record<Locale, CompatibilityFieldLabels> = {
  en: {
    maxEvidenceAgeMs: "Maximum evidence age (ms)",
    unknownEvidence: "Unknown evidence",
    degradedEvidence: "Degraded evidence",
  },
};
