import prompts from "./tool-saver-prompts.json";
import patterns from "./tool-saver-language-patterns.json";
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Rec : undefined;
const regex = (s: string) => new RegExp(s.replace(/^\(\?i\)/, ""), "i");
const languagePatterns = Object.fromEntries(Object.entries(patterns).map(([k, v]) => [k, regex(v)]));
export interface SaverInstructions {
  caveman?: boolean;
  cavemanLevel?: "lite" | "full" | "ultra" | "wenyan-lite" | "wenyan" | "wenyan-ultra";
  cavemanLanguage?: "en" | "id";
  cavemanAutoClarity?: boolean;
  cavemanInputMode?: boolean;
  cavemanPreserveKeywords?: string;
  ponytail?: boolean;
  ponytailLevel?: "lite" | "full" | "ultra";
  adhd?: boolean;
  adhdLevel?: "lite" | "full";
}
export function compressInputPrompt(text: string, keywords = ""): string {
  const original = text.trim(); let current = original;
  const preserved = keywords.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  for (const key of ["reGreetingLead", "reRequestLead", "rePleasantTail"]) {
    const match = languagePatterns[key]!.exec(current);
    if (match && !preserved.some(k => match[0].toLowerCase().includes(k))) current = (current.slice(0, match.index) + current.slice(match.index + match[0].length)).trim();
  }
  return current.replace(/^[,;:\- ]+/, "") || original;
}
function bypass(body: Rec): boolean {
  const messages = Array.isArray(body.messages) ? body.messages : Array.isArray(body.input) ? body.input : [];
  return messages.slice(-3).some(item => {
    const content = rec(item)?.content;
    const texts = typeof content === "string" ? [content] : Array.isArray(content) ? content.map(part => rec(part)?.text).filter((t): t is string => typeof t === "string") : [];
    return texts.some(text => ["reDestructiveCmd", "reSecurityRisk", "reDetailedReq"].some(key => languagePatterns[key]!.test(text)));
  });
}
export function saverPrompt(settings: SaverInstructions): string {
  const level = (value: string | undefined) => value === "lite" ? "Lite" : value === "ultra" ? "Ultra" : "Full";
  const wenyan = settings.cavemanLevel === "wenyan-lite" ? "CavemanWenyanLite" : settings.cavemanLevel === "wenyan-ultra" ? "CavemanWenyanUltra" : settings.cavemanLevel === "wenyan" ? "CavemanWenyan" : undefined;
  const key = settings.cavemanLanguage === "id" ? `Caveman${level(settings.cavemanLevel)}ID` : wenyan ?? `Caveman${level(settings.cavemanLevel)}`;
  return [settings.caveman ? prompts[key as keyof typeof prompts] : "", settings.ponytail ? prompts[`Ponytail${level(settings.ponytailLevel)}` as keyof typeof prompts] : "", settings.adhd ? settings.adhdLevel === "lite" ? prompts.ADHDLite : prompts.ADHDFull : ""].filter(Boolean).join("\n\n");
}
function carries(content: unknown, prompt: string): boolean {
  return typeof content === "string" ? content.includes(prompt) : Array.isArray(content) && content.some(part => carries(typeof part === "string" ? part : rec(part)?.text, prompt));
}
function inject(root: Rec, prompt: string, claude: boolean): void {
  if (claude) {
    if (carries(root.system, prompt)) return;
    if (Array.isArray(root.system)) {
      let index = -1; root.system.forEach((part, i) => { if (rec(part)?.cache_control != null) index = i; });
      root.system.splice(index < 0 ? root.system.length : index, 0, { type: "text", text: prompt });
    } else if (root.system === undefined || root.system === null || typeof root.system === "string") root.system = root.system ? `${root.system}\n\n${prompt}` : prompt;
    return;
  }
  if (typeof root.instructions === "string") {
    if (!root.instructions.includes(prompt)) root.instructions = root.instructions ? `${root.instructions}\n\n${prompt}` : prompt;
    return;
  }
  const responses = Array.isArray(root.input);
  const items = responses ? root.input : root.messages;
  if (!Array.isArray(items)) return;
  const current = items.map(rec).find(item => item && (!responses || item.type === "message") && (item.role === "system" || item.role === "developer"));
  if (current && carries(current.content, prompt)) return;
  const block = { type: responses ? "input_text" : "text", text: prompt };
  if (!current) items.unshift(responses ? { type: "message", role: "system", content: [block] } : { role: "system", content: prompt });
  else if (Array.isArray(current.content)) current.content.push(block);
  else current.content = responses ? [...(typeof current.content === "string" ? [{ type: "input_text", text: current.content }] : []), block] : typeof current.content === "string" && current.content ? `${current.content}\n\n${prompt}` : prompt;
}
export function injectSaverInstructions(body: unknown, settings: SaverInstructions, wire?: "messages"): void {
  const root = rec(body); if (!root) return;
  if (settings.cavemanInputMode) {
    const items = Array.isArray(root.messages) ? root.messages : Array.isArray(root.input) ? root.input : [];
    for (const value of items) {
      const msg = rec(value); if (msg?.role !== "user") continue;
      if (typeof msg.content === "string" && msg.content) msg.content = compressInputPrompt(msg.content, settings.cavemanPreserveKeywords);
      else if (Array.isArray(msg.content)) for (const value of msg.content) { const part = rec(value); if (part?.type === "text" && typeof part.text === "string" && part.text) part.text = compressInputPrompt(part.text, settings.cavemanPreserveKeywords); }
    }
  }
  const effective = settings.caveman && settings.cavemanAutoClarity !== false && bypass(root) ? { ...settings, caveman: false } : settings;
  // Reference applies each doctrine independently, preserving existing cache breakpoints.
  for (const mode of ["caveman", "ponytail", "adhd"] as const) {
    const prompt = saverPrompt({ ...effective, caveman: false, ponytail: false, adhd: false, [mode]: effective[mode] });
    if (prompt) inject(root, prompt, wire === "messages");
  }
}
