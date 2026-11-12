/** @jsxImportSource react */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, StrictMode } from "react";
import type { Root } from "react-dom/client";
import { LanguageProvider } from "../src/i18n/provider";
import TokenSaver from "../src/pages/TokenSaver";

const globals = ["document", "window", "navigator", "localStorage", "sessionStorage", "fetch", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"] as const;
let previous: Record<string, PropertyDescriptor | undefined>;
let win: Window;
let root: Root | undefined;
let container: HTMLDivElement;
let setting: unknown;
let failLoad: boolean;
let failSave: boolean;
let writes: unknown[];
let urls: string[];

beforeEach(() => {
  previous = Object.fromEntries(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  win = new Window({ url: "http://localhost/" });
  for (const key of ["document", "window", "navigator", "localStorage", "sessionStorage", "HTMLElement"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? win : win[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  win.localStorage.setItem("ocx-lang", "en");
  setting = { enabled: false, options: { intensity: "standard", maxLines: 250, maxChars: 100000, deduplicate: true }, filters: [] };
  failLoad = false; failSave = false; writes = []; urls = [];
  Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: async (input: unknown, init?: RequestInit) => {
    urls.push(String(input));
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      writes.push(body);
      if (failSave) return Response.json({ error: "fixture failure" }, { status: 500 });
      setting = { ...(setting as object), ...body };
    } else if (failLoad) return Response.json({ error: "unavailable" }, { status: 503 });
    return Response.json(setting);
  } });
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined; win.close();
  for (const key of globals) {
    if (previous[key]) Object.defineProperty(globalThis, key, previous[key]!);
    else delete (globalThis as Record<string, unknown>)[key];
  }
});

async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
async function render(base = "") {
  if (!root) {
    container = win.document.createElement("div") as unknown as HTMLDivElement;
    win.document.body.appendChild(container);
    root = (await import("react-dom/client")).createRoot(container);
  }
  await act(async () => { root!.render(<StrictMode><LanguageProvider><TokenSaver apiBase={base} /></LanguageProvider></StrictMode>); });
  await flush();
}
function button(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find(value => value.textContent === label || value.getAttribute("aria-label") === label)!;
}
async function click(label: string) { await act(async () => { button(label).click(); }); }
function enabled(label: string) { return button(label).getAttribute("aria-pressed") === "true"; }

test("loads settings and toggles RTK through the management route", async () => {
  await render();
  expect(container.textContent).not.toContain("Could not load");
  await click("Tool-result compression");
  expect(writes).toEqual([{ enabled: true }]);
  expect(container.textContent).toContain("Settings saved");
  expect(container.querySelector("textarea.input")).not.toBeNull();
});
test("failed settings load disables controls and retry recovers", async () => {
  failLoad = true;
  await render();
  expect(button("Tool-result compression").disabled).toBe(true);
  expect(container.textContent).toContain("Could not load");
  failLoad = false;
  await click("Retry"); await flush();
  expect(button("Tool-result compression").disabled).toBe(false);
});

test("malformed settings keep writes disabled", async () => {
  setting = { enabled: true, options: {}, filters: [] };
  await render();
  expect(button("Tool-result compression").disabled).toBe(true);
  expect(container.textContent).toContain("Could not load");
});
test("configuration expands and persists advanced mode", async () => {
  await render(); await click("Configure"); await click("Advanced");
  expect((writes.at(-1) as { options: { mode: string } }).options.mode).toBe("advance");
  expect(container.textContent).toContain("Command categories");
});
