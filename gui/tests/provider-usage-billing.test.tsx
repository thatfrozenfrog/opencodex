import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import ProviderUsage from "../src/components/provider-workspace/ProviderUsage";
import { LanguageProvider } from "../src/i18n/provider";

test("unpriced provider model saves a selected models.dev listing and refreshes usage", async () => {
  const keys = ["window", "document", "navigator", "fetch", "IS_REACT_ACT_ENVIRONMENT"] as const;
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const win = new Window({ url: "http://localhost" });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: win }, document: { configurable: true, value: win.document },
    navigator: { configurable: true, value: win.navigator }, IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  Object.defineProperty(win.HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(win.HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); } });
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const price = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 };
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return init?.method === "PUT" ? Response.json({ ok: true, provider: "kimi", modelId: "missing", cost: price })
      : Response.json({ candidates: [{ provider: "vendor", model: "missing-v2", price }] });
  }) as typeof fetch;
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  let refreshed = 0;
  try {
    await act(async () => root.render(<LanguageProvider><ProviderUsage
      item={{ name: "kimi", adapter: "openai-chat", authMode: "oauth", baseUrl: "https://example.com", tier: "accounts" }}
      apiBase="/proxy" onPriceSaved={() => { refreshed++; }}
      modelUsage={[{ model: "missing", requests: 1, inputTokens: 70, outputTokens: 10, totalTokens: 80, shareRatio: 1 }]}
    /></LanguageProvider>));
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Bill missing as another model"]')!;
    await act(async () => { button.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(calls[0]?.url).toContain("/api/usage/model-price-candidates?");
    expect(calls[0]?.url).toContain("model=missing");
    expect(host.querySelector("select option")?.textContent).toContain("vendor/missing-v2");
    await act(async () => { host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(calls[1]?.url).toBe("/proxy/api/providers/kimi/model-costs");
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ modelId: "missing", cost: price });
    expect(refreshed).toBe(1);
    expect(host.querySelector("dialog")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    win.close();
    for (const key of keys) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
