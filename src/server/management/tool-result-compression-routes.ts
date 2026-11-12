import { toolSaverOptionsSchema } from "../../config/schema/tool-saver";
import { z } from "zod";
import { captureConfigTopLevelRollback } from "../../config/rebase-provenance";
import { ConfigWritePublishedError } from "../../config/persist-unlocked";
import { toolCompressionMetrics } from "../tool-saver-metrics";
import { filterCatalog } from "../tool-saver-engine";
import { saverPrompt, compressInputPrompt } from "../tool-saver-instructions";
import { filterToolText } from "../tool-saver-filter";
import { jsonResponse } from "../auth-cors";
import { readManagementJsonBodyOr } from "./body";
import type { ManagementContext } from "./context";

const INVALID = Symbol("invalid");
const options = toolSaverOptionsSchema;
const update = z.object({ enabled: z.boolean().optional(), options: options.optional() }).strict().refine(value => value.enabled !== undefined || value.options !== undefined);
const preview = z.object({ text: z.string().max(1000000), command: z.string().max(4096), mode: z.enum(["rtk", "prompt", "input"]).optional(), options: options.optional() }).strict();

function settings(config: ManagementContext["config"]) {
  return { enabled: config.toolResultCompression === true, options: { intensity: "standard", maxLines: 250, maxChars: 10485760, deduplicate: true, ...config.toolResultCompressionOptions }, filters: filterCatalog(config.toolResultCompressionOptions), metrics: toolCompressionMetrics() };
}

export async function handleToolResultCompressionRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { req, url, config } = ctx;
  if (url.pathname === "/api/tool-result-compression/test" && req.method === "POST") {
    const parsed = preview.safeParse(await readManagementJsonBodyOr(req, INVALID));
    if (!parsed.success) return jsonResponse({ error: "invalid preview request" }, 400, req, config);
    const options = parsed.data.options ?? config.toolResultCompressionOptions ?? {};
    const result = parsed.data.mode === "prompt" ? { text: saverPrompt(options) }
      : parsed.data.mode === "input" ? { text: compressInputPrompt(parsed.data.text, options.cavemanPreserveKeywords) }
      : filterToolText(parsed.data.text, parsed.data.command, options);
    return jsonResponse({ ...result, originalBytes: new TextEncoder().encode(parsed.data.text).length, compressedBytes: new TextEncoder().encode(result.text).length }, 200, req, config);
  }
  if (url.pathname === "/api/tool-result-compression" && req.method === "GET") return jsonResponse(settings(config), 200, req, config);
  if (url.pathname === "/api/tool-result-compression" && req.method === "PUT") return saveSettings(ctx);
  return null;
}

async function saveSettings(ctx: ManagementContext): Promise<Response> {
  const { req, config } = ctx;
  const parsed = update.safeParse(await readManagementJsonBodyOr(req, INVALID));
  if (!parsed.success) return jsonResponse({ error: "invalid token saver settings" }, 400, req, config);
  const persist = ctx.deps.saveConfigPreservingClaudeCode ?? (await import("../../config")).saveConfigPreservingClaudeCode;
  const restore = captureConfigTopLevelRollback(config, ["toolResultCompression", "toolResultCompressionOptions"]);
  try {
    if (parsed.data.enabled !== undefined) config.toolResultCompression = parsed.data.enabled;
    if (parsed.data.options) config.toolResultCompressionOptions = { ...config.toolResultCompressionOptions, ...parsed.data.options };
    persist(config);
  } catch (error) {
    if (!(error instanceof ConfigWritePublishedError)) restore();
    throw error;
  }
  return jsonResponse(settings(config), 200, req, config);
}
