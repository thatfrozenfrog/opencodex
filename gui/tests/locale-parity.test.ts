import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { LOCALES } from "../src/i18n/shared";

test("English is the sole dashboard locale and catalog", async () => {
  const files = await readdir(new URL("../src/i18n/", import.meta.url));
  const catalogs = files.filter(file => /^[a-z]{2}(?:-[A-Z]{2})?\.ts$/.test(file) && file !== "en.ts");
  expect(LOCALES).toEqual([{ code: "en", htmlLang: "en" }]);
  expect(catalogs).toEqual([]);

});
