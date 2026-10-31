import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelIdentity } from "../src/pages/models-identity";
import type { ModelRow } from "../src/pages/models-shared";

function render(provider: string, id: string, native = false) {
  const model = { provider, id, namespaced: `${provider}/${id}`, native } as ModelRow;
  return renderToStaticMarkup(<ModelIdentity model={model} label={model.namespaced} off={false} />);
}

test("Ckey model labels link to the lower-case owner and model page", () => {
  for (const provider of ["ckey", "ckey-vn"]) {
    const html = render(provider, "dungcsnd113-DeepSeek-V4.1-Flash-1017");
    expect(html).toContain('href="https://ckey.vn/llm-api/m/dungcsnd113/deepseek-v4.1-flash-1017"');
    expect(render(provider, "dungcsnd113/DeepSeek-V4.1-Flash-1017")).toContain('href="https://ckey.vn/llm-api/m/dungcsnd113/deepseek-v4.1-flash-1017"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain(`${provider}/dungcsnd113-DeepSeek-V4.1-Flash-1017`);
  }
});

test("other providers and malformed Ckey identifiers remain plain text", () => {
  for (const html of [render("other", "user-model"), render("ckey", "model"), render("ckey", "../x-model"), render("ckey", "user-model", true)]) {
    expect(html).not.toContain("<a ");
  }
});
