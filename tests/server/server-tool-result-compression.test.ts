import { describe, expect, test } from "bun:test";
import parity from "../fixtures/token-saver-parity.json";
import { compressTextDetailed, type SaverOptions } from "../../src/server/tool-saver-filter";
import { compressToolResults } from "../../src/server/tool-result-compression";

const diff = Array.from({ length: 180 }, (_, i) => `+changed line ${i}`).join("\n");
function chat(command = "git diff", name = "bash") {
  return { messages: [
    { role: "assistant", tool_calls: [{ id: "call", function: { name, arguments: JSON.stringify({ command }) } }] },
    { role: "tool", tool_call_id: "call", content: diff },
  ] };
}

describe("tool result compression", () => {
  test("is opt-in and preserves unrecognized, protected and error results", () => {
    for (const [command, name, enabled] of [["git diff", "bash", false], ["git diff | cat", "bash", true], ["git diff", "read", true], ["rtk git diff", "bash", true]] as const) {
      const body = chat(command, name);
      compressToolResults(body, enabled);
      expect(body.messages[1]!.content).toBe(diff);
    }
    const body = chat();
    body.messages[1]!.content = `Error: failed\n${diff}`;
    compressToolResults(body, true);
    expect(body.messages[1]!.content).toContain("changed line 179");
  });

  test("preserves structured JSON even when it exceeds the configured line limit", () => {
    const body = chat();
    const structured = JSON.stringify({ items: Array.from({ length: 200 }, (_, i) => ({ i })) }, null, 2);
    body.messages[1]!.content = structured;
    compressToolResults(body, true, { maxLines: 20 });
    expect(body.messages[1]!.content).toBe(structured);
  });

  test("filters paired Chat, Responses and Messages results", () => {
    const bodies: Array<[any, () => string]> = [];
    const c = chat();
    bodies.push([c, () => c.messages[1]!.content!]);
    const r = { input: [{ type: "function_call", call_id: "1", name: "bash", arguments: '{"command":"git diff"}' }, { type: "function_call_output", call_id: "1", output: diff }] };
    bodies.push([r, () => r.input[1]!.output!]);
    const a = { messages: [{ role: "assistant", content: [{ type: "tool_use", id: "1", name: "bash", input: { command: "git diff" } }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: diff }] }] };
    bodies.push([a, () => a.messages[1]!.content[0]!.content!]);
    for (const [body, output] of bodies) {
      compressToolResults(body, true, { maxLines: 100 });
      expect(output()).toBe(compressTextDetailed(diff, "git diff", { maxLines: 100 }).text);
    }
  });
});

test("catalog loads all 55 filters and honors per-filter switches", async () => {
  const { filterCatalog, applyCatalog } = await import("../../src/server/tool-saver-engine");
  expect(filterCatalog()).toHaveLength(55);
  expect(filterCatalog({ filters: { "git-diff": false } }).find(f => f.id === "git-diff")?.enabled).toBe(false);
  expect(applyCatalog("diff --git a/a b/a\nindex 123..456\n+new", "git diff", {}, 100)?.text).not.toContain("index");
});

test("instruction modes work independently of RTK and preserve wire shapes", () => {
  const chatBody = { messages: [{ role: "user", content: "hello" }] };
  compressToolResults(chatBody, false, { caveman: true });
  expect(chatBody.messages[0]?.role).toBe("system");
  expect(chatBody.messages[0]?.content).toContain("terse caveman");
  const messages: Record<string, unknown> = { messages: [{ role: "user", content: "hello" }], max_tokens: 100 };
  compressToolResults(messages, false, { adhd: true }, "messages");
  expect(messages.system).toContain("action-first output");
  expect((messages.messages as unknown[])).toHaveLength(1);
});

for (const fixture of parity.cases) test(`Go parity: ${fixture.name}`, () => {
  expect(compressTextDetailed(fixture.text, fixture.command, fixture.config as SaverOptions)).toEqual(fixture.expected);
});

test("Auto-Clarity, input compression and cache breakpoint insertion follow reference", async () => {
  const { compressInputPrompt, injectSaverInstructions } = await import("../../src/server/tool-saver-instructions");
  expect(compressInputPrompt("Hello, could you please fix this, thanks!")).toBe("fix this");
  const safety = { messages: [{ role: "user", content: "explain in detail this security vulnerability" }] };
  injectSaverInstructions(safety, { caveman: true });
  expect(safety.messages).toHaveLength(1);
  const system = [{ type: "text", text: "cached", cache_control: { type: "ephemeral" } }];
  const native = { system, messages: [{ role: "user", content: "hello" }] };
  injectSaverInstructions(native, { ponytail: true }, "messages");
  expect(native.system[1]?.text).toBe("cached");
  const response: Record<string, unknown> = { input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }] };
  injectSaverInstructions(response, { adhd: true });
  expect((response.input as any[])[0]).toMatchObject({ type: "message", role: "system", content: [{ type: "input_text" }] });
});
