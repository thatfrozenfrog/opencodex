# Model Price Overrides

## Configuration and API

`ProviderCostOverlay` in `src/types/provider.ts` keeps four required base rates and an optional
`promptLengthPricing` discriminated policy: `automatic`, `flat`, or `custom` with a positive
safe-integer `thresholdTokens`, `gt`/`gte` comparison and four absolute alternative `rates`.
Absent policy retains legacy automatic context behavior. `src/config/schema/leaf-validators.ts`
rejects malformed/unknown nested fields on writes and copies only validated policy fields for
display, dropping an explicit `automatic` policy so absence is the single stored form of
Automatic; load degradation drops an invalid model row without losing the provider.

`src/providers/openai-tiers.ts` accepts these same rate and policy shapes through the shared
`validCost4` predicate in the pure `src/usage/user-cost-validation.ts` module when migrating
legacy `openai-multi` overlays. It rejects unknown row
fields and malformed policies, and preserves valid policies while rewriting model keys to `openai`.
`tests/adapters/openai/openai-provider-option-migration.test.ts` covers preservation and rejection.

`src/server/management/model-routes.ts` serves `GET/PUT /api/providers/{provider}/model-costs`.
GET and successful PUT receipts retain all four rates and the optional validated policy.
A `cost: null` write removes the entire model override. Writes retain atomic persistence,
rollback and sibling-model preservation. `tests/server/model-costs-prompt-length-pricing.test.ts`
covers persistence, receipts, reset, rollback and external edits.

`src/config/live-reconcile.ts` scopes explicit pricing PUT intent to one complete model row.
After recursive reconciliation under the config mutation lock, it reapplies that row (or its
deletion) and validates the final candidate before publication. This prevents concurrent mode
changes from mixing Custom fields into Flat/Automatic policies, and honors replacement even
when the submitted base rates equal the old baseline. Unrelated saves still adopt disk edits.
`src/cli/models-runtime.ts` reads the complete policy in `cost` and projects only base rates in
`effectiveCost`. `set-price` reads the current row first and carries that model's policy into
the replacement row, so a base-rate edit never silently drops a Flat or Custom policy; its receipt
must echo the same policy, with absent and `automatic` treated as equal.

## Live models.dev pricing

`src/usage/models-dev-pricing.ts` keeps a bounded in-memory copy of the public
`https://models.dev/api.json` catalog and a per-config-directory cache at
`models-dev-pricing-cache.json` (24-hour TTL, 16 MiB body cap, five-second
deadline, redirects refused, coalesced refresh, stale data retained offline).
`GET /api/usage` and `GET /api/usage/model-price-candidates` call
`ensureModelsDevPricing()`; a first visit waits for the catalog, later visits
serve the cached copy while a stale one refreshes in the background. A test
or embedder can set `OPENCODEX_MODELS_DEV_PRICING=0`; `tests/preload.ts` does,
and the catalog suites seed `seedModelsDevPricingForTests()` instead.

Resolution order in `src/usage/cost.ts` is user `modelCosts`, an exact official
correction (`VERIFIED_PRICE_OVERRIDES`), then either a curated expected-price
overlay or — when no curated row exists — the live models.dev row before the
generated opencode bundle. Curated overlays retain their legacy position behind
the bundle and win where the bundle has no row. A live row carries
`source: "modelsdev"`, `modelsDevProvider`, and `status: "verified-derived"`
because it is a public catalog copy, not an opened vendor page. The live catalog
therefore cannot reduce Venice's 1.25x mapping or a curated long-context
correction.
`modelsDevPricingVersion()` joins `userCostOverlayVersion()` in the retained
aggregate and summary cache identities, so a refresh reprices existing rows
instead of serving totals computed from the previous catalog.

A `<vendor>/<model>` id is priced from that vendor before the serving provider's
own row, so a reseller or custom route cannot substitute its list price for the
model's official one. A single prefix must name a canonical vendor
(`deepseek/deepseek-v4.1-flash` → vendor `deepseek`, bare
`deepseek-v4.1-flash`); a bare id keeps exact-provider resolution first and is
then searched across every canonical vendor. Lookup per vendor is the live models.dev vendor row, then the bundled
vendor row, then the provider-independent `OFFICIAL_MODEL_PRICES` table for ids
the vendor page lags. `deepseek-v4.1-flash` is registered there (with a matching
`deepseek` overlay row) so a custom provider and the OpenCode Go surface price
from DeepSeek's official peak-window list. A prefix that disagrees with the
model (`openai/claude-opus-4-6`) fails closed, and reseller rows (Azure,
Bedrock, aggregators) are not canonical vendors: a model id that only a
reseller publishes stays unpriced until the operator chooses a listing. The Usage Models table's **Bill as** control
(`gui/src/components/BillAsDialog.tsx`) asks
`GET /api/usage/model-price-candidates` for at most ten fuzzy-ranked listings,
then writes the chosen four-rate tuple through the existing
`PUT /api/providers/{provider}/model-costs` contract (or `cost: null` for
automatic pricing). `tests/usage/usage-models-dev-pricing.test.ts` covers refresh,
cache reload, aliases, ranking, precedence and memo invalidation;
`tests/server/api-usage.test.ts` covers the candidate endpoint.

## Dialog and estimates

`gui/src/components/ModelPriceDialog.tsx` edits base rates plus Automatic, Flat rate or Custom
threshold pricing. Automatic retains catalog context rules with the saved base tuple. Flat skips
context adjustments; Custom replaces the catalog rule on both sides of its single threshold.
Parsing, draft building, per-field validation and receipt comparison live in the pure
`gui/src/components/model-price-cost.ts`; the dialog sends no policy for Automatic, validates
complete policy receipts before refreshing the model list and retains its uncertain-outcome/reload
flow. `gui/tests/models-price-editor.test.tsx` covers this behavior.
The comparison Select renders its menu inside the modal dialog so native modal inertness does
not block pointer or keyboard interaction with its options.

`src/usage/cost.ts` selects rates against inclusive `usage.inputTokens`, before subtracting cache
reads/writes for cost estimates; output is excluded from threshold selection. Alternative rates
apply to every token bucket of the request. Custom rates are standard-speed rates that stand in
for the catalog long-context rate, so a crossed threshold follows the catalog's
`confirmedPriorityRelation` for that model: `stack` (or no catalog rule) applies the Priority
multiplier once, `lower-bound` keeps the custom rates and sets `priorityLowerBound`, and
`exclusive` prices a confirmed Priority request from the base rates. Confirmation requirements are
unchanged. `customThresholdApplied` stays separate from the catalog `contextTier` marker and is
set only when the custom rates priced the request. Each Combo attempt selects its own tuple.
`tests/usage/usage-prompt-length-pricing.test.ts` pins boundaries, cached prompts, whole-request
rates, compatibility, Combo and Fast/Priority behavior.
It also verifies Automatic Haiku overrides at 99,999/100,000/100,001 inclusive prompt tokens,
including cache reads/writes and the inherited catalog band for both Anthropic OAuth pools.

`src/usage/user-cost-overlays.ts` copies the complete policy into its versioned registry:
policy-only edits invalidate price memoization and usage caches; identical reloads remain stable.
`tests/server/model-costs-pricing-cache.test.ts` exercises warmed cache invalidation and reset.
These settings affect estimates, not upstream billing or official catalog price lists.

Only reported or estimated usage is priced by `src/usage/cost.ts`. Partial tokens on an unreported or unsupported attempt do not establish its full cost. `src/usage/summary.ts` marks a multi-attempt request unpriced when any potentially billed attempt lacks measured usage, while a refusal before generation without usage remains a known zero. Measured attempts retain their individual estimates.
