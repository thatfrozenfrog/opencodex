import { projectLocalModelRefusalLog } from "../request-log-failure-detail";
import { inputAdmissionRefusalMessage } from "./input-admission";
import { clientFacingModelLabel, clientFacingModelText } from "../../lib/error-destination";
import { markProxyError } from "../../lib/client-error-body";
import { completeClaudeBridgePoolIdentity } from "../claude-bridge-pool-session";
import type { HandleResponsesOptions, ResponsesRequestContext, ResponsesAdmissionState, ResponsesDispatchers } from "./core-options";
import type { PolicyRequestEvidence } from "../../routing/evaluator";
import type { RequestLogContext } from "../request-log";
import { addProtocolEntryReason, markProtocolEntry, protocolMarkFeatures } from "../../protocols/trace";
import { nativeMessagesToolScopeDenial } from "../messages-native-scope";
import { advisorServerToolDestination } from "../../adapters/anthropic/advisor-tool";
import { isAntigravityRoute } from "../antigravity-direct-eligibility";
import { capturePolicyRequestRoute, assertPolicyNormalizedRoute, recordPolicyPreparedDestination, policyCandidateRefusalResponse, MandatoryToolChoiceUnavailableError, mandatoryToolChoiceUnavailableResponse } from "./policy-request-scope";
import {
  agentTaskRecoveryConfig,
  restoreCachedEncryptedAgentTasks,
  recoverEncryptedAgentTaskWithResult,
} from "./agent-task-recovery";
import { readJsonRequestBody, resolveInboundBodyLimitBytes } from "../request-decompress";
import { compressToolResults } from "../tool-result-compression";
import {
  clientCancelledResponse,
  decodeRequestErrorResponse,
  comboUnavailable,
  unreadableEncryptedAgentTaskResponse,
} from "./core-errors";
import { parseSyntheticRowId } from "../fast-row";
import { resolveComboId, comboIdFromRawBody, comboExclusionReasons, NoAvailableComboTargetsError, pickComboTarget } from "../../combos";
import { INTERCEPT_TARGET_UNAVAILABLE_CODE, interceptTargetUnavailableResponse, resolveChosenTarget, resolveShadowCallTarget } from "./shadow-target-availability";
import {
  MEMORY_MODEL_TARGET_UNAVAILABLE_CODE,
  configuredMemoryModel,
  detectMemoryModelPhase,
  memoryModelRouteReason,
  memoryModelTargetUnavailableResponse,
} from "./memory-models";
import { recallComboForLane } from "./combo-session-recall";
import {
  sessionLaneIdFromRequest,
  conversationIdFromResponsesRequest,
  assignNativeLogConversationId,
  fillHermesLogConversationFallback,
  nativeLogConversationIdFromHeaders,
  sessionIdHeaderFromRequest,
  reasoningReplayConversationIdFromResponsesRequest,
} from "../request-log-conversation";
import { contextPrincipalIdOf, resolveContextPrincipal } from "../auth-cors";
import { responseTurnMembership } from "./turn-membership";
import { resolveSkillsSnapshotScopeKey, snapshotSkillsCatalogInBody } from "./skills-snapshot";
import {
  isShadowSourceModel,
  shadowCallPreservesSelectedModel,
  shadowSourceModelPrefix,
  shouldInterceptShadowCall,
} from "../../lib/shadow-call";
import { sanitizeLogMetadataString } from "../../lib/redact";
import {
  hasUnreadableEncryptedAgentTask,
  sanitizeEncryptedContentInPlace,
  stripAgentMessageCiphertextInPlace,
} from "./encrypted-payload";
import {
  codexPoolAffinityKey,
  codexRequestAffinityKey,
  previewCodexPoolLineage,
  applyCodexAuthContextToProvider,
  releaseCodexAuthContextProbeLease,
  hasCallerCodexBearer,
  requestOwnedMainPinState,
  requestOwnedMainCredentialIsLive,
} from "../../codex/auth-context";
import {
  copyPreviousResponseReplayProvenance,
  expandPreviousResponseInput,
  previousResponseRestoredPrefixLength,
  previousResponseReplayFailure,
  markBodyNonPersistable,
  previousResponseProviderState,
} from "../../responses/state";
import { formatErrorResponse } from "../../bridge";
import { chatCanPreserveMandatoryToolChoice } from "./combo-required-tool-contract";
import { mapCodexAuthContextErrorToResponse } from "./codex-auth-error";
import type { OcxParsedRequest } from "../../types";
import { buildToolBridgeMaps } from "./collaboration";
import { parseRequest } from "../../responses/parser";
import { responsesHasFileImage, responsesHasInstructionImage } from "../../adapters/claude-cli/instruction-images";
import { anthropicSessionKeyFromParts } from "../../oauth/anthropic-routing";
import { configuredAnthropicInstance } from "../../providers/anthropic-instance";
import { isTranslatorBudgetExceededError } from "../../lib/translator-budget";
import { bindTurnTerminationScope, rememberDeliveredFinalAnswer } from "../../responses/turn-termination";
import { noteCodexSelectionAffinity, observeCacheDiagnosticInbound, rebindCacheDiagnosticBody, requestLogSpeedLabel, readConfiguredCodexServiceTier } from "../request-log";
import type { RouteResult } from "../../router";
import {
  captureRouteStaticPolicy,
  routeConcreteModel,
  routeCompactionModel,
  routeModel,
  NoEligiblePolicyCandidateError,
  AnthropicSecondaryInstanceUnavailableError,
} from "../../router";
import { evidenceFromBody } from "../../routing/request-evidence";
import { OPENAI_CODEX_PROVIDER_ID, isCanonicalOpenAiForwardProvider } from "../../providers/openai-tiers";
import { resolveNativeReasoningRetention } from "../../config/schema/native-reasoning-retention";
import { isThreadSpawnRequest } from "../effort-policy";
import {
  mainHardLockFallbackCallerCheck,
  resolveResponsesCodexAuth,
  withClaudeNativeSession,
} from "./core-auth";
import {
  canPassThroughEncryptedV2AgentTask,
  applyFinalRouteRequestNormalization,
  previewXaiOauthWireModel,
} from "./core-normalize";
import { formatCodexProviderForLog } from "../../codex/routing";
import type { AgentTaskRecoveryFailureReason } from "./agent-task-recovery";
import { resolveWireProtocolOverride } from "../adapter-resolve";
import { hasUnmappedRoutedCustomToolOutput } from "../../responses/custom-tool-compat";
import { PROVIDER_OWNED_CONTINUATION_WIRES, resolvedAdapterWire } from "../../responses/continuation-ownership";
import {
  isCodexReserveHelperUnsupported,
  isCodexReserveOptInMissing,
  CODEX_RESERVE_HELPER_UNSUPPORTED_MESSAGE,
  CODEX_RESERVE_OPT_IN_REQUIRED_MESSAGE,
} from "../../codex/loopback-target";
import { checkComboTargetInputAdmission, checkInputAdmission } from "./input-admission";
import {
  admissionMayUseMeteredComboTargets,
  admissionModelDeniedResponse, projectAdmissionModelDeniedLog,
  AdmissionModelDeniedError,
  assertRouteAllowedByScope,
  resolveAdmissionModelScope,
  routeAllowedByScope,
} from "../admission-model-scope";
import { nativeContextLimits } from "../../codex/catalog";
import type { ClientToolCatalogRestriction } from "../../lib/empty-tool-catalog";
import {
  currentTurnWireToolCatalogBody,
  hasExplicitEmptyToolCatalog,
  collectDeclaredWireToolNames,
  collectTranslatedHostedToolNames,
  collectDeclaredBareCustomWireToolNames,
} from "../responses-undeclared-tool-guard";
import { streamingContextOverflowResponse } from "./context-overflow";
import {
  preAuthUpstreamHostCircuitKey,
  upstreamHostCircuitOpenResponse,
  applyCodexAccountGatedWireNormalization,
  codexLogAccountId,
} from "./core-codex-account";
import { acquireUpstreamHostAdmission } from "../../codex/upstream-host-health";
import { applyCompactionRoutingOverride, compactionRoutingKeepsProviderIdentity } from "./compaction-routing";
import { applyMainHardLockFallbackOverride } from "./main-hard-lock-routing";
import { FallbackRefusedError, guardFallbackHop } from "../../routing/fallback-policy";
import { codexAuthContextLogLabel } from "../../codex/account-label";
import {
  conversationStateBindingFromAuth,
  applyAccountChangeConversationStateScrub,
  accountChangeFileReferenceRefusal,
  conversationCarriesUploadedFiles,
} from "./account-change-state";

import { redactHostedImageDisplayPaths } from "../responses-hosted-image-display";
import { eagerCodexToolCatalogSurface, warnEagerCodexToolCatalog } from "./codex-tool-catalog";

/** Policy-routing evidence. The direct lane's settings-only body has no conversation to scan. */
function routeEvidence(options: Pick<HandleResponsesOptions, "directRequest">, parsed: OcxParsedRequest): PolicyRequestEvidence {
  return options.directRequest?.evidence ?? evidenceFromBody(parsed._rawBody);
}

/**
 * Leave the Antigravity direct lane for this request: put the bridge conversation back on the
 * Responses body so every `_rawBody` reader sees what the bridge would have sent, and trace the
 * request as the bridge. The IR conversation already decoded stays: it equals what
 * `parseRequest` builds from the restored body (`tests/protocols/chat-ir-parity.test.ts`).
 */
function restoreDirectRequestConversation(options: HandleResponsesOptions, body: unknown, logCtx: RequestLogContext): void {
  const direct = options.directRequest;
  if (!direct) return;
  options.directRequest = undefined;
  if (body && typeof body === "object" && !Array.isArray(body)) Object.assign(body, direct.bridgeConversation());
  if (options.clientEncoder) options.clientEncoder = { ...options.clientEncoder, requestLane: "bridge" };
  markProtocolEntry(logCtx, {
    inbound: direct.protocol,
    lane: "bridge",
    reasonCodes: ["not-migrated"],
    features: protocolMarkFeatures(logCtx) ?? [],
  });
}

/**
 * Leave the direct lane as soon as the route stops being the Antigravity route it was decided
 * for. Called after every route assignment, so readers that run between a reroute and dispatch
 * (canonical sanitization, ciphertext stripping, final normalization) see the bridge body.
 */
function leaveDirectLaneIfRerouted(
  options: HandleResponsesOptions,
  route: Pick<RouteResult, "providerName" | "modelId" | "provider">,
  parsed: OcxParsedRequest,
  logCtx: RequestLogContext,
): void {
  const direct = options.directRequest;
  if (!direct) return;
  if (route.providerName === direct.providerName && route.modelId === direct.modelId && isAntigravityRoute(route)) return;
  restoreDirectRequestConversation(options, parsed._rawBody, logCtx);
}

/** Parses, selects, and admits one request without changing the dispatch policy. */
export async function prepareResponsesRequest(
  requestContext: Pick<ResponsesRequestContext, "options" | "config" | "req" | "logCtx">,
  admissionState: ResponsesAdmissionState,
  requestDispatchers: ResponsesDispatchers,
) {
  const { options, config, req, logCtx } = requestContext;
  const policyScope = options.policyRequestScope ?? { triedDestinations: new Set<string>() };
  const concreteSelection = options.comboAttempt || options.policyFallbackCandidate !== undefined;

  // The Chat and Anthropic surfaces replay through here with a Responses-shaped body,
  // so an omitted value means a genuine Responses inbound.
  const inboundWire = options.inboundWire ?? "responses";
  const translatorBudget = options.translatorBudget;
  const agentTaskRecovery = agentTaskRecoveryConfig(config);
  let body: unknown;
  try {
    body = await readJsonRequestBody(req, translatorBudget, resolveInboundBodyLimitBytes(config.maxInboundBodyBytes));
  } catch (err) {
    if (options.abortSignal?.aborted || req.signal.aborted) {
      return clientCancelledResponse();
    }
    return decodeRequestErrorResponse(err, "responses");
  }
  // Chat and Messages ingress already applied the transform before their bridge.
  if (inboundWire === "responses" && !concreteSelection) compressToolResults(body, config.toolResultCompression, config.toolResultCompressionOptions);
  options.responsesInstructionImage ||= responsesHasInstructionImage(body);
  options.responsesFileImage ||= responsesHasFileImage(body);

  // Remove display-only artifact paths before helpers, combo dispatch and upstream replay.
  const originalSelector = options.mainHardLockFallbackOverride?.sourceModel ?? options.compactionRoutingOverride?.sourceModel
    ?? (options.comboAttempt || options.policyFallbackCandidate || options.internalDecisionCall || options.memoryModelPhase
      || options.visionDescribeTerminal || options.shadowCallIntercepted ? undefined
      : body && typeof body === "object" ? (body as { model?: unknown }).model : undefined);
  options.clientModelLabel ??= clientFacingModelLabel(originalSelector);
  redactHostedImageDisplayPaths(body);
  observeCacheDiagnosticInbound(
    logCtx,
    body,
    req.headers,
    options.promptCacheKeyIsSharedCohort === true
      ? "system-derived"
      : options.promptCacheKeyIsSharedCohort === false ? "metadata-derived" : "caller",
    contextPrincipalIdOf(options.admission),
  );
  if (!concreteSelection && !options.compactionRoutingOverride && inboundWire === "responses") {
    options.compactionRoutingOverride = applyCompactionRoutingOverride(body, req.headers, config, {
      endpoint: "responses",
      transport: options.inboundTransport,
    });
  }
  // Codex's memory pipeline names a destination per phase. The phase is read from Codex's own turn
  // metadata, never from the model id: Phase 1 shares `gpt-5.6-luna` with the app's title/commit
  // helper calls. Read here, ahead of the shadow intercept below, because the phase decision is the
  // more specific of the two settings and must be the one that survives when both match one request.
  // A JEV decision-model call is the router's own auxiliary turn, never a Codex memory phase.
  const memoryModelPhase = options.internalDecisionCall ? undefined : options.memoryModelPhase
    ?? ((config.memoryModels?.extract || config.memoryModels?.consolidation)
      && !concreteSelection && !options.compactionRoutingOverride && inboundWire === "responses"
      ? detectMemoryModelPhase(body, req.headers, { transport: options.inboundTransport }) ?? undefined
      : undefined);
  const memoryModelTarget = memoryModelPhase ? configuredMemoryModel(config, memoryModelPhase) : undefined;
  // A combo child is a synthetic replay of the parent's decision: its model is already the target's
  // concrete provider/model, so neither site below may rewrite or re-resolve it. It keeps the phase
  // through `options.memoryModelPhase` instead, which is what applies the phase effort.
  const memoryModelApplies = memoryModelTarget !== undefined && !concreteSelection;
  options.onRequestBodyParsed?.(body);
  // An effort row naming a table-less combo (`combo/x--high`) must reach the combo dispatcher
  // as its base id, so the selector is normalized here, before comboIdFromRawBody reads model.
  const comboRows = !concreteSelection && body && typeof body === "object" && !Array.isArray(body)
    && typeof (body as { model?: unknown }).model === "string"
    // One parse for both grammars, from the selector as the client sent it. Parsing them
    // separately made the outcome depend on which ran first.
    ? parseSyntheticRowId((body as { model: string }).model, config)
    : { fastRow: null, effortRow: null };
  const comboEffortRow = comboRows.effortRow;
  if (comboRows.fastRow) {
    // Same reason as the effort row above: the combo dispatcher reads `model` next, so the
    // selector has to be normalized before it, or a combo child is built from a synthetic id.
    const raw = body as Record<string, unknown>;
    raw.model = comboRows.fastRow.baseId;
    // A caller INTENT, not a decision. decideTier still rules on eligibility downstream, so
    // fastMode:false and an ineligible route both still suppress it.
    raw.service_tier = "priority";
  }
  if (comboEffortRow) {
    const raw = body as Record<string, unknown>;
    raw.model = comboEffortRow.baseId;
    const rawReasoning = raw.reasoning;
    raw.reasoning = {
      ...(rawReasoning && typeof rawReasoning === "object" && !Array.isArray(rawReasoning)
        ? rawReasoning as Record<string, unknown>
        : {}),
      effort: comboEffortRow.effort,
    };
  }
  const isCompactionTrigger = body !== null && typeof body === "object" && !Array.isArray(body)
    && Array.isArray((body as { input?: unknown }).input)
    && ((body as { input: unknown[] }).input).some((item: unknown) =>
      typeof item === "object" && item !== null && (item as { type?: string }).type === "compaction_trigger");
  // Compaction may send the last client-visible bare model after a combo switch.
  // Configured selectors take precedence; otherwise recall before combo dispatch (#3891).
  if (!concreteSelection && !options.compactionRoutingOverride && body && typeof body === "object" && !Array.isArray(body)) {
    const rawModel = (body as { model?: unknown }).model;
    if (typeof rawModel === "string" && !rawModel.includes("/") && isCompactionTrigger
      && !comboRows.fastRow && !comboEffortRow
      && !resolveComboId(config, rawModel)) {
      const recalledComboId = recallComboForLane(config, sessionLaneIdFromRequest(req.headers), rawModel);
      if (recalledComboId) {
        (body as Record<string, unknown>).model = `combo/${recalledComboId}`;
      }
    }
  }
  // A shadow-call replacement that names a COMBO is routing policy, not the identity of any
  // one pick. The late intercept site below resolves it through routeModel/tryPickComboModel,
  // which collapses the table to a single target while still tagging `routeKind: "combo"`, so
  // the combo gate on the next line never fires, handleComboResponses never runs, and 429/5xx
  // hops — which only exist inside that loop — are unreachable (#4129). Rewrite the selector
  // here instead, before comboIdFromRawBody reads `model`, and identify the combo by CONFIG
  // LOOKUP so the check can never observe a one-candidate collapse.
  // A memory target that names a combo has to reach the combo dispatcher as `model`, or its own
  // failover loop is unreachable (#4129) — the same reason the shadow intercept rewrites its combo
  // target here. Every other target is resolved at the late site, where the admission scope exists.
  let memoryModelComboRouted = false;
  if (memoryModelApplies && memoryModelTarget && body && typeof body === "object" && !Array.isArray(body)) {
    const memoryComboId = resolveComboId(config, memoryModelTarget.model);
    if (memoryComboId && Object.hasOwn(config.combos ?? {}, memoryComboId)) {
      memoryModelComboRouted = true;
      (body as Record<string, unknown>).model = memoryModelTarget.model;
    }
  }
  let shadowCallIntercepted = false;
  let shadowCallMatches = false;
  // Luna is also selectable by users/children. Both intercept sites use the same
  // per-turn provenance; WS frames must not inherit the handshake's classification.
  const threadSpawn = isThreadSpawnRequest(req.headers);
  const preserveShadowModel = shadowCallPreservesSelectedModel(body, req.headers, options.inboundTransport);
  if (!concreteSelection && !options.compactionRoutingOverride && !options.internalDecisionCall && !preserveShadowModel && !memoryModelApplies && body && typeof body === "object" && !Array.isArray(body)) {
    const shadowIntercept = config.shadowCallIntercept;
    const rawShadowModel = (body as { model?: unknown }).model;
    if (shadowIntercept?.enabled && shadowIntercept.model && typeof rawShadowModel === "string"
      && isShadowSourceModel(rawShadowModel, shadowIntercept.sourceModels)) {
      shadowCallMatches = true;
      const shadowComboId = resolveComboId(config, shadowIntercept.model);
      if (shadowComboId && Object.hasOwn(config.combos ?? {}, shadowComboId)) {
        shadowCallIntercepted = true;
        (body as Record<string, unknown>).model = shadowIntercept.model;
        // Same rule as the late intercept site: record the operator-configured prefix that
        // matched, never the caller's raw model string. Matching is by prefix, so the raw
        // value is caller-controlled and reaches usage.jsonl and /api/logs.
        logCtx.shadowCallRewrittenFrom = sanitizeLogMetadataString(
          shadowSourceModelPrefix(rawShadowModel, shadowIntercept.sourceModels),
        );
      }
    }
  }
  // The hard-lock fallback owns ordinary turns only, and only after every more specific
  // routing setting had its chance above: a shadow-intercepted, memory-phased, compaction
  // or decision turn keeps its own destination, and an intercepted combo selector is
  // already owned by the intercept. A spawned sub-agent turn names its model on purpose,
  // the same reason the shadow intercept leaves it alone. Like the sites above it, this
  // must run before comboIdFromRawBody reads `model`.
  if (!concreteSelection && !options.compactionRoutingOverride && !isCompactionTrigger && !options.internalDecisionCall
    && !shadowCallIntercepted && !shadowCallMatches && !memoryModelApplies && !threadSpawn && inboundWire === "responses") {
    try {
      options.mainHardLockFallbackOverride = await applyMainHardLockFallbackOverride(
        body, config, undefined, mainHardLockFallbackCallerCheck(req, config, options), options.admission,
      );
    } catch (error) {
      if (options.abortSignal?.aborted || req.signal.aborted) return clientCancelledResponse();
      if (error instanceof FallbackRefusedError) return error.response;
      const mapped = mapCodexAuthContextErrorToResponse(error, { now: Date.now() });
      if (mapped) return mapped;
      throw error;
    }
  }
  const comboId = !concreteSelection ? comboIdFromRawBody(body, config) : null;
  // A decision model may be a plain model or a non-JEV combo. A JEV combo here would recurse
  // into another decision, so the call is refused and the parent decision fails open.
  if (options.internalDecisionCall && comboId && config.combos?.[comboId]?.strategy === "jev") {
    return markProxyError(formatErrorResponse(400, "invalid_request_error", "A JEV decision model cannot be a JEV combo"));
  }
  if (comboId && Object.hasOwn(config.combos ?? {}, comboId)) {
    options.onRequestBodyRead?.();
    // The Antigravity direct lane is decided for one concrete route; a body that reached a combo
    // goes through the combo's own child loop with the full bridge conversation.
    restoreDirectRequestConversation(options, body, logCtx);
    return requestDispatchers.handleComboResponses(req, body, comboId, config, logCtx, {
      ...options,
      // Concrete combo child selectors no longer match the shadow source model. Carry the
      // interception decision explicitly so provider-specific helper isolation still applies.
      shadowCallIntercepted,
      // Same handoff for a memory phase whose target is a combo: the child keeps the phase's effort
      // override and stays out of the parent conversation.
      memoryModelPhase: memoryModelComboRouted ? memoryModelPhase : undefined,
      // The original request body was accepted above. Combo children are synthetic
      // replays and must not repeat the caller-owned timeout transition.
      onRequestBodyRead: undefined,
    });
  }
  let unreadableEncryptedAgentTask = hasUnreadableEncryptedAgentTask(
    (body as { input?: unknown } | undefined)?.input,
  );
  const inboundClientThreadId = req.headers.get("x-codex-parent-thread-id")?.trim() || undefined;
  // The request's OWN thread, which `x-codex-parent-thread-id` is not: parallel children of one
  // parent all present the same parent id. `codexConversationIdentity` already reads this header
  // for the same reason, and a surface that must tell siblings apart needs it too (#5033).
  const inboundOwnThreadId = req.headers.get("thread-id")?.trim() || undefined;
  const cursorClientThreadId = codexPoolAffinityKey(req.headers);
  const originalBody = body;
  if (options.comboReplaySnapshot) {
    copyPreviousResponseReplayProvenance(options.comboReplaySnapshot.sourceBody, body);
  } else {
    body = expandPreviousResponseInput(body, inboundClientThreadId);
    const replayFailure = previousResponseReplayFailure(body);
    if (replayFailure?.reason === "scope_mismatch") {
      // Bounded and content-free: no task scope and nothing about the retained entry.
      console.warn("[opencodex] refusing continuation because the client task scope does not match replay state");
    }
    // Local replay failures require full client replay.
    if (replayFailure) {
      return markProxyError(formatErrorResponse(
        400,
        "previous_response_not_found",
        "Continuation state is unavailable or corrupt; resend the full conversation without previous_response_id.",
      ));
    }
  }
  const previousResponseInputExpanded = options.comboReplaySnapshot?.previousResponseInputExpanded
    ?? (body !== originalBody
      && typeof (body as { previous_response_id?: unknown }).previous_response_id === "string");
  options.responsesInstructionImage ||= responsesHasInstructionImage(body);
  options.responsesFileImage ||= responsesHasFileImage(body);
  // Counted after replay expansion so the catalog this request pays for is the one measured:
  // input restored from stored continuation state is history, and the prefix removes it.
  if (inboundWire === "responses" && !concreteSelection) {
    warnEagerCodexToolCatalog(body, req.headers, {
      surface: eagerCodexToolCatalogSurface(body, options.compactionRecoveryKind),
      replayPrefixLength: previousResponseRestoredPrefixLength(body),
      logicalRequest: logCtx,
    });
  }

  // Spawn-message compatibility (both directions): agent_message task payloads ride in
  // encrypted_content slots as plaintext. Rewrite them to input_text on the RAW body BEFORE
  // parsing so every consumer sees the payload: parseRequest (routed/translated providers read
  // the parsed messages) and the native passthrough (_rawBody is this same object, serialized
  // verbatim). Structurally valid backend ciphertext stays byte-identical; encoded-looking unknown
  // slots remain opaque only until final-route handling can preserve or strip them safely.
  {
    const rewritten = sanitizeEncryptedContentInPlace(
      (body as { input?: unknown } | undefined)?.input,
      // The final destination is not known yet. Keep ambiguous encoded slots opaque until route
      // selection can either strip them for a third party or apply strict native classification.
      { preserveUnknownOpaqueSlots: true },
    );
    if (rewritten > 0)
      console.warn(
        `[opencodex] rewrote ${rewritten} plaintext encrypted_content part(s) to input_text (spawn-message compatibility)`,
      );
  }

  const skillsSnapshotScopeKey = resolveSkillsSnapshotScopeKey({
    req,
    config,
    admission: options.admission,
        promptCacheKeyIsSharedCohort: options.promptCacheKeyIsSharedCohort,
  });
  // Substitutes a known snapshot now; a new catalog is only stored once the request is prepared.
  const commitSkillsSnapshot = snapshotSkillsCatalogInBody(body, skillsSnapshotScopeKey, config);

  const turnMembership = responseTurnMembership(req, config, options.admission);
  if (turnMembership && body && typeof body === "object" && "input" in body && Array.isArray(body.input)) {
    body.input = turnMembership.normalize(body.input);
  }

  let parsed: OcxParsedRequest;
  let toolBridgeMaps: ReturnType<typeof buildToolBridgeMaps>;
  let clientToolCatalogRestriction: ClientToolCatalogRestriction | undefined;
  try {
    parsed = parseRequest(body);
    // Antigravity direct lane: the body carried only the request settings, so the parse above
    // produced them with an empty conversation; the conversation itself comes straight from the
    // client body. Inside this try so a decode error answers exactly like a parse error.
    if (options.directRequest) parsed = options.directRequest.decode(parsed);
    parsed._nativeReasoningRetention = resolveNativeReasoningRetention(config);
    // Capture before route rewrites or hosted sidecars can add tools; replayed catalogs are history.
    // Direct decoders already own current function names (including legacy Chat functions).
    // Project only those names; bridging the conversation would retain its reasoning twice.
    const catalogBody = options.directRequest && parsed.context.tools?.length
      ? { tools: parsed.context.tools.map(tool => ({ type: "function", name: tool.name })) } : parsed._rawBody;
    const currentCatalog = currentTurnWireToolCatalogBody(catalogBody, parsed._replayPrefixLen);
    // A hosted tool declared this turn authorizes the function name its translation uses.
    const translatedHostedNames = collectTranslatedHostedToolNames(currentCatalog);
    clientToolCatalogRestriction = {
      declaredToolNames: new Set([...collectDeclaredWireToolNames(currentCatalog), ...translatedHostedNames]),
      bareCustomToolNames: collectDeclaredBareCustomWireToolNames(currentCatalog),
      canonicalToolNames: new Set([...collectDeclaredWireToolNames(currentCatalog, { canonicalOnly: true }), ...translatedHostedNames]),
      // Ordinary Responses validation stays with its delivery owner; replay cannot add authority.
      enforceDeclaredToolNames: (inboundWire === "responses" && (parsed._replayPrefixLen ?? 0) > 0)
        || options.clientDeclaredEmptyToolCatalog === true
        || hasExplicitEmptyToolCatalog(currentCatalog),
    };
    if (options.inboundWire === "anthropic") {
      parsed._nativeReasoningReplay = options.nativeReasoningReplay;
      parsed._nativeReasoningMint = options.nativeReasoningMint;
      parsed._anthropicServerTools = options.anthropicServerTools;
      parsed._anthropicServerReplay = options.anthropicServerReplay;
      parsed._anthropicSystemCachePrefix = options.anthropicSystemCachePrefix;
      if (parsed.options.textFormat?.type === "json_schema") parsed._structuredOutputConformance = true;
    }
    parsed._promptCacheKeyIsSharedCohort = options.promptCacheKeyIsSharedCohort;
    // The body may have been rebuilt since the inbound observation (previous-response
    // expansion); alias the parsed raw body to the same draft so the outbound
    // observation at the adapter seam still finds it.
    rebindCacheDiagnosticBody(parsed._rawBody, logCtx.cacheDiagnosticDraft);
    // Captured before any parser mutates it, so both grammars see the client's id.
    const { fastRow, effortRow } = parseSyntheticRowId(parsed.modelId, config);
    if (fastRow) {
      parsed.modelId = fastRow.baseId;
      parsed.options.serviceTier = "priority";
      const raw = parsed._rawBody as Record<string, unknown>;
      raw.model = fastRow.baseId;
      raw.service_tier = "priority";
    }
    if (effortRow) {
      parsed.modelId = effortRow.baseId;
      parsed.options.reasoning = effortRow.effort;
      const raw = parsed._rawBody as Record<string, unknown>;
      const rawReasoning = raw.reasoning;
      raw.model = effortRow.baseId;
      raw.reasoning = {
        ...(rawReasoning && typeof rawReasoning === "object" && !Array.isArray(rawReasoning)
          ? rawReasoning as Record<string, unknown>
          : {}),
        effort: effortRow.effort,
      };
    }
    if (options.comboReplaySnapshot?.recoveredPlaintext) {
      markBodyNonPersistable(parsed._rawBody);
    }
    toolBridgeMaps = buildToolBridgeMaps(parsed, translatorBudget);
    if (previousResponseInputExpanded) parsed._previousResponseInputExpanded = true;
    const providerContinuationCandidate = options.comboReplaySnapshot
      ? options.comboReplaySnapshot.providerContinuation
      : previousResponseProviderState(parsed.previousResponseId);
    if (providerContinuationCandidate) parsed._providerContinuationCandidate = providerContinuationCandidate;
    if (inboundOwnThreadId) parsed._codexOwnThreadId = inboundOwnThreadId;
    if (inboundClientThreadId) {
      parsed._clientThreadId = inboundClientThreadId;
    } else if (
      options.inboundWire === "anthropic"
      && options.promptCacheKeyIsSharedCohort !== true
      && typeof parsed.options.promptCacheKey === "string"
      && parsed.options.promptCacheKey.trim().length > 0
    ) {
      // Claude Code has no Codex parent-thread header, but its metadata.user_id is
      // translated into a stable per-session prompt_cache_key. Use it as the replay
      // thread identity so Gemini thought signatures are remembered by call_id for
      // Anthropic Messages clients too (#1735/#1926). Keep `_clientThreadId` unset so
      // existing provider session-id derivation (first-user-text fallback) is unchanged.
      // Normalize through anthropicSessionKeyFromParts so overlong keys are hashed and
      // trimming matches the affinity/session-key path exactly (no raw >128-char ids).
      const normalizedCacheKey = anthropicSessionKeyFromParts({
        promptCacheKey: parsed.options.promptCacheKey,
        // The enclosing branch already proves this is not the shared cohort.
        promptCacheKeyIsSharedCohort: false,
      });
      if (normalizedCacheKey) {
        parsed._reasoningReplayScope = { clientThreadId: normalizedCacheKey };
      }
    }
    if (cursorClientThreadId) parsed._cursorClientThreadId = cursorClientThreadId;
    if (options.shadowCallIntercepted === true) parsed._cursorIsolateConversation = true;
    if (options.memoryModelPhase !== undefined) {
      parsed._memoryModelPhase = options.memoryModelPhase;
      parsed._cursorIsolateConversation = true;
    }
  } catch (err) {
    if (isTranslatorBudgetExceededError(err)) {
      return markProxyError(formatErrorResponse(413, "request_too_large", "request translation buffer exceeded the safe limit", {
        code: "translation_buffer_limit",
      }));
    }
    return formatErrorResponse(400, "invalid_request_error", err instanceof Error ? err.message : String(err));
  }
  options.onRequestBodyRead?.();
  const responseStateOptions = (force = false): { force?: boolean; clientThreadId?: string } => ({
    ...(force ? { force: true } : {}),
    ...(parsed._clientThreadId ? { clientThreadId: parsed._clientThreadId } : {}),
  });
  const resolvedConversationId = conversationIdFromResponsesRequest({
    clientThreadId: parsed._clientThreadId,
    sessionIdHeader: sessionIdHeaderFromRequest(req.headers),
    threadIdHeader: req.headers.get("thread-id"),
    cursorConversationId: parsed._cursorConversationId,
  });
  bindTurnTerminationScope(parsed, resolvedConversationId);
  const rememberKiroDeliveredFinalAnswer = (adapterName: string, response: unknown): void => {
    if (adapterName === "kiro") rememberDeliveredFinalAnswer(parsed, response);
  };
  // _clientThreadId remains the routing/continuation identity supplied by Codex. Replay state uses
  // a dedicated raw conversation namespace so mixed headers that carry the same identity still
  // match, and a shared/synthetic session_id cannot coalesce distinct thread/Cursor conversations.
  // Keep an Anthropic prompt_cache_key scope already bound above (#1735/#1926).
  if (!parsed._reasoningReplayScope) {
    const reasoningReplayConversationId = reasoningReplayConversationIdFromResponsesRequest({
      clientThreadId: parsed._clientThreadId,
      threadIdHeader: req.headers.get("thread-id"),
      cursorConversationId: parsed._cursorConversationId,
      sessionIdHeader: sessionIdHeaderFromRequest(req.headers),
    });
    if (reasoningReplayConversationId) {
      parsed._reasoningReplayScope = { clientThreadId: reasoningReplayConversationId };
    }
  }
  if (parsed._reasoningReplayScope) {
    // Scope replay cells to the caller principal. On loopback, admission carries no identity,
    // so resolve it from an opencodex API key the caller volunteered (same rule as context
    // history ownership). A caller that presents none has no principal, and none is invented:
    // every keyless local process would otherwise share one bucket, and a client-visible cell id
    // would become enough to read another caller's retained search result. Without a principal
    // bridgeSearchReplayScope yields no scope, so nothing is recorded or restored for it. The
    // field is always rewritten so an absent principal also clears one a reused holder carried.
    const clientPrincipalId = options.replayPrincipal
      ? options.replayPrincipal.clientPrincipalId
      : resolveContextPrincipal(req, config, options.admission);
    parsed._reasoningReplayScope = { ...parsed._reasoningReplayScope, clientPrincipalId };
  }
  // Prefer a pre-populated id (routed Claude) over Responses headers that may be
  // absent or synthetically injected (session_id from prompt_cache_key). A Hermes-only id
  // is a log fallback: native resolution replaces it, and it only fills an empty slot.
  assignNativeLogConversationId(logCtx, resolvedConversationId ?? nativeLogConversationIdFromHeaders(req.headers));
  fillHermesLogConversationFallback(logCtx, req.headers);
  // A rewritten turn logs the selector the client asked for, so the usage log never
  // claims the operator typed the fallback model themselves.
  logCtx.requestedModel = options.mainHardLockFallbackOverride?.sourceModel
    ?? options.compactionRoutingOverride?.sourceModel ?? parsed.modelId;
  logCtx.requestedEffort = parsed.options.reasoning;
  // What this request may spend beyond its input, for the durable spend reservation (#4707).
  // Read from the caller rather than from the adapter's serialized body, because the
  // reservation has to exist before the body does. A caller that omits it leaves the
  // provider/model default in charge and reserves only the input estimate; settlement then
  // books the real figure, so the gap is a looser bound up front, never a wrong one after.
  if (typeof parsed.options.maxOutputTokens === "number" && parsed.options.maxOutputTokens > 0) {
    logCtx.spendOutputCeilingTokens = Math.trunc(parsed.options.maxOutputTokens);
  }
  logCtx.callerServiceTier = sanitizeLogMetadataString(parsed.options.serviceTier);
  logCtx.requestedServiceTier = parsed.options.serviceTier;
  logCtx.requestedSpeedLabel = requestLogSpeedLabel(parsed.options.serviceTier);
  logCtx.configuredServiceTier = readConfiguredCodexServiceTier();
  logCtx.configuredSpeedLabel = requestLogSpeedLabel(logCtx.configuredServiceTier);

  let route: RouteResult;
  let credentialDomainWasRewritten = false;
  // The selector the caller actually sent, captured before shadow interception
  // or a subagent fallback rewrites it, so a refusal names the client's own
  // request rather than a destination it never asked for.
  const inboundSelector = options.clientModelLabel;
  const inboundRoutingSelector = options.mainHardLockFallbackOverride?.sourceModel ?? parsed.modelId;
  const selectorTargetsSecondary = (selector: string): boolean => {
    const slash = selector.indexOf("/");
    if (slash <= 0) return false;
    const qualifier = selector.slice(0, slash);
    // Match router precedence: exact custom keys (including uppercase names) win over aliases.
    if (Object.hasOwn(config.providers, qualifier)) return qualifier === "anthropic2";
    return qualifier === "anthropic2"
      || config.providers.anthropic2?.alias?.trim().toLowerCase() === qualifier.toLowerCase();
  };
  const explicitlyRequestsSecondary = selectorTargetsSecondary(inboundRoutingSelector);
  const secondaryProvider = config.providers.anthropic2;
  // Reserve an explicit B selector before an absent row can default-route it to A.
  // Combo parents have already dispatched above; concrete children retain their own target.
  if (explicitlyRequestsSecondary && (!secondaryProvider || secondaryProvider.disabled === true
    || secondaryProvider.authMode === "oauth" && configuredAnthropicInstance(config, "anthropic2") !== "anthropic2")) {
    return markProxyError(formatErrorResponse(401, "authentication_error", "Anthropic Pool 2 requires an enabled configured provider"));
  }
  const admissionScope = options.admissionScope ?? resolveAdmissionModelScope(config, options.admission);
  const advisorAdmissionPolicy = options.advisorAdmissionPolicy;
  const captureInboundRoutePolicy = (candidate: RouteResult, captureRequestPolicy = true): RouteResult => {
    // Router-collapsed aliases bypass the combo loop. Re-pick before capturing destination
    // policy so random/RR cannot refuse while an unmetered target is still usable.
    if (candidate.combo?.target.metered && !admissionMayUseMeteredComboTargets(
      config, options.admission, config.combos?.[candidate.combo.comboId],
    )) {
      const pick = pickComboTarget(config, candidate.combo.comboId, {
        eligible: target => !target.metered,
        allowCooldownReprobe: false,
      });
      if (!pick) {
        throw new NoAvailableComboTargetsError(candidate.combo.comboId,
          comboExclusionReasons(config, candidate.combo.comboId, target => !target.metered));
      }
      const routed = routeConcreteModel(config, `${pick.target.provider}/${pick.target.model}`);
      candidate = { ...routed, combo: pick, routeKind: "combo", routeReason: routed.routeReason === "blocked-model-redirect" ? "blocked-model-redirect" : "combo-pick" };
    }
    // Every route this request path produces passes through here: the direct
    // name, an alias, a policy or combo selection, a compaction override, a
    // shadow-intercept target and both subagent-fallback re-routes. Checking
    // the key's scope at this one point is what stops a rewrite from reaching
    // a destination the front door would have refused.
    // A shadow-intercept target is probed before interception is decided, so it
    // skips the request-owned policy capture here; the accepted target is
    // captured where it becomes the request's route. A declined policy target
    // must not lend its eligibility or "policy" route kind to the request.
    if (captureRequestPolicy) capturePolicyRequestRoute(policyScope, candidate);
    candidate.staticPolicy = captureRouteStaticPolicy(
      candidate.providerName,
      candidate.modelId,
      candidate.provider,
      candidate.staticPolicy.effectiveAlias,
      inboundWire,
    );
    // Fast-only keys authorize the same billed lane that final normalization serializes.
    assertRouteAllowedByScope(admissionScope, inboundSelector, {
      providerName: candidate.providerName,
      modelId: previewXaiOauthWireModel(parsed, candidate, config, inboundWire),
    });
    return candidate;
  };
  try {
    // A `compaction_trigger` turn may name a bare native model the operator has
    // no canonical OpenAI route for (#2901). Only the initial compaction route
    // may fall back to the configured default provider; combo attempts and the
    // later fallback/recovery re-routes keep the ordinary reservation.
    const routeInbound = (modelId: string) => {
      const resolved = concreteSelection
        ? routeConcreteModel(config, modelId)
        : parsed._compactionRequest === true
          ? routeCompactionModel(config, modelId, routeEvidence(options, parsed))
          : routeModel(config, modelId, routeEvidence(options, parsed));
      // A Pool 2 selector may leave Pool 2 only through an operator-configured cross-provider
      // blocked-model redirect, which the router marks as a credential-domain rewrite. Any other
      // destination means the selector fell through to default resolution, which stays refused.
      const operatorRedirect = resolved.routeReason === "blocked-model-redirect" && resolved.credentialDomainRewrite === true;
      if (selectorTargetsSecondary(modelId) && resolved.providerName !== "anthropic2" && !operatorRedirect) {
        throw new Error("Anthropic Pool 2 selector cannot use the default provider");
      }
      return resolved;
    };
    const resolveRoute = (modelId: string) => captureInboundRoutePolicy(routeInbound(modelId));
    // The phase's destination. Resolved through the admission-scoped resolver every other route
    // uses, and it fails closed exactly like the shadow target: falling back to the native model
    // would spend the quota the operator routed away from, without their choosing it.
    let memoryRoute: RouteResult | undefined;
    if (memoryModelApplies && memoryModelPhase && memoryModelTarget) {
      const memoryTarget = resolveChosenTarget(memoryModelTarget.model, resolveRoute);
      if ("unavailable" in memoryTarget) {
        logCtx.errorCode = MEMORY_MODEL_TARGET_UNAVAILABLE_CODE;
        return memoryModelTargetUnavailableResponse(memoryModelPhase);
      }
      credentialDomainWasRewritten = true;
      parsed.modelId = memoryModelTarget.model;
      if (parsed._rawBody && typeof parsed._rawBody === "object") {
        (parsed._rawBody as { model?: string }).model = memoryModelTarget.model;
      }
      parsed._memoryModelPhase = memoryModelPhase;
      parsed._cursorIsolateConversation = true;
      memoryRoute = memoryTarget.route;
    }
    const _sci = config.shadowCallIntercept;
    let shadowRoute: RouteResult | undefined;
    if (!concreteSelection && !memoryRoute && !options.memoryModelPhase && !options.compactionRoutingOverride && !options.mainHardLockFallbackOverride && !options.internalDecisionCall && !preserveShadowModel && _sci?.enabled && _sci.model && isShadowSourceModel(parsed.modelId, _sci.sourceModels)) {
      const sourcePrefix = shadowSourceModelPrefix(parsed.modelId, _sci.sourceModels)!;
      let sourceIdentity = { providerName: OPENAI_CODEX_PROVIDER_ID, modelId: sourcePrefix };
      try {
        const resolvedSource = routeConcreteModel(config, parsed.modelId);
        sourceIdentity = { providerName: resolvedSource.providerName, modelId: sourcePrefix };
      } catch { /* Native Codex helper calls remain OpenAI-owned without an enabled OpenAI route. */ }
      // A dead target fails this helper call once, before any send; it never falls through to
      // the native source model or to the default provider (#5618).
      const target = resolveShadowCallTarget(_sci.model, modelId => captureInboundRoutePolicy(routeInbound(modelId), false));
      if ("unavailable" in target) {
        logCtx.shadowCallRewrittenFrom = sanitizeLogMetadataString(sourcePrefix);
        logCtx.errorCode = INTERCEPT_TARGET_UNAVAILABLE_CODE;
        return interceptTargetUnavailableResponse(_sci.model, target.unavailable);
      }
      const targetRoute = target.route;
      if (shouldInterceptShadowCall(parsed.modelId, _sci.sourceModels, sourceIdentity, targetRoute)) {
        credentialDomainWasRewritten = true;
        const _sciOriginal = parsed.modelId;
        parsed.modelId = _sci.model;
        if (parsed._rawBody && typeof parsed._rawBody === "object") {
          (parsed._rawBody as { model?: string }).model = _sci.model;
        }
        // Record the operator-configured prefix that matched, NOT the caller's raw model string.
        // Matching is by prefix, so a caller can append arbitrary text and still intercept; that
        // raw value would then land in usage.jsonl and /api/logs behind a pattern-based redactor
        // that does not recognize every credential family. The prefix is a value the operator
        // configured, so no caller-controlled string is persisted.
        logCtx.shadowCallRewrittenFrom = sanitizeLogMetadataString(
          shadowSourceModelPrefix(_sciOriginal, _sci.sourceModels),
        );
        // Helpers must not resume/append into the parent thread's Cursor conversation.
        parsed._cursorIsolateConversation = true;
        shadowRoute = capturePolicyRequestRoute(policyScope, targetRoute);
      }
    }
    if (parsed._compactionRequest === true || options.compactionRoutingOverride) parsed._cursorIsolateConversation = true;
    route = memoryRoute ?? shadowRoute ?? resolveRoute(options.policyFallbackCandidate
      ? `${options.policyFallbackCandidate.provider}/${options.policyFallbackCandidate.model}` : parsed.modelId);
    // Selection-free hard-lock preflight grants no hop. Enforce the actual ranked destination
    // against the locked source before admitting this first selection.
    const hardLockProfileTrace = options.mainHardLockFallbackOverride ? route.routeDecision?.profile : undefined;
    if (hardLockProfileTrace && options.mainHardLockFallbackOverride) {
      const override = options.mainHardLockFallbackOverride;
      const hop = guardFallbackHop(config, {
        site: "routing-profile",
        route: override.sourceModel,
        aliases: [`policy/${hardLockProfileTrace.id}`],
        from: { provider: OPENAI_CODEX_PROVIDER_ID, model: override.sourceModel },
        to: { provider: route.providerName, model: route.modelId },
        trigger: "hard_lock",
        admission: options.admission,
      });
      if (!hop.ok) return hop.response;
      hop.commit();
    }
    leaveDirectLaneIfRerouted(options, route, parsed, logCtx);
    // Name the phase in the persisted route decision, so the request log says why this turn went to
    // the memory destination instead of leaving it looking like a plain user selection. Set here, on
    // the resolved route, so a combo child's own route carries it too.
    if (parsed._memoryModelPhase) {
      const reason = memoryModelRouteReason(parsed._memoryModelPhase);
      route.routeReason = reason;
      if (route.routeDecision) {
        route.routeDecision = {
          ...route.routeDecision,
          selected: { ...route.routeDecision.selected, reason },
        };
      }
    }
    if ((options.compactionRoutingOverride && !compactionRoutingKeepsProviderIdentity(config, options.compactionRoutingOverride, route))
      || options.mainHardLockFallbackOverride) {
      credentialDomainWasRewritten = true;
      // The destination does not share the conversation's credential domain, so it can neither
      // verify the source backend's reasoning ciphertext nor decode its native compaction blob.
      // This is the same condition an account change already reports (account-change-state.ts),
      // and the serializer turns a stored summary into readable text instead of dropping it.
      parsed._stripReasoningEncryptedContent = true;
      parsed._stripNativeCompactionEncryptedContent = true;
      if (parsed._compactionRequest === true) parsed._portableCompaction = true;
    }
    // A v1 fallback needs an ocx1 summary for replacement-history decoding, even when this
    // custom destination separately accepts native v2 triggers. Legacy defaults stay intact.
    if (options.compactionRecoveryKind === "compaction-v1" && parsed._compactionRequest === true
      && route.provider.adapter === "openai-responses" && route.provider.supportsNativeCompactionTrigger === true
      && !isCanonicalOpenAiForwardProvider(route.provider)) parsed._portableCompaction = true;
    logCtx.routeDecision = route.routeDecision;
    logCtx.policyEligibility = route.policyEligibility;
  } catch (err) {
    if (err instanceof AnthropicSecondaryInstanceUnavailableError) {
      return markProxyError(formatErrorResponse(401, "authentication_error", err.message));
    }
    const policyRefusal = policyCandidateRefusalResponse(err);
    if (policyRefusal) return policyRefusal;
    if (err instanceof AdmissionModelDeniedError) return admissionModelDeniedResponse(projectAdmissionModelDeniedLog(err, logCtx));
    if (err instanceof NoAvailableComboTargetsError) {
      return comboUnavailable(err.comboId, undefined, err.reasons);
    }
    if (err instanceof NoEligiblePolicyCandidateError) {
      // Persist the evaluation trace (per-candidate exclusions + the
      // no-eligible reason) so failed policy requests stay auditable.
      logCtx.routeDecision = err.trace;
    }
    return formatErrorResponse(404, "invalid_request_error", err instanceof Error ? err.message : String(err));
  }

  const hasUnexpandedPreviousResponse = !!parsed.previousResponseId
    && parsed._previousResponseInputExpanded !== true;
  const parentThreadId = req.headers.get("x-codex-parent-thread-id")?.trim() ?? null;
  const poolAffinityKey = codexPoolAffinityKey(req.headers) ?? null;
  let selectedForwardHeaders = req.headers;
  let subagentFallbackAccountId = config.activeCodexAccountId ?? null;
  const subagentQuotaFailureModel = parsed.modelId;


  let recoveryFailureReason: AgentTaskRecoveryFailureReason | undefined;
  // Native fallback and explicitly trusted direct Responses routes can consume ciphertext,
  // so recover only after final route selection.
  //
  // Deliberately NOT gated on `threadSpawn` (#4089). Switching a live thread from a native
  // ChatGPT model to a routed provider replays a backend-minted encrypted agent message on every
  // later turn, and a model switch is not a spawn, so the spawn requirement failed the thread
  // closed permanently without ever attempting recovery. The trust boundary is
  // `recoveryAdmission()` in ./agent-task-recovery -- Codex originator, live native ChatGPT
  // bearer, matching chatgpt-account-id, no inbound API key, no proxy-admission secret -- which
  // admits only the owner of the session that would be spent. `threadSpawn` narrowed which of
  // that owner's own requests could use their own session; it kept nobody else out. The combo
  // gate above keeps its spawn requirement: that path has its own native-target filtering and
  // per-attempt failover, and the reported defect is on this path.
  if (
    inboundWire === "responses"
    && agentTaskRecovery
    && !isCanonicalOpenAiForwardProvider(route.provider)
    && !options.comboAttempt
    && !canPassThroughEncryptedV2AgentTask(route, inboundWire)
  ) {
    let recovered = restoreCachedEncryptedAgentTasks(
      req, (body as { input?: unknown } | undefined)?.input, config, { parentThreadId },
    ) > 0;
    unreadableEncryptedAgentTask = hasUnreadableEncryptedAgentTask(
      (body as { input?: unknown } | undefined)?.input,
    );
    if (unreadableEncryptedAgentTask) try {
      const result = await recoverEncryptedAgentTaskWithResult(
        req,
        (body as { input?: unknown } | undefined)?.input,
        agentTaskRecovery,
        config,
        { parentThreadId, abortSignal: options.abortSignal },
      );
      recovered = result.recovered;
      recoveryFailureReason = result.recovered ? undefined : result.reason;
    } catch {
      recovered = false;
      recoveryFailureReason = undefined;
    }
    if (recovered) {
      unreadableEncryptedAgentTask = hasUnreadableEncryptedAgentTask(
        (body as { input?: unknown } | undefined)?.input,
      );
      if (!unreadableEncryptedAgentTask) {
        try {
          const reparsed = parseRequest(body);
          const kept: Array<keyof OcxParsedRequest> = [
            "_previousResponseInputExpanded",
            "_providerContinuation",
            "_providerContinuationCandidate",
            "_providerContinuationOwner",
            "_cursorConversationId",
            "_clientThreadId",
            "_codexOwnThreadId",
            "_promptCacheKeyIsSharedCohort",
            "_cursorClientThreadId",
            "_reasoningReplayScope",
            "_nativeReasoningRetention",
            "_cursorIsolateConversation",
          ];
          for (const key of kept) {
            if (parsed[key] !== undefined) {
              (reparsed as unknown as Record<string, unknown>)[key] = parsed[key];
            }
          }
          bindTurnTerminationScope(reparsed, resolvedConversationId);
          parsed = reparsed;
          // The recovery mutated `body.input` in place, so `_rawBody` now carries decrypted task
          // text. Bar it from the continuation cache before any recording path can reach it —
          // that cache is persisted to disk, which would defeat the recovery cache's TTL.
          markBodyNonPersistable(parsed._rawBody);

          // The ciphertext-only pass intentionally excludes routed candidates. Once recovery
          // makes the assignment readable, run selection again with the full configured chain
          // and keep the route in sync with any newly selected fallback.

        } catch {
          unreadableEncryptedAgentTask = true;
        }
      }
    }
  }

  if (options.abortSignal?.aborted) return clientCancelledResponse();

  if (inboundWire === "responses" && isCanonicalOpenAiForwardProvider(route.provider)) {
    const rewritten = sanitizeEncryptedContentInPlace(
      (body as { input?: unknown } | undefined)?.input,
    );
    if (rewritten > 0) {
      console.warn(
        `[opencodex] rewrote ${rewritten} non-Fernet encrypted_content part(s) before canonical native replay`,
      );
    }
  }

  // Encrypted child tasks may reach the canonical native backend or an explicitly trusted
  // direct Responses route. This runs against the FINAL route so native-only fallback can
  // rescue an incompatible primary without weakening combo behavior.
  const finalRouteCanPassThroughEncryptedTask = !options.comboAttempt
    && canPassThroughEncryptedV2AgentTask(route, inboundWire);
  if (
    (route.combo !== undefined || !isCanonicalOpenAiForwardProvider(route.provider))
    && !finalRouteCanPassThroughEncryptedTask
    && unreadableEncryptedAgentTask
  ) {
    return unreadableEncryptedAgentTaskResponse(recoveryFailureReason);
  }

  // The guard above asks whether the CURRENT worker task is readable, and it only inspects the
  // tail item. An `agent_message` that mixes readable text with backend ciphertext answers
  // "readable" to that question at every position, so it passed -- and then
  // `normalizeRoutedAgentMessages` refused to lower it, because lowering requires every part to
  // be representable. The raw Responses passthrough serialized the private item as it stood, so
  // backend ciphertext and an item type only the Codex backend declares reached a third-party
  // provider, which answered `422 unknown item type "agent_message"` (#4454).
  //
  // The opaque-blob path already knows the repair: replace the undecryptable part with an
  // omission marker, which leaves the item lowerable. It applied that repair only AFTER an
  // upstream rejection. For a destination that cannot accept the private item under any
  // circumstances, that round trip was never going to succeed and sent the ciphertext to find
  // out, so do the repair here instead. Recovery above has already had its chance to turn the
  // same bytes into real plaintext; only what it could not rescue reaches this.
  if (inboundWire === "responses" && !finalRouteCanPassThroughEncryptedTask) {
    // Only the raw Responses passthrough puts input items on the wire verbatim, so that is the
    // only wire this has to repair: translated wires rebuild the body from parsed messages, where
    // `inputContentParts` drops an encrypted part instead of forwarding it. The exemption is the
    // canonical Codex backend alone, because it is the one destination that minted these bytes and
    // can read them. `authMode: "forward"` is NOT that test -- a noncanonical forward gateway is
    // somebody else's server that happens to be configured for passthrough, and it receives the
    // ciphertext like any other third party.
    //
    // Combo children run this too. Each child carries its own `structuredClone` of the body
    // (`concreteComboRequestBody`) and its own concrete route, so a sibling's repair is invisible
    // here and a target that resolves to a routed Responses wire would otherwise send the
    // ciphertext that the parent's own dispatch no longer does.
    const wireProvider = resolveWireProtocolOverride(
      route.providerName,
      route.modelId,
      route.provider,
      inboundWire,
      route.staticPolicy,
    );
    if (wireProvider.adapter === "openai-responses" && !isCanonicalOpenAiForwardProvider(wireProvider)) {
      const repaired = stripAgentMessageCiphertextInPlace((body as { input?: unknown } | undefined)?.input);
      if (repaired > 0) {
        console.warn(
          `[opencodex] replaced ciphertext in ${repaired} replayed agent message(s) with an omission marker; the selected provider cannot read native ChatGPT ciphertext`,
        );
      }
    }
  }

  // The canonical ChatGPT backend rejects previous_response_id, so a local replay miss leaves no
  // safe way to recover the omitted history. Fail before auth, adapter construction, or upstream
  // I/O instead of stripping the id and silently forwarding a context-free delta (#702).
  // Codex recognizes previous_response_not_found on WebSocket errors and reconnects with its
  // full input. A generic invalid_request_error instead terminates the task after cache expiry.
  if (
    hasUnexpandedPreviousResponse
    && isCanonicalOpenAiForwardProvider(route.provider)
  ) {
    return markProxyError(formatErrorResponse(
      400,
      "previous_response_not_found",
      "Continuation state is unavailable or corrupt; resend the full conversation without previous_response_id.",
    ));
  }

  if (hasUnexpandedPreviousResponse) {
    const continuationProvider = resolveWireProtocolOverride(route.providerName, route.modelId, route.provider, inboundWire, route.staticPolicy);
    // Can the DESTINATION see the history this process failed to restore? Only the native
    // Responses passthrough can: it forwards previous_response_id to a backend that stored the
    // chain. Every translated wire rebuilds the conversation from this request's input alone —
    // including the three that look stateful, for the reasons recorded in
    // responses/continuation-ownership.ts — so a replay miss there is not a degraded turn. It is
    // the entire conversation deleted, with one user line left in its place and nothing in the
    // response saying so. Refuse before auth or upstream I/O and let the client resend.
    const continuationWire = resolvedAdapterWire(continuationProvider.adapter);
    const upstreamOwnsOmittedHistory = continuationWire === "openai-responses"
      // Stateless destinations cannot resolve the omitted prefix. Stateful destinations may,
      // but a lowered custom result still needs its call to recover the original wire type.
      // Native function/custom continuations without lowering keep their upstream-owned state.
      ? !(continuationProvider.statelessResponses === true
        || hasUnmappedRoutedCustomToolOutput(parsed._rawBody, continuationProvider.supportsResponsesCustomTools))
      // An unknown adapter is left to the resolution error it already raises below.
      : continuationWire === undefined || PROVIDER_OWNED_CONTINUATION_WIRES.has(continuationWire);
    if (!upstreamOwnsOmittedHistory) {
      return markProxyError(formatErrorResponse(
        400,
        "previous_response_not_found",
        "Continuation state is unavailable or corrupt; resend the full conversation without previous_response_id.",
      ));
    }
  }

  // Captured before normalization: whether the CLIENT asked for SSE. The
  // transport-neutral upstream-streaming policy below may force a bounded JSON
  // upstream for reliability (#875); the answer must then be reframed to SSE
  // for streaming clients.
  const clientRequestedStream = parsed.stream;
  const admittedPolicyRoute = { providerName: route.providerName, modelId: route.modelId };
  // Final guard before normalization may inject guidance into the raw body.
  leaveDirectLaneIfRerouted(options, route, parsed, logCtx);
  await applyFinalRouteRequestNormalization({
    parsed,
    route,
    config,
    req,
    logCtx,
    inboundWire,
    inboundTransport: options.inboundTransport,
    claudeGoAffinity: options.claudeGoAffinity,
    droidDefaultEffort: options.droidDefaultEffort,
  });
  try {
    assertPolicyNormalizedRoute(policyScope, admittedPolicyRoute, route);
    const copilotNegotiationPending = route.providerName === "github-copilot" && route.provider.authMode !== "forward";
    if (!copilotNegotiationPending && route.provider.adapter === "openai-chat"
      && !chatCanPreserveMandatoryToolChoice(parsed._rawBody, route.provider, route.modelId, parsed.context.tools ?? [])) {
      // Combo children carry the refusal's local identity too, so a compatible sibling target
      // can still be tried; a direct request keeps the client-facing 400 below.
      if (policyScope.eligibility || options.comboAttempt) throw new MandatoryToolChoiceUnavailableError();
      return mandatoryToolChoiceUnavailableResponse();
    }
  } catch (error) {
    const policyRefusal = policyCandidateRefusalResponse(error);
    if (policyRefusal) return policyRefusal;
    throw error;
  }
  // Static normalization can move the destination: resolving an
  // OpenAI virtual model rewrites route.modelId to the wire id that will
  // actually be billed. A scope checked only before this would authorize the
  // public selector and send the wire model, so the settled route is checked
  // once more here.
  const scopedDestination = parsed._wireModelOverride === undefined
    ? route
    : { providerName: route.providerName, modelId: parsed._wireModelOverride };
  // Synthetic turns keep the original client envelope label across provider normalization.
  if (options.compactionRoutingOverride || options.mainHardLockFallbackOverride || options.clientResponseModelLabel
    || options.internalDecisionCall || options.memoryModelPhase || options.visionDescribeTerminal
    || options.policyFallbackCandidate || parsed._memoryModelPhase || logCtx.shadowCallRewrittenFrom) {
    parsed._responseModelId = clientFacingModelText(options.clientResponseModelLabel ?? inboundSelector);
  }
  if (!routeAllowedByScope(admissionScope, scopedDestination)) {
    return admissionModelDeniedResponse(projectAdmissionModelDeniedLog(new AdmissionModelDeniedError(inboundSelector, scopedDestination), logCtx));
  }
  // A typed Advisor runs its own model server-side on this provider (#8448). The native lane refuses
  // a declaration outside the caller's scope; the Advisor is optional here, so it is not forwarded.
  const serverTools = parsed._anthropicServerTools;
  const scopedServerTools = serverTools?.filter(tool =>
    !nativeMessagesToolScopeDenial(admissionScope, route.providerName, route.modelId, { tools: [tool] }));
  if (serverTools && scopedServerTools && scopedServerTools.length !== serverTools.length) {
    parsed._anthropicServerTools = scopedServerTools;
    if (advisorServerToolDestination(route.provider)) addProtocolEntryReason(logCtx, "advisor-tool-outside-model-scope");
  }
  // Attribute local auth/cooldown failures to the public selector too; exact auth may fail before
  // the normal post-resolution provider label is assigned.
  if (route.codexAccountNamespace) {
    logCtx.provider = `${route.providerName}-${route.codexAccountNamespace}`;
  }

  if (options.abortSignal?.aborted) return clientCancelledResponse();
  // Resolve aliases/combo children before refusing helpers; do not spend main auth or host budget.
  if (isCanonicalOpenAiForwardProvider(route.provider)
    && isCodexReserveHelperUnsupported(options.codexAuthPolicy ?? config, route.modelId,
      options.admission, options.visionDescribeTerminal === true)) {
    return markProxyError(formatErrorResponse(400, "invalid_request_error", CODEX_RESERVE_HELPER_UNSUPPORTED_MESSAGE));
  }
  // #4940: the opt-in is off, so every Reserve affordance in this process is inert -- no catalog
  // row, no main-credential substitution, no authorization handshake, and no `luna-reserve` header
  // on the send. Forwarding `gpt-reserve` as an ordinary native model therefore buys nothing but a
  // 429 "The usage limit has been reached", which names neither the real cause nor the setting the
  // operator would have to change. Refuse here instead, on the same terms and in the same place as
  // the helper refusal above: after alias/combo resolution, before auth, host-circuit budget or any
  // upstream byte.
  //
  // Two narrowings beyond the predicate, both about not answering a question this refusal cannot
  // answer correctly. A terminal vision/search helper is excluded because enabling the opt-in would
  // not make it work -- it would produce the helper refusal above instead, so telling that caller to
  // enable the flag is advice that does not hold. Non-native inbound wires are excluded because a
  // `gpt-reserve` selector reaching us over Chat or Anthropic Messages is an operator-authored
  // route (a `claudeCode.modelMap` entry, say), not a Codex client that was forced onto Reserve by
  // its own usage snapshot, and that route keeps whatever behavior it has today.
  if (inboundWire === "responses"
    && options.visionDescribeTerminal !== true
    && isCanonicalOpenAiForwardProvider(route.provider)
    && isCodexReserveOptInMissing(options.codexAuthPolicy ?? config, route.modelId, options.admission)) {
    return markProxyError(formatErrorResponse(400, "invalid_request_error", CODEX_RESERVE_OPT_IN_REQUIRED_MESSAGE));
  }
  // Refuse an input that cannot plausibly fit the model context window before spending auth,
  // circuit budget, or upstream bandwidth on a turn the provider will reject anyway (#1412).
  //
  // Compaction turns are exempt: Codex sends compaction_trigger BECAUSE context is full, so
  // refusing the turn that shrinks the context would deadlock the client against the very
  // limit this gate reports — it would be told to compact and then denied the compaction.
  if (parsed._compactionRequest !== true) {
    // A combo child is the one caller that can afford a strict gate: skipping a target it
    // cannot fit is safe before any upstream bytes are sent, and the ladder continues. A
    // direct request has nowhere to go, so it keeps the loose pathological-input gate.
    const inputAdmission = options.comboAttempt
      ? checkComboTargetInputAdmission(parsed, route.provider, route.providerName, parsed.modelId, nativeContextLimits(config))
      : checkInputAdmission(parsed, route.provider, route.providerName, parsed.modelId, nativeContextLimits(config));
    if (!inputAdmission.admitted) {
      // #1524: this is a LOCAL preflight refusal, not an upstream verdict. A policy or combo
      // fallback must be able to skip this candidate and try one whose context window fits,
      // instead of treating the first incompatible candidate as the end of the chain. The
      // distinct code is what lets the fallback layer tell the two apart -- an upstream
      // `context_length_exceeded` still stops, because retrying it elsewhere is guesswork.
      projectLocalModelRefusalLog(logCtx, inboundSelector);
      if (clientRequestedStream && !options.comboAttempt) {
        return streamingContextOverflowResponse(
          clientFacingModelText(inboundSelector),
          translatorBudget,
        );
      }
      return markProxyError(formatErrorResponse(
        413,
        "input_admission_refused",
        inputAdmissionRefusalMessage(inputAdmission, inboundSelector),
      ), "input");
    }
  }
  const preAuthHostKey = preAuthUpstreamHostCircuitKey(route, config);
  if (preAuthHostKey) {
    const admission = acquireUpstreamHostAdmission(
      preAuthHostKey,
      config.upstreamHostCircuitThreshold,
    );
    if (admission.kind === "blocked") {
      return upstreamHostCircuitOpenResponse(admission.retryAfterSeconds);
    }
    admissionState.pendingHostAdmissionLease = admission.lease;
  }

  let substituteMainCredential = false;
  let callerAuthHeaders: Headers;
  {
    // #4778: uploaded files are scoped to the account that issued them, so a conversation
    // carrying live references must retain its binding across a voluntary quota move. Answered
    // from the body alone, by the same predicate the refusal guard uses, so the two can never
    // disagree about which conversations are in scope.
    const finalAuth = await resolveResponsesCodexAuth(
      req,
      config,
      route,
      options,
      credentialDomainWasRewritten,
      conversationCarriesUploadedFiles(parsed._rawBody),
    );
    if (!finalAuth.ok) return finalAuth.response;
    admissionState.authCtx = finalAuth.authCtx;
    selectedForwardHeaders = withClaudeNativeSession(finalAuth.headers, route.provider, options.claudeNativeSessionId);
    callerAuthHeaders = withClaudeNativeSession(finalAuth.callerAuthHeaders, route.provider, options.claudeNativeSessionId);
    substituteMainCredential = finalAuth.substituteMainCredential;
  }

  try {
    route.provider = applyCodexAuthContextToProvider(route.provider, admissionState.authCtx, route.codexAccountMode);
  } catch (error) {
    releaseCodexAuthContextProbeLease(admissionState.authCtx);
    if (options.abortSignal?.aborted || req.signal.aborted) return clientCancelledResponse();
    const mapped = mapCodexAuthContextErrorToResponse(error, { now: Date.now(), accountSelector: route.codexAccountNamespace });
    if (mapped) return mapped;
    throw error;
  }
  applyCodexAccountGatedWireNormalization(parsed, route, logCtx);
  try {
    recordPolicyPreparedDestination(policyScope, route.providerName, parsed._wireModelOverride ?? parsed.modelId);
  } catch (error) {
    const policyRefusal = policyCandidateRefusalResponse(error);
    if (policyRefusal) return policyRefusal;
    throw error;
  }
  logCtx.provider = route.codexAccountNamespace
    ? `${route.providerName}-${route.codexAccountNamespace}`
    : formatCodexProviderForLog(route.providerName, codexLogAccountId(admissionState.authCtx), config);
  logCtx.accountLogLabel = codexAuthContextLogLabel(admissionState.authCtx, config);
  // A move is the expensive event: it discards the prefix warmed on the previous account. Record
  // it as an event with its cause, so the operator reads it off one line instead of inferring it
  // from account labels across many (#4546).
  noteCodexSelectionAffinity(logCtx, admissionState.authCtx);
  {
    const binding = conversationStateBindingFromAuth(admissionState.authCtx, poolAffinityKey);
    if (binding) {
      // Before the scrub, because a file reference is refused rather than removed and the
      // refusal has to happen while there is still no dispatch to undo.
      const refusal = accountChangeFileReferenceRefusal({
        body: parsed._rawBody,
        bindingKey: binding.bindingKey,
        servingAccountId: binding.accountId,
      });
      if (refusal) return refusal;
      applyAccountChangeConversationStateScrub({
        body: parsed._rawBody,
        headers: selectedForwardHeaders,
        parsed,
        preserveReasoningEncryptedContent: isCanonicalOpenAiForwardProvider(route.provider)
          && parsed._nativeReasoningRetention?.accountSwitch === true,
        bindingKey: binding.bindingKey,
        servingAccountId: binding.accountId,
        logCtx,
      });
    }
  }
  // Seed an account-derived scope before final adapter binding. Cursor never treats it as
  // authoritative: bindRouteReasoningReplayScope replaces it with the exact route owner or a
  // per-request fail-closed sentinel after the final provider and credential are known.
  const identityScope = codexLogAccountId(admissionState.authCtx);
  if (identityScope) parsed._cursorIdentityScope = identityScope;
  subagentFallbackAccountId = admissionState.authCtx.kind === "pool" || admissionState.authCtx.kind === "main-pool"
    ? admissionState.authCtx.accountId
    : config.activeCodexAccountId ?? null;

  commitSkillsSnapshot?.();
  return {
    inboundWire,
    ...(turnMembership ? { turnMembership } : {}),
    ...(turnMembership && inboundWire === "responses" && parsed.stream && !parsed._compactionRequest ? { completedToolBlocks: true as const } : {}),
    clientDeclaredEmptyToolCatalog: options.clientDeclaredEmptyToolCatalog === true,
    clientToolCatalogRestriction,
    // Admission facts later route rewrites must not re-derive: the selector the caller sent and
    // the key scope as it stood when this request was admitted.
    inboundSelector,
    admissionScope,
    advisorAdmissionPolicy,
    translatorBudget,
    parsed,
    toolBridgeMaps,
    responseStateOptions,
    rememberKiroDeliveredFinalAnswer,
    route,
    get selectedForwardHeaders(): typeof selectedForwardHeaders {
      return selectedForwardHeaders;
    },
    set selectedForwardHeaders(value: typeof selectedForwardHeaders) {
      selectedForwardHeaders = value;
    },
    get subagentFallbackAccountId(): typeof subagentFallbackAccountId {
      return subagentFallbackAccountId;
    },
    set subagentFallbackAccountId(value: typeof subagentFallbackAccountId) {
      subagentFallbackAccountId = value;
    },
    subagentQuotaFailureModel,
    poolAffinityKey,
    clientRequestedStream,
    substituteMainCredential,
    callerAuthHeaders,
  };
}

export type PreparedResponsesRequest = Exclude<Awaited<ReturnType<typeof prepareResponsesRequest>>, Response>;
