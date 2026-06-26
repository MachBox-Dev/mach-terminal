# Phase 2 perf spike (TER-27)

> Status: **spike / profiling-gated** — do not ship semantic backpressure changes without measured pain post rc.8.

## Context

Phase 0/1 landed:

- WebGL xterm renderer (`@xterm/addon-webgl`) with DOM fallback
- Raw-bytes `Channel` PTY transport (`pty_subscribe_output`)
- Streaming UTF-8 decode across 8 KB `read()` boundaries
- `npm run test:perf` floor (~50 MiB/s local, ~35 MiB/s when `CI=true`; observed ~75 MiB/s local, ~43 MiB/s GHA cold on decode+chunk pipeline)

`MAX_PENDING_CHUNKS` (64) is **effectively dead** at current read sizes: an 8 KB read → ≤4 chunks after `split_chunk(2048)`. Drops only matter under sustained floods that fill the pending deque faster than the channel drains.

## Automated baseline (TER-27)

Rust unit test `typical_8kb_reads_do_not_hit_pending_cap` simulates 1000× 8 KB reads through `split_chunk` + `enqueue_output_chunk`. **Result: zero drops** at `MAX_PENDING_CHUNKS=64` with `MAX_CHUNK=2048`.

**Go/no-go for Phase 2 code changes:** require `output_chunks_dropped > 0` in live diagnostics during dogfood flood *or* measured UI stall. Until then, defer coalesce/backpressure implementation.

**Manual profiling checklist (rc.8):**

1. **Heavy output:** `yes | head -c 50M`, `cat huge.log`, `npm run build` in tmux (Commander mode).
2. **Multi-tab:** 3+ tabs all streaming build output simultaneously.
3. **Metrics:** `runtime_counters` (`output_chunks_dropped`, `output_chunks_emitted`, `sequence_anomalies`) via diagnostics snapshot.
4. **Subjective:** scrollback lag, composer responsiveness, tab switch during flood.

**Go** for Phase 2 code if: drops > 0 in counters during normal dogfood, or visible UI stall with WebGL+Channel.

## Options (ranked)

| Option | Effort | Risk | Notes |
|--------|--------|------|-------|
| **A. Reader coalesce** | M | Low | Merge adjacent pending chunks before channel send when queue > N; reduces IPC overhead without dropping |
| **B. Channel backpressure** | L | Med | Block/slow reader when channel send fails or queue depth high; needs timeout to avoid PTY stall |
| **C. Frontend byte budget tune** | S | Low | `MAX_PTY_FLUSH_BYTES_PER_FRAME` / RAF budget from burn-in data |
| **D. Native GPU grid** | XL | High | `alacritty_terminal` + `wgpu` — replace xterm render path; separate spike |

## Baseline in code

- `enqueue_output_chunk()` in `session_manager.rs` — explicit drop-oldest when `pending.len() > MAX_PENDING_CHUNKS`
- Unit test `enqueue_output_chunk_drops_oldest_when_cap_exceeded` documents current semantics

## Next steps after rc.8 bake

1. Dogfood with diagnostics open; capture counter snapshots under flood.
2. If drops stay zero → defer A/B; only tune C if needed.
3. If drops or stall → implement **A** first (coalesce), re-profile, then consider **B**.

## Out of scope for TER-27

- Changing `MAX_PENDING_CHUNKS` without profiling data
- Replacing xterm (option D) in the same tranche as flow control
