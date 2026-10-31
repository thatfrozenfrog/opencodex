import { describe, expect, test } from "bun:test";
import {
  DICTS,
  LOCALES,
  localeDisplayName,
} from "../src/i18n/shared";
import { en } from "../src/i18n/en";
import { formatUptime } from "../src/formatUptime";

describe("i18n locale contracts", () => {
  test("LOCALES and DICTS contain exactly the same locales", () => {
    const localeCodes = LOCALES.map(locale => locale.code).sort();
    const dictCodes = Object.keys(DICTS).sort();

    expect(dictCodes).toEqual(localeCodes);
    expect(new Set(localeCodes).size).toBe(localeCodes.length);

    for (const locale of LOCALES) {
      expect(locale.htmlLang.length).toBeGreaterThan(0);
      expect("name" in locale).toBe(false);
    }
  });

  test("English is the only dashboard locale", () => {
    expect(LOCALES).toEqual([{ code: "en", htmlLang: "en" }]);
    expect(Object.keys(DICTS)).toEqual(["en"]);
  });

  test("English catalog is the sole catalog source", () => {
    expect(localeDisplayName("en")).toBe("English");
  });

  test("every locale catalog has exactly the English key set", () => {
    const expectedKeys = Object.keys(en).sort();

    for (const { code } of LOCALES) {
      const actualKeys = Object.keys(DICTS[code]).sort();
      expect(actualKeys).toEqual(expectedKeys);
    }
  });

  test("English catalog preserves interpolation placeholders", () => {
    const placeholderRe = /\{([a-zA-Z0-9_]+)\}/g;
    const mismatches: string[] = [];

    for (const { code } of LOCALES) {
      for (const key of Object.keys(en) as Array<keyof typeof en>) {
        const enValue = en[key];
        const localeValue = DICTS[code][key];

        const enPlaceholders = [...enValue.matchAll(placeholderRe)]
          .map(match => match[1])
          .sort();

        const localePlaceholders = [...localeValue.matchAll(placeholderRe)]
          .map(match => match[1])
          .sort();

        if (
          enPlaceholders.length !== localePlaceholders.length ||
          enPlaceholders.some(
            (placeholder, index) => placeholder !== localePlaceholders[index],
          )
        ) {
          mismatches.push(
            `${code}.${key}: en=[${enPlaceholders.join(",")}] locale=[${localePlaceholders.join(",")}]`,
          );
        }
      }
    }

    expect(mismatches).toEqual([]);
  });

  test("stored-key reveal notice preserves pairing and trusted Tailscale authorization", () => {
    const key = "api.key.revealDenied";
    const missingTailscale = LOCALES
      .filter(({ code }) => !DICTS[code][key].includes("Tailscale"))
      .map(({ code }) => code);

    expect(missingTailscale).toEqual([]);
    expect(en[key]).toContain("operator-authorized session");
    expect(en[key]).toContain("Pair this browser");
    expect(en[key]).toContain("trusted Tailscale identity");
  });

  test("locale source files contain no duplicate dictionary keys", async () => {
    const duplicates: string[] = [];

    for (const { code } of LOCALES) {
      const text = await Bun.file(
        new URL(`../src/i18n/${code}.ts`, import.meta.url),
      ).text();

      const keyRe = /^\s*"([^"]+)":/gm;
      const seen = new Set<string>();

      for (const match of text.matchAll(keyRe)) {
        const key = match[1];

        if (seen.has(key)) {
          duplicates.push(`${code}.${key}`);
        } else {
          seen.add(key);
        }
      }
    }

    expect(duplicates).toEqual([]);
  });

  test("formatUptime uses catalog units for every locale", () => {
    for (const { code } of LOCALES) {
      const day = DICTS[code]["uptime.day"];
      const hour = DICTS[code]["uptime.hour"];
      const minute = DICTS[code]["uptime.minute"];
      const second = DICTS[code]["uptime.second"];

      expect(formatUptime(45, code)).toBe(`45${second}`);
      expect(formatUptime(300, code)).toBe(`5${minute}`);
      expect(formatUptime(3600, code)).toBe(`1${hour}`);
      expect(formatUptime(3660, code)).toBe(`1${hour} 1${minute}`);
      expect(formatUptime(86400, code)).toBe(`1${day}`);
      expect(formatUptime(90000, code)).toBe(`1${day} 1${hour}`);
    }
  });

  test("English catalog source exists", async () => {
    const text = await Bun.file(new URL("../src/i18n/en.ts", import.meta.url)).text();
    expect(text).toContain('"lang.nativeName": "English"');
  });


});
