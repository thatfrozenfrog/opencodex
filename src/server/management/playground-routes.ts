import { postLocalChatCompletion } from "../../lib/local-chat-completion";
import { signalWithTimeout } from "../../lib/abort";
import { isDeclaredReasoningEffort } from "../../reasoning-effort";
import { previewRouteModel } from "../../router";
import { jsonResponse } from "../auth-cors";
import { DecompressedBodyTooLargeError, readBoundedJsonRequestBody } from "../request-decompress";
import { managementInferencePort, type ManagementContext } from "./context";

const TIMEOUT_MS = 120_000;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGES = 128;
const MAX_MESSAGE_CHARS = 32_768;
const MAX_TOTAL_CHARS = 131_072;
let activeRequests = 0;

const ALLOWED_FIELDS = new Set([
  "model", "messages", "stream", "temperature", "top_p", "max_tokens", "reasoning_effort",
]);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Rebuild the request from an allowlist; no URL, credentials, tools or headers cross this seam. */
function completionBody(value: unknown): Record<string, unknown> | null {
  if (!record(value) || Object.keys(value).some(key => !ALLOWED_FIELDS.has(key))) return null;
  if (typeof value.model !== "string" || !value.model.trim() || value.model.length > 512
    || /[\u0000-\u0020\u007f]/.test(value.model)) return null;
  if (value.stream !== undefined && typeof value.stream !== "boolean") return null;
  if (!Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > MAX_MESSAGES) return null;
  let totalChars = 0;
  const messages: Array<{ role: string; content: string }> = [];
  for (const message of value.messages) {
    if (!record(message) || Object.keys(message).some(key => key !== "role" && key !== "content")
      || (message.role !== "system" && message.role !== "user" && message.role !== "assistant")
      || typeof message.content !== "string" || message.content.length > MAX_MESSAGE_CHARS) return null;
    totalChars += message.content.length;
    if (totalChars > MAX_TOTAL_CHARS) return null;
    messages.push({ role: message.role, content: message.content });
  }
  const body: Record<string, unknown> = { model: value.model, messages, max_tokens: 2048, stream: false };
  for (const [key, upper] of [["temperature", 2], ["top_p", 1]] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] < 0 || value[key] > upper) return null;
    body[key] = value[key];
  }
  if (value.max_tokens !== undefined) {
    if (typeof value.max_tokens !== "number" || !Number.isInteger(value.max_tokens)
      || value.max_tokens < 1 || value.max_tokens > 16_384) return null;
    body.max_tokens = value.max_tokens;
  }
  if (value.reasoning_effort !== undefined) {
    if (typeof value.reasoning_effort !== "string" || !isDeclaredReasoningEffort(value.reasoning_effort)) return null;
    body.reasoning_effort = value.reasoning_effort;
  }
  return body;
}

function failure(ctx: ManagementContext, status: number, code: string, message: string): Response {
  const response = jsonResponse({ error: { code, message } }, status, ctx.req, ctx.config);
  response.headers.set("Cache-Control", "no-store");
  if (status === 429) response.headers.set("Retry-After", "1");
  return response;
}

/** Only fixed categories leave this boundary; helper errors can contain upstream secrets. */
function completionFailure(ctx: ManagementContext, error: string): Response {
  const http = /^playground HTTP (\d{3}):/.exec(error);
  if (http?.[1] === "429") return failure(ctx, 429, "upstream_rate_limited", "Model request rate limited.");
  if (http) return failure(ctx, 502, "upstream_error", "Model request failed.");
  if (error.endsWith("response exceeded byte bound")) {
    return failure(ctx, 502, "response_too_large", "Model response exceeded size limit.");
  }
  if (error.endsWith("returned non-JSON") || error.endsWith("returned no text")) {
    return failure(ctx, 502, "invalid_response", "Model returned no usable text response.");
  }
  return failure(ctx, 502, "upstream_unavailable", "Model request could not be completed.");
}

/** Auth and browser CSRF admission belong to the enclosing management pipeline. */
export async function handlePlaygroundRoutes(ctx: ManagementContext): Promise<Response | null> {
  if (ctx.url.pathname !== "/api/playground/chat" || ctx.req.method !== "POST") return null;
  if (activeRequests >= 2) return failure(ctx, 429, "busy", "Too many Playground requests.");
  if (ctx.req.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return failure(ctx, 415, "unsupported_media_type", "Content-Type must be application/json.");
  }
  // Reject compression so the small management input has no decompression work factor.
  const encoding = ctx.req.headers.get("content-encoding")?.trim().toLowerCase();
  if (encoding && encoding !== "identity") return failure(ctx, 415, "unsupported_encoding", "Compressed request bodies are not supported.");
  activeRequests += 1;
  const deadline = signalWithTimeout(TIMEOUT_MS, ctx.req.signal);
  try {
    let value: unknown;
    try {
      value = await readBoundedJsonRequestBody(ctx.req, MAX_BODY_BYTES, undefined, { signal: deadline.signal });
    } catch (error) {
      if (deadline.signal.aborted) throw error;
      return error instanceof DecompressedBodyTooLargeError
        ? failure(ctx, 413, "body_too_large", "Request body exceeded size limit.")
        : failure(ctx, 400, "invalid_json", "Request body must be valid JSON.");
    }
    const body = completionBody(value);
    if (!body) return failure(ctx, 400, "invalid_request", "Invalid Playground request fields or limits.");
    try {
      // Preview avoids consuming combo rotation state. Actual routing, account selection,
      // request history and usage accounting still happen on the ordinary data plane.
      const route = previewRouteModel(ctx.config, body.model as string);
      if (!Object.prototype.hasOwnProperty.call(ctx.config.providers, route.providerName)
        || ctx.config.providers[route.providerName]?.disabled === true) {
        return failure(ctx, 400, "invalid_model", "Model must resolve to an enabled configured provider.");
      }
    } catch {
      return failure(ctx, 400, "invalid_model", "Model must resolve to an enabled configured provider.");
    }
    const answer = await postLocalChatCompletion({
      config: { ...ctx.config, port: managementInferencePort(ctx) },
      body,
      label: "playground",
      logTag: "playground",
      timeoutMs: TIMEOUT_MS,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      boundWhileStreaming: true,
      abortSignal: deadline.signal,
    });
    if (deadline.signal.aborted) throw deadline.signal.reason;
    if (answer.error) return completionFailure(ctx, answer.error);
    // The shared helper returns text only: do not invent actual model, provider,
    // usage or finish_reason. Its local data-plane request always disables SSE.
    const response = jsonResponse({
      model: body.model,
      requestedModel: body.model,
      modelIsRequested: true,
      choices: [{ index: 0, message: { role: "assistant", content: answer.text } }],
      streamingSupported: false,
    }, 200, ctx.req, ctx.config);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    if (ctx.req.signal.aborted) return failure(ctx, 499, "cancelled", "Playground request cancelled.");
    if (deadline.signal.aborted) return failure(ctx, 504, "timeout", "Playground request timed out.");
    return failure(ctx, 502, "upstream_unavailable", "Model request could not be completed.");
  } finally {
    deadline.cleanup();
    activeRequests -= 1;
  }
}
