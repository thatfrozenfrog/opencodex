# Token saver parity oracle

Reference: `luqman-v1/9router-go@f1eb955f9e97c73a7d9932c6b93a4765e5ca68fd`.

The 142 cases in `token-saver-parity.json` contain Go-produced expected values, not TypeScript snapshots. They cover the 55 catalog files' embedded examples plus boundaries, intensity, disabled filters/categories, fallback algorithms, diagnostic preservation and UTF-8 byte truncation. Expected text, technique lists, category and all estimated-token fields are compared exactly.

To regenerate with Go 1.27.3, set `REFERENCE` to the reference checkout and verify its commit first. Run from the opencodex repository:

```sh
test "$(git -C "$REFERENCE" rev-parse HEAD)" = f1eb955f9e97c73a7d9932c6b93a4765e5ca68fd
mkdir -p "$REFERENCE/.tmp/token-saver-oracle"
cp tests/fixtures/token-saver-oracle.go "$REFERENCE/.tmp/token-saver-oracle/main.go"
bun -e 'import f from "./tests/fixtures/token-saver-parity.json"; for (const {expected,...input} of f.cases) console.log(JSON.stringify(input))' > /tmp/token-saver-input.jsonl
(cd "$REFERENCE" && go run ./.tmp/token-saver-oracle </tmp/token-saver-input.jsonl) > /tmp/token-saver-expected.jsonl
bun -e 'import f from "./tests/fixtures/token-saver-parity.json"; const cases=(await Bun.file("/tmp/token-saver-expected.jsonl").text()).trim().split("\n").map(JSON.parse); await Bun.write("tests/fixtures/token-saver-parity.json",JSON.stringify({reference:f.reference,cases})+"\n")'
bun test tests/server/server-tool-result-compression.test.ts
```

## Deliberate HTTP boundary differences

- RTK defaults off, preserving existing opencodex installs.
- Complete JSON tool results remain untouched at HTTP ingress. The standalone reference text engine may still apply final size limits to JSON; the parity fixtures exercise that engine separately.
- Only paired results with resolved tool calls are filtered; protected tools and flagged errors are preserved.
- Byte counters are process-local aggregate transmission reductions, not provider-token or monetary savings. They include repeated history transmissions.
- These tests establish the covered RTK contract, not full Token Saver product parity. Headroom process management, semantic response caching, raw retention and global compression analytics are not implemented.
