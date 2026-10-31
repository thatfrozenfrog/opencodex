/**
 * English token-count formatting, shared by Dashboard/Usage/Logs.
 */
/** Trim a trailing ".0"/".00" so 12.00만 renders as 12만. */
function trim(s: string): string {
  return s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

export function formatTokens(n: number, _locale?: string): string {
  if (n < 10_000) return String(n);
  if (n < 1_000_000) return `${trim((n / 1000).toFixed(1))}K`;
  if (n < 1_000_000_000) return `${trim((n / 1_000_000).toFixed(1))}M`;
  if (n < 1_000_000_000_000) return `${trim((n / 1_000_000_000).toFixed(1))}B`;
  return `${trim((n / 1_000_000_000_000).toFixed(1))}T`;
}
