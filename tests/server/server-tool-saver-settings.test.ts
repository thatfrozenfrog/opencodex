import { expect, test } from "bun:test";
import { getDefaultConfig } from "../../src/config";
import { handleManagementAPI } from "../../src/server/management-api";
import { ManagementRequest } from "../helpers/management-auth";
import type { OcxConfig } from "../../src/types";

test("token saver settings are mounted, validated, persisted and applied live", async () => {
  const config = getDefaultConfig();
  const saved: OcxConfig[] = [];
  const deps = { saveConfigPreservingClaudeCode: (value: OcxConfig) => saved.push(structuredClone(value)) };
  const url = new URL("http://127.0.0.1:10100/api/tool-result-compression");
  const call = (method: string, body?: unknown) => handleManagementAPI(new ManagementRequest(url, {
    method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  }), url, config, deps);
  expect((await (await call("GET"))!.json()).enabled).toBe(false);
  expect((await call("PUT", { enabled: "true" }))!.status).toBe(400);
  expect(saved).toHaveLength(0);
  expect((await (await call("PUT", { enabled: true }))!.json()).enabled).toBe(true);
  expect(config.toolResultCompression).toBe(true);
  expect(saved[0]?.toolResultCompression).toBe(true);
  expect((await (await call("GET"))!.json()).enabled).toBe(true);
});

test("real Chat ingress forwards compressed tool results to a fake upstream", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { saveConfig } = await import("../../src/config");
  const { startServer } = await import("../../src/server");
  const { installIsolatedCodexHome } = await import("../helpers/isolated-codex-home");
  const { drainAndRemoveFixtureRoots } = await import("../helpers/fixture-teardown");
  const home = mkdtempSync(join(tmpdir(), "ocx-saver-wire-"));
  const previous = process.env.OPENCODEX_HOME;
  const codex = installIsolatedCodexHome("ocx-saver-codex-");
  process.env.OPENCODEX_HOME = home;
  let received: Record<string, unknown> | undefined;
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    received = await req.json() as Record<string, unknown>;
    if (received.stream === true) return new Response(`data: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 1 } })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    return Response.json({ id: "fixture", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 1 } });
  } });
  let server: ReturnType<typeof startServer> | undefined;
  try {
    saveConfig({ ...getDefaultConfig(), port: 0, codexAutoStart: false, codexShimAutoRestore: false, defaultProvider: "mock", toolResultCompression: true,
      providers: { mock: { adapter: "openai-chat", baseUrl: `${upstream.url}v1`, apiKey: "fixture-key", allowPrivateNetwork: true, liveModels: false, models: ["echo"] } },
    });
    server = startServer(0);
    const raw = "On branch main\n" + '  (use "git add <file>..." to update what will be committed)\n'.repeat(30);
    const variants = [
      { path: "chat/completions", body: { messages: [
        { role: "user", content: "check status" },
        { role: "assistant", tool_calls: [{ id: "call_1", type: "function", function: { name: "bash", arguments: '{"command":"git status"}' } }] },
        { role: "tool", tool_call_id: "call_1", content: raw },
      ] } },
      { path: "responses", body: { input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "check status" }] },
        { type: "function_call", call_id: "call_1", name: "bash", arguments: '{"command":"git status"}' },
        { type: "function_call_output", call_id: "call_1", output: raw },
      ] } },
      { path: "messages", body: { max_tokens: 100, messages: [
        { role: "user", content: "check status" },
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "bash", input: { command: "git status" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: raw }] },
      ] } },
    ];
    for (const variant of variants) {
      received = undefined;
      const reply = await fetch(`http://127.0.0.1:${server.port}/v1/${variant.path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "mock/echo", stream: false, ...variant.body }) });
      const response = await reply.text();
      expect(reply.status, response).toBe(200);
      expect(received).toBeDefined();
      const tool = (received!.messages as Array<Record<string, unknown>>).find(message => message.role === "tool");
      expect(tool?.content).toContain("On branch main");
      expect(String(tool?.content).length).toBeLessThan(raw.length);
      expect(tool?.tool_call_id).toBe("call_1");
    }
  } finally {
    await server?.stop(true); await upstream.stop(true);
    await drainAndRemoveFixtureRoots({ roots: [{ path: home }, { path: codex.path }], restoreEnvironment() { if (previous === undefined) delete process.env.OPENCODEX_HOME; else process.env.OPENCODEX_HOME = previous; codex.restoreEnvironment(); } });
  }
});

test("invalid filter overrides and failed persistence do not mutate live settings", async () => {
  const { handleToolResultCompressionRoutes } = await import("../../src/server/management/tool-result-compression-routes");
  const config = getDefaultConfig();
  const before = structuredClone(config);
  const url = new URL("http://localhost/api/tool-result-compression");
  const call = (body: unknown) => handleToolResultCompressionRoutes({ config, url,
    req: new Request(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    deps: { saveConfigPreservingClaudeCode() { throw new Error("fixture-save-failed"); } },
  } as any);
  expect((await call({ options: { filters: { nonexistent: true } } }))?.status).toBe(400);
  expect((await call({ options: { maxLines: 0 } }))?.status).toBe(400);
  await expect(call({ enabled: true, options: { adhd: true } })).rejects.toThrow("fixture-save-failed");
  expect(config).toEqual(before);
});

test("preview is local, accepts pending options and never saves", async () => {
  const { handleToolResultCompressionRoutes } = await import("../../src/server/management/tool-result-compression-routes");
  const config = getDefaultConfig();
  const url = new URL("http://localhost/api/tool-result-compression/test");
  const response = await handleToolResultCompressionRoutes({ config, url,
    req: new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "", command: "", mode: "prompt", options: { ponytail: true } }) }),
    deps: { saveConfigPreservingClaudeCode() { throw new Error("must-not-save"); } },
  } as any);
  expect(response?.status).toBe(200);
  expect((await response!.json()).text).toContain("lazy senior developer");
  expect(config.toolResultCompressionOptions).toBeUndefined();
});
