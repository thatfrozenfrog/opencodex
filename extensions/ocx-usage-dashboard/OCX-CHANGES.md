# OCX-history usage dashboard

Personal source fork of @tmustier/pi-usage-extension; original LICENSE preserved.
Loaded through ../extensions/pi-ocx.ts. The npm entry remains disabled to avoid
duplicate /usage registration. Package updates do not overwrite this fork.

## Authoritative source

/usage uses GET /api/request-history, cursor-paginated to exhaustion with no lower
time cutoff and a fixed upper timestamp. This is OCX's index of retained
usage.jsonl, not Pi's sessions, /api/logs' in-memory buffer, or live quotas.
All clients' retained traffic is included. All Time includes every fetched row;
the other tabs filter those rows using the dashboard's local calendar boundaries.
Incoming requests after the snapshot timestamp appear on the next open. A recent
in-memory snapshot is reused only when index metadata matches; it expires after
30 seconds to bound stale display-time pricing. Changed or uncertain indexes reload.

The Bun subprocess first validates the selected OCX inference URL against the
locally discovered management server, then uses the existing authenticated
runtime client with redirects refused. A cancelled loader aborts the subprocess.
Full loading has a bounded timeout and output buffer. Pagination/API/limit failures
show an error, never partial totals or a silent Pi-only fallback.

## Attribution and counting

history.ts projects content-free accounting fields from history DTOs. Recorded
attempts are attributed to their actual provider/model. When attempts exist, the
parent usage is not counted again. Legacy rows without attempts use the parent.
Local-only answers are excluded. Request IDs dedupe overlapping pages; request ID
plus attempt ordinal prevents equal-timestamp/equal-token attempts colliding.
Provider names use OCX's canonical usage labels: recognized account suffixes and
OpenAI aliases are grouped under their base provider, while unrelated configured
provider names remain distinct. No current-catalog guess is needed.

The table's Attempts column and graph's messages metric count upstream attempt
records (including failures with no measured usage), not logical user messages.
Known conversation IDs form sessions; unknown conversations share one explicit
bucket, so the Sessions column is not an exact conversation count.

Costs use OCX display-time estimates, not invoices. Unpriced/unmetered attempts
have no known cost and contribute zero to cost sums; they are not proven free.
Input normalizes OCX's inclusive input count into fresh input plus separate cache
read/write, preferring the OCX cost normalizer's token vector when available.
Token totals and graphs include cache reads and use OCX's display total (the larger
of inclusive input + output and the recorded explicit total). Cache reads are also
shown separately. Graphs default to tokens. No Pi totals are added to OCX totals.

Insights do not infer Pi-specific context/cache behavior from OCX history; they
show source/counting caveats instead. Live quotas remain a separate footer.
No historical rows are written, and no retention policy is changed. Expired,
deleted, or never-recorded traffic cannot be reconstructed.

## Source changes and maintenance

- data.ts: optional external parsed-history input bypasses disk session/cache scan;
  exact request-attempt IDs dedupe it; original period/hourly aggregators are reused.
- history.ts: exhaustive API pagination and usage projection.
- index.ts: cancellable history loader, OCX title, Attempts label, token default.
- pi-ocx.ts: bounded Bun history bridge and existing independent quota status.

Port future upstream changes manually while retaining these changes.
Tests: ../extensions/tests/{pi-ocx,ocx-history}.test.ts.
No OCX repository source or managed npm package files were changed.
