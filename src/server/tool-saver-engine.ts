import catalog from "./tool-saver-catalog.json";
import type { SaverCategory, SaverOptions } from "./tool-saver-filter";

const severity = /error|failed|failure|exception|traceback|fail|ts\d{4}|✖|fatal|panic|critical/i;
function regex(pattern: string): RegExp { return new RegExp(pattern.replace(/^\(\?i\)/, ""), "im"); }
const filters = catalog.map(filter => ({ ...filter,
  category: (["cloud", "infra", "docker"].includes(filter.category) ? "docker" : ["git", "build", "test", "package"].includes(filter.category) ? filter.category : "system") as SaverCategory,
  commands: (filter.match.commands ?? []).map(regex), patterns: (filter.match.patterns ?? []).map(regex),
  drops: (filter.rules.dropPatterns ?? []).map(regex), includes: (filter.rules.includePatterns ?? []).map(regex),
  collapses: (filter.rules.collapsePatterns ?? []).map(regex),
  preserves: [...(filter.preserve.errorPatterns ?? []), ...(filter.preserve.summaryPatterns ?? [])].map(regex),
})).sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
export type SaverFilter = typeof filters[number];

export function filterCatalog(options: SaverOptions = {}) {
  return filters.map(({ id, label, description, category, priority }) => ({ id, label, description, category, priority, enabled: options.filters?.[id] ?? options.categories?.[category] !== false }));
}
export function structuredOutput(text: string): boolean {
  if (!/^\s*[[{][\s\S]*[\]}]\s*$/.test(text)) return false;
  try { JSON.parse(text); return true; } catch { return false; }
}
function normalizeCommand(command: string): string {
  if (!command.startsWith("git ")) return command;
  const fields = command.trim().split(/\s+/); let i = 1;
  while (i < fields.length && fields[i]!.startsWith("-")) {
    i += ["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix"].includes(fields[i]!) ? 2 : 1;
  }
  return i >= fields.length ? command : `git ${fields.slice(i).join(" ")}`;
}
export function matchFilter(text: string, command: string, options: SaverOptions): SaverFilter | undefined {
  if (structuredOutput(text)) return undefined;
  const enabled = filters.filter(f => options.filters?.[f.id] ?? options.categories?.[f.category] !== false);
  const cmd = normalizeCommand(command.trim());
  return (cmd ? enabled.find(f => f.commands.some(r => r.test(cmd))) : undefined)
    ?? enabled.find(f => f.id !== "generic-output" && (!cmd || !f.commands.length) && f.patterns.some(r => r.test(text)))
    ?? enabled.find(f => f.id === "generic-output");
}
export function deduplicateText(text: string): string {
  const lines = text.split("\n"), result: string[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!, trimmed = line.trim(); let end = i + 1;
    while (end < lines.length && (lines[end] === line || (trimmed !== "" && lines[end]!.trim() === trimmed))) end++;
    result.push(line);
    if (end - i >= 3) result.push(`... (repeated ${end - i - 1} times)`);
    else if (end - i === 2) result.push(lines[i + 1]!);
    i = end;
  }
  return result.join("\n");
}
export function truncateLines(lines: string[], head: number, tail: number, filter?: SaverFilter): { head: string[]; middle: string[]; tail: string[]; dropped: number } {
  const beginning = lines.slice(0, head), ending = lines.slice(-tail), seen = new Set([...beginning, ...ending].map(l => l.trim()));
  const preserved: string[] = [];
  for (const line of lines.slice(head, -tail)) {
    const key = line.trim();
    if (preserved.length >= 20) break;
    if (!key || seen.has(key) || !(severity.test(line) || filter?.preserves.some(r => r.test(line)))) continue;
    seen.add(key); preserved.push(line);
  }
  return { head: beginning, middle: preserved, tail: ending, dropped: lines.length - head - tail - preserved.length };
}
export function smartTruncate(lines: string[], max: number, filter?: SaverFilter): string {
  if (lines.length <= max) return lines.join("\n");
  let head = Math.max(1, Math.floor(max * 0.6)), tail = Math.max(1, max - head);
  if (head + tail >= lines.length) { head = Math.floor(lines.length / 2); tail = lines.length - head; }
  const p = truncateLines(lines, head, tail, filter);
  return [...p.head, `... (${p.dropped} lines truncated)`, ...p.middle, ...p.tail].join("\n");
}
export function applyFilter(filter: SaverFilter, text: string, max: number): { text: string; techniques: string[] } {
  const techniques = [filter.id];
  let current = filter.rules.stripAnsi ? text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "") : text;
  for (const match of filter.rules.matchOutput ?? []) {
    if (regex(match.pattern).test(current) && !(match.unless && regex(match.unless).test(current))) return { text: match.message, techniques: [...techniques, `${filter.id}:match-output`] };
  }
  const originalCount = current.split("\n").length;
  let lines = current.split("\n").filter(line => !filter.drops.some(r => r.test(line)));
  if (filter.includes.length) {
    const kept = lines.filter(line => severity.test(line) || filter.includes.some(r => r.test(line)));
    if (kept.length) { lines = kept; techniques.push(`${filter.id}:include`); }
  }
  const seen = new Set<string>();
  lines = lines.filter(line => {
    if (!filter.collapses.some(r => r.test(line))) return true;
    const key = line.trim(); if (seen.has(key)) return false; seen.add(key); return true;
  });
  if (filter.rules.deduplicate) {
    const joined = lines.join("\n"), reduced = deduplicateText(joined);
    if (reduced !== joined) { lines = reduced.split("\n"); techniques.push(`${filter.id}:deduplicate`); }
  }
  const limit = !filter.rules.maxLines || (max > 0 && max < filter.rules.maxLines) ? max : filter.rules.maxLines;
  if (limit > 0 && lines.length > limit) {
    let head = filter.rules.headLines || Math.floor(limit / 2), tail = filter.rules.tailLines || Math.floor(limit / 2);
    if (head + tail >= lines.length) { head = Math.floor(lines.length / 2); tail = lines.length - head; }
    const p = truncateLines(lines, head, tail, filter);
    lines = [...p.head, `... (${p.dropped} lines truncated by ${filter.id})`, ...p.middle, ...p.tail]; techniques.push(`${filter.id}:truncate`);
  }
  current = lines.join("\n");
  if (!current.trim() && filter.rules.onEmpty) current = filter.rules.onEmpty;
  if (lines.length < originalCount) techniques.push(`${filter.id}:filter`);
  return { text: current, techniques };
}
// Kept for existing local callers; selection and application are distinct parity boundaries.
export function applyCatalog(text: string, command: string, options: SaverOptions, max: number) {
  const filter = matchFilter(text, command, options);
  return filter ? { ...applyFilter(filter, text, max), category: filter.category } : null;
}
