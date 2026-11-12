const stats = { results: 0, changed: 0, bytesBefore: 0, bytesAfter: 0 };

/** Aggregate only; never retain tool output, commands, identities or credentials. */
export function observeToolCompression(before: string, after: string): void {
  stats.results++;
  if (before === after) return;
  stats.changed++;
  stats.bytesBefore += Buffer.byteLength(before);
  stats.bytesAfter += Buffer.byteLength(after);
}

export function toolCompressionMetrics() {
  return { ...stats, savedBytes: stats.bytesBefore - stats.bytesAfter };
}
