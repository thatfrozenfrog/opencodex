export interface StatusCodeInfo { label: string; description: string }

type LocalizedInfo = { en: StatusCodeInfo };

const STATUS_CODES: Record<number, LocalizedInfo> = {
  400: {
    en: { label: "Bad request", description: "The proxy could not understand the request. Check the model, message shape, headers, and JSON body before retrying." },
  },
  401: {
    en: { label: "Unauthorized", description: "Credentials are missing, expired, or invalid. Re-login or refresh the account/provider credentials used by opencodex." },
  },
  402: {
    en: { label: "Payment required", description: "The upstream provider rejected the request because billing, credits, or plan access is not available. Add credits, update billing, or switch provider." },
  },
  403: {
    en: { label: "Forbidden", description: "The account is authenticated but not allowed to use this model or operation. Often a plan/subscription gate (e.g. Ollama Cloud Pro), org policy, or model permission — not necessarily a bad API key." },
  },
  404: {
    en: { label: "Not found", description: "The requested route, model, account, or upstream resource was not found. Verify the model name and opencodex provider configuration." },
  },
  408: {
    en: { label: "Request timeout", description: "The request took too long before the proxy or upstream provider could complete it. Retry with a smaller request or a different provider." },
  },
  409: {
    en: { label: "Conflict", description: "The request conflicts with the current account, session, or provider state. Refresh the session or retry after the active operation finishes." },
  },
  413: {
    en: { label: "Request too large", description: "The prompt, attachments, or generated payload exceeds a proxy or upstream limit. Reduce tokens, file size, or conversation history." },
  },
  422: {
    en: { label: "Invalid content", description: "The provider accepted the request format but rejected its contents. Check model options, tool definitions, message roles, and unsupported fields." },
  },
  424: {
    en: { label: "Provider dependency failed", description: "A required upstream dependency failed while opencodex was routing the request. Retry later or switch to another configured provider." },
  },
  429: {
    en: { label: "Rate limited", description: "The upstream provider rate or quota limit has been reached. Wait for the quota window to reset or switch account/provider." },
  },
  499: {
    en: { label: "Client closed request", description: "The client disconnected or canceled the request before opencodex finished routing it. Retry if the cancellation was accidental." },
  },
  500: {
    en: { label: "Proxy error", description: "opencodex hit an internal error while handling the request. Retry once, then check proxy logs if it repeats." },
  },
  502: {
    en: { label: "Bad upstream response", description: "The upstream provider returned an invalid or failed response through the proxy. Retry or route the request to another provider." },
  },
  503: {
    en: { label: "Provider unavailable", description: "The proxy or upstream provider is temporarily unavailable or overloaded. Wait briefly, then retry or switch provider." },
  },
  504: {
    en: { label: "Upstream timeout", description: "The upstream provider did not respond before the proxy timeout. Retry with a smaller request or choose a faster provider." },
  },
  529: {
    en: { label: "Provider overloaded", description: "The upstream provider is overloaded or capacity-limited. Wait and retry, or switch to another account/provider." },
  },
};

const GENERIC_STATUS: { client: LocalizedInfo; server: LocalizedInfo } = {
  client: {
    en: { label: "Request error", description: "The proxy or upstream provider rejected the request. Check the request shape, credentials, model name, and provider configuration." },
  },
  server: {
    en: { label: "Server or upstream error", description: "opencodex or an upstream provider failed while processing the request. Retry later or route the request to another provider." },
  },
};


export function statusCodeInfo(code: number, _locale: string): StatusCodeInfo | null {
  if (code < 400) return null;
  const info = STATUS_CODES[Math.trunc(code)] ?? (code < 500 ? GENERIC_STATUS.client : GENERIC_STATUS.server);
  return info.en;
}
