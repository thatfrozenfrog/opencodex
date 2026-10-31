# Personal Pi OCX usage integration

`../pi-ocx.ts` is auto-discovered as a personal Pi extension. It loads the local
source fork at `~/.pi/agent/ocx-usage-dashboard/index.ts`.
`@tmustier/pi-usage-extension` remains installed with `extensions: []` in personal
settings to avoid duplicate /usage registration.

- `/usage`: all retained OCX router history across all clients, grouped by actual
  recorded upstream provider/model, not Pi session history. Tabs filter that
  history; select All Time for the complete retained range. Graphs default to
  total tokens including cache reads. Costs are OCX estimates, not invoices. Table counts are attempts.
- `/ocx-usage`: refresh selected-model live quotas, independent of history.
- Footer: live quotas refreshed every 30 seconds and after runs. Codex shows the selected account, not pooled capacity; missing account readings stay unavailable.

Loading history requires the local router to be running and selected. Failed or
cancelled full-history loads never silently show partial or Pi-only totals.
Each open checks the history index; a matching recent in-memory snapshot skips
pagination. Changed history or a snapshot over 30 seconds old reloads all pages.
Quota refresh does not block the dashboard. No history or retention settings are modified. Deleted/unrecorded traffic is not recoverable.

The adapter runs `~/.bun/bin/bun` in a bounded cancellable subprocess to use the
existing OCX authenticated management client. ROOT currently points to
`/home/kiwi/Projects/AIRouter/opencodex`; update it if moving the checkout.
Read `../../ocx-usage-dashboard/OCX-CHANGES.md` for attribution, counting, cost,
cache-token semantics, retention limits, and source-fork maintenance.

Run `/reload` or restart Pi to apply changes.

Validation (from the OCX checkout):

```sh
bun test ~/.pi/agent/extensions/tests/pi-ocx.test.ts ~/.pi/agent/extensions/tests/ocx-history.test.ts
bun node_modules/typescript/bin/tsc -p ~/.pi/agent/extensions/tests/tsconfig.json
```

Actual Pi loader, OCX history pagination and dashboard rendering were also
smoke-tested together under the installed Node harness against the live router.
No OCX repository source or installed npm package files were changed.
