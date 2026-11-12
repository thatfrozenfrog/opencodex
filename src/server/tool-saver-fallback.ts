import { smartTruncate } from "./tool-saver-engine";

export function grepOutput(text: string): boolean {
  const lines = text.split("\n");
  return lines.length >= 2 && lines.slice(0, 3).filter(line => line.split(":", 3).length >= 2).length >= 2;
}
export function fallbackFilter(text: string, category: string, max: number): { text: string; technique?: string } {
  const lines = text.split("\n");
  const limitedHead = (limit: number, noun: string) => lines.length <= limit ? text : `${lines.slice(0, limit).join("\n")}\n... (${lines.length - limit} more ${noun})`;
  const git = () => {
    if (/^(?:diff --git|--- a\/)/.test(text)) return { text: limitedHead(100, "lines"), technique: "git-diff-filter" };
    if (/^(?:[a-f0-9]{7,40}\s|commit\s[a-f0-9]{7,})/.test(text)) return { text: limitedHead(200, "commits"), technique: "git-log-filter" };
    if (text.includes("On branch ") || text.includes("Changes to be committed:")) return { text: lines.filter(l => !/^\s*\((?:use "git (?:add|restore|push)|commit or discard)/.test(l)).join("\n"), technique: "git-status-filter" };
    return { text };
  };
  if (category === "git") return git();
  if (category === "build") {
    if (lines.length <= max) return { text };
    const errors = lines.filter(l => /error|failed|warning/i.test(l));
    let result = smartTruncate(lines, max);
    if (errors.length > 0 && errors.length < lines.length) result = errors.length <= max ? errors.join("\n") : `${errors.slice(0, Math.floor(max / 2)).join("\n")}\n... (${errors.length - max} build diagnostics truncated)\n${errors.slice(-Math.floor(max / 2)).join("\n")}`;
    return { text: result, technique: "build-filter" };
  }
  if (category === "test") {
    if (/FAIL|failed/.test(text)) {
      const kept = lines.filter(l => !(l.trim().startsWith("at ") && l.includes("node_modules/")) && !/^(?:PASS |--- PASS:)/.test(l.trim()));
      return { text: smartTruncate(kept, max), technique: "test-filter" };
    }
    if (lines.length > max) {
      const summaries = lines.filter(l => /passed|PASS|Tests:|test result:/.test(l));
      return { text: summaries.length ? `${summaries.join("\n")}\n... (all tests passed; ${lines.length - summaries.length} verbose lines omitted)` : smartTruncate(lines, max), technique: "test-filter" };
    }
    return { text };
  }
  if (category === "package") {
    let current = text;
    for (const [pattern, threshold, label] of [[/^Requirement already satisfied:/, 2, "packages already satisfied"], [/^Compiling\s+[\w-]+/, 3, "crates compiled"]] as const) {
      const all = current.split("\n"), count = all.filter(l => pattern.test(l.trim())).length;
      if (count > threshold) current = `... (${count} ${label})\n${all.filter(l => !pattern.test(l.trim())).join("\n")}`;
    }
    return { text: smartTruncate(current.split("\n").filter(l => !/packages are looking for funding|run `npm fund`/.test(l.trim())), max), technique: "package-filter" };
  }
  if (["docker", "system", "general"].includes(category)) {
    if (/[├└]──/.test(text)) return { text: limitedHead(200, "entries"), technique: "tree-filter" };
    if (grepOutput(text)) {
      if (lines.length <= 200) return { text };
      const counts = new Map<string, number>();
      const kept = lines.filter(line => { const file = line.split(":", 1)[0]!; const n = counts.get(file) ?? 0; counts.set(file, n + 1); return n < 10; });
      return { text: kept.length < lines.length ? `${kept.join("\n")}\n... (${lines.length - kept.length} matches filtered)` : text, technique: "grep-filter" };
    }
    if (category === "general") return git();
    if (/^CONTAINER ID\s+IMAGE|^NAME\s+(?:READY\s+STATUS|TYPE\s+CLUSTER-IP)|^USER\s+PID\s+%(?:CPU|MEM)|^[dcbsp-][rwx-]{9}\s+/im.test(text)) {
      if (lines.length <= max) return { text };
      const rows = lines.slice(1), keep = Math.max(5, max - 2);
      return { text: rows.length > max ? `${[lines[0], ...rows.slice(0, keep)].join("\n")}\n... (${rows.length - keep} table entries truncated)` : smartTruncate(lines, max), technique: "system-table-filter" };
    }
  }
  return { text };
}
