import type { Locale } from "./shared";

export type VisionReasoningLabelLevel = "low" | "medium" | "high" | "xhigh" | "max";

const VISION_REASONING_LABELS = {
  en: { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Maximum" },
} satisfies Record<Locale, Record<VisionReasoningLabelLevel, string>>;

export function visionReasoningLabel(locale: Locale, level: VisionReasoningLabelLevel): string {
  return VISION_REASONING_LABELS[locale][level];
}
