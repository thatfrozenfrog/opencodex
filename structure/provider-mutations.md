# Provider mutations

## Durable provider PATCH

Provider editor snapshots and management writes validate provider-wide `inputModalities` through `providerManagementConfigError` in `src/server/auth-cors.ts`, sharing the [config modality contract](config.md#explicit-per-model-capability-declarations). Malformed declarations are refused before persistence or catalog refresh; the field remains editor-owned rather than a credential or derived DTO field. `PUT /api/combos` shares this transaction for combo changes, rename references, disabled selectors and request-only Vision Sidecar enrollment; see `tests/routing/combo-vision-enrollment.test.ts`.

`src/server/management/provider-routes.ts` commits every provider PATCH variant through
`src/server/management/provider-patch-transaction.ts`, including standalone default-provider
and account-mode changes. The synchronous mutation lock encloses snapshot, mutation, save,
and pre-publication failure restoration. Field masks are replayed against the latest provider under that same
lock after asynchronous destination validation; rollback retains previously committed siblings.

Persistence can rebase the whole live configuration before a write. Rollback therefore restores
the original plain-object/array graph in place, including property descriptors, symbols, absent
versus undefined fields, provider key insertion order, container identities and pending deletion provenance. Opaque
runtime objects and accessor descriptors retain their identity; snapshotting invokes no getters.
After atomic publication (or an already-identical persisted body), a bookkeeping failure remains
an error but retains the published live state. `ConfigWritePublishedError` from
the configuration persistence boundary distinguishes that outcome from a refused write; rolling back
only memory would disagree with disk. Follow-up refresh work may remain pending after this error.
Reconciliation, model-cache invalidation, quota/thread-cache changes, priming and catalog
convergence remain after successful persistence in their existing order. Pacing-only updates
keep their existing no-catalog-refresh behavior. The regression suite is
`tests/server/management-provider-atomicity.test.ts`.
> Decision record: [Durable provider PATCH](decisions/ADR-0104-durable-provider-patch.md)
> Decision record: [Publication-aware rollback](decisions/ADR-0120-provider-patch-publication-boundary.md)

Automatic account exhaustion and recovery use the [spendable Codex credit evidence contract](providers/openai-tiers.md#spendable-codex-credits), including independent freshness, upstream refusal, and reset-ticket separation. The PINNED badge confirms before sending a null selection, which clears the pin and returns routing to automatic while bound threads keep their captured account. The dashboard also sends `expectedPinnedAccountId`; the persisted mutation rejects a changed pin with `account_pin_changed` before writing. Refused or uncertain releases reload `/active` and close the old confirmation without claiming that the prior selection survived.

`src/server/management/subagent-model-routes.ts` owns roster/picker and optional Claude force updates. The route registry declares its GET/PUT ownership; `agent-settings-routes.ts` only lazy-loads and delegates the matching path. GET includes `force`, exposed-only `forceAvailable`, and bounded `forceStatus`; PUT accepts force alone, null clears, and omission preserves it. Force-only updates do not regenerate the roster or converge Codex catalogs. The Subagents page keeps save failures visible and disables overlapping force writes. `src/server/management/codex-cli-update-routes.ts` serves the same proof-bound Codex CLI plan to the dashboard, admits apply only from a confirmed, currently paired dashboard session (`hasHumanDashboardSession` and `sessionControl.isPaired`) on trusted loopback ingress, and exposes authenticated job status. The job ID is a lookup key, never authorization; CLI status reads the protected common job record directly. The route registry declares the three paths and the CLI/local-transport parity; `tests/server/persistent-dashboard-consent.test.ts` exercises its mutating session-only routes through management admission, including current-session logout.
