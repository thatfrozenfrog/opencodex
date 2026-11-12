# Codex runtime agent assertions

## Codex runtime agent assertions

Authorization scheme parsing lives in `src/lib/authorization-scheme.ts`, and every former
`replace(/^Bearer\s+/i, "")` read uses it. Codex 0.164 runtime agent assertions add a value that is
neither an admission secret nor a caller credential. `Authorization: AgentAssertion` (assertion_only)
is never a bearer, never admitted, and never forwarded: the request fetch handler refuses it with
`agent_assertion_unsupported` before admission or routing, and Responses auth plus
`materializeCodexUpstreamAuth` refuse it again so no pool or substituted credential can stand in for
it. The dual_header `x-openai-agent-assertion` is outside `FORWARD_HEADERS` and blocked from
`forwardClientHeaders`. It is carried only for canonical-forward Direct when the outbound Bearer is
the caller's original one, and is dropped under a pool override. Coverage:
`tests/server/agent-assertion-auth.test.ts` and `tests/responses/agent-assertion-routes.test.ts`.

Chat upstream error responses use [the owned client-body contract](error-detail.md#client-error-bodies-chat). Native and translated local refusals retain producer provenance; upstream-derived failures select fixed wording. Undeclared-tool refusals share one fixed sentence without the tool name across Chat, Messages and Responses. Choice error normalization preserves all other ordinary relay fields.
