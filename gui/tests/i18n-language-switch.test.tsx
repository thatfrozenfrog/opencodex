import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { LanguageProvider, useI18n } from "../src/i18n";
import { LOCALES } from "../src/i18n/shared";
import { createRoot } from "react-dom/client";

function Surface() {
  const { locale, t } = useI18n();
  return <div data-locale={locale}>{t("nav.dashboard")}</div>;
}

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

test("dashboard always renders the English catalog and document language", async () => {
  const window = new Window();
  Object.assign(globalThis, { window, document: window.document, navigator: window.navigator, localStorage: window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.setItem("ocx-lang", "fr");
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const { createRoot: makeRoot } = await import("react-dom/client");
  const root: Root = makeRoot(container);
  await act(async () => root.render(<LanguageProvider><Surface /></LanguageProvider>));
  expect(container.textContent).toContain("Dashboard");
  expect(container.firstElementChild?.getAttribute("data-locale")).toBe("en");
  expect(window.document.documentElement.lang).toBe("en");
  expect(window.localStorage.getItem("ocx-lang")).toBeNull();
  expect(LOCALES).toEqual([{ code: "en", htmlLang: "en" }]);
  cleanup = () => { act(() => root.unmount()); window.happyDOM.abort(); };
});
