---
status: proposed
date: 2026-10-21
decision-makers: "User (behavioral requirements); coding assistant (integration recommendation)"
---

# ADR-7281 — decision recorded under "OMP model usage"

## Context and Problem Statement

OMP (Oh My Pi) sees opencodex as one custom provider. The existing model export in
`src/clients/config-export/omp.ts` supplies no usage provider. Upstream subscription
quotas differ by provider and sometimes model; proxy token consumption is not a
subscription allowance. The user requests an extension with per-model quotas,
updates when models or their opencodex provider classification change, and compatibility
with OMP's existing usage/statusline readers.

## Decision

The user authorized planning and implementation of that behavior. The assistant
recommends an optional OMP extension registering a normalized `UsageProvider` for
`opencodex`, without replacing models or changing inference authentication. This
architectural recommendation remains proposed, not user-accepted merely by implementation.

Read existing authenticated management interfaces through `src/cli/runtime-api.ts`:
`/api/models`, `/api/client-config?client=omp`, and `/api/provider-quotas`. Pin each
snapshot to one discovered management origin. Match exact exported model selectors
against catalog identities, including native and Fast rows; never split arbitrary
selectors or guess providers from model names. Verify the configured inference base
URL against the generated OMP export before publishing usage.

Project existing percentage windows, reset times, USD balances, credit counters, and
explicit model/family scopes into OMP reports. Preserve observation times and source
labels; do not add quotas across providers. Missing or failed measurements stay
unavailable. A dynamically routed combo has no single static provider quota; do not
advertise one candidate's allowance as the combo's allowance.

Use the native usage hook for `/usage` and native statusline retrieval. Refresh on
session start, after completed turns, and model identity changes using OMP's available
lifecycle/read APIs. Re-read catalog ownership on periodic refresh, even when the
selected model string is unchanged. Cancel or fence obsolete work before publication.
OMP's native powerline statusline displays recognized subscription window types (5h, 7d,
daily, monthly) directly from the registered usage provider; a separate bottom line status entry
is not needed and is omitted.

Non-goals: new upstream quota probes, routing changes, credential export, global
installation without an explicit user action, or pretending unavailable quota equals 0%.

## Consequences

- Existing OMP readers consume the same normalized report; model selection uses exact scope IDs.
- opencodex remains the upstream quota authority; OMP needs no upstream credentials.
- The extension needs a compatible installed OMP and access to the same local proxy context.
- Periodic refresh adds bounded management reads only while this optional extension runs.
- Model-scoped windows such as Xpiki's per-model shared quotas map to the 5h short quota window for native powerline display.
- Unavailable measurements, ambiguous ownership, and combos are explicitly unknown rather than estimated.

## Implementation Plan

- Required skills: `clean-code` for the implementation; `adr-skill` for the decision record.
- Affected paths: `src/clients/omp-usage*.ts`, `extensions/omp-usage.ts`,
  `tests/clients/omp-usage.test.ts`, test-layout registration maps,
  `package.json`, `structure/clients/integrations.md`, and the public integration guide.
- Dependencies: use OMP's host-supplied extension types and existing Bun runtime;
  no new proxy runtime dependency.
- Keep projection and lifecycle logic testable separately from the host adapter.
- Follow the existing export normalizer for Fast selectors and runtime management discovery.
- Preserve models.yml and existing model/credential registrations. Loading is opt-in via `omp -e`.
- Add focused behavior regressions for scopes, percentage conversion, source remapping,
  unknown data, cancellation, and stale completion suppression.

### Verification

- [ ] Distinct provider quotas reach the correct exact OMP model scopes.
- [ ] Percentages are fractions in OMP reports; true reset timestamps and units survive.
- [ ] Model switches and same-selector catalog ownership changes replace old usage.
- [ ] Failed/obsolete refreshes never display another model's last successful quota.
- [ ] Installed OMP loads the extension and its usage CLI consumes reports.
- [ ] Native statusline quota display is exercised without an upstream inference request.
- [ ] Focused tests and TypeScript validation complete; outcomes are recorded below.

## Alternatives Considered

- Forward vendor-specific response headers: cheap for some vendors, but loses polled quota,
  balances, and provider/model identity behind the router.
- Replace `/usage` with a custom command and statusline: easier formatting, but bypasses
  existing OMP consumers and creates a second reporting convention.
- Add a new public quota endpoint: avoids local management integration, but introduces a
  new authorization boundary not needed for the existing local OMP integration.

## More Information

Contract owner: `structure/clients/integrations.md`, section "OMP model usage".
Relevant records: [usage read failures](ADR-0106-usage-read-failure-contract.md),
[management/inference ports](ADR-6598-management-inference-port.md), and
[model identity](ADR-0088-model-and-wire-identity.md).

Revisit when OMP provides a stable model-change event or generalized native quota windows,
or when opencodex exposes an authorized model-specific quota data-plane contract.

## Implementation receipts

Pending implementation and validation; this record does not claim acceptance or shipment.
