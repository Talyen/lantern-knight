---
name: benchmark-checklist
description: Validate performance measurements when comparing options or reporting a measured speedup or regression. Check equivalent work, correctness, repeatability, and player impact; do not launch benchmarks for unmeasured speculation.
license: Complete terms in LICENSE.txt
---

# Benchmark checklist

Adapted from [pstack's benchmark-checklist skill](https://github.com/backnotprop/pstack/blob/3a604672c46cd8187d2b19980eae0a34f9f91138/skills/benchmark-checklist/SKILL.md), revision `3a604672c46cd8187d2b19980eae0a34f9f91138`, under the [MIT license](LICENSE.txt). This local adaptation is self-contained and follows the project's native measurement and fidelity requirements. Upstream updates are reviewed manually.

Apply to actual performance work, including assessing existing measurements. A speculative performance discussion does not request a benchmark run.

Use the existing commands and comparison records in [verification](../../../docs/verification.md#performance-comparisons). State the claim being tested and inspect the harness: what it times, counts, excludes, and whether the result is consumed inside the measured interval.

- Confirm the intended work actually completes. Count failures, retries, and timeouts; verify output correctness rather than accepting fast rejection or a no-op as a gain.
- Compare equivalent hardware, assets, settings, data, build profiles, sample duration, cache state, and foreground policy. Separate cold acquisition/startup from warm iteration, builds, packaging, and gameplay.
- Identify the limiter using a separate profiling run. Do not include profiler overhead in reported timings. Check whether the measured gain is plausible given the changed work's share of total cost.
- Inspect machine contention with available platform tools. Coordinate a stable window under [task coordination](../../../docs/task-coordination.md#concurrent-commands); never stop another owner's process. If contention remains, alternate conditions and disclose it.
- Normally take at least five samples per side, alternating baseline and candidate. Report units, count, median, range, and limiter. A difference within run-to-run noise is no measurable difference. An explicitly requested ballpark may use one sample, labeled as such, while still checking correctness and completed work.
- Relate a microbenchmark to the path the player or developer waits on. Do not infer visible pacing from fewer submissions or hidden/software runs.

Preserve visual fidelity, animation timing, and sound behavior. Follow [native output and pixel-parity requirements](../../../docs/verification.md#performance-comparisons) for renderer calculation changes, and [packaged player journey measurements](../../../docs/verification.md#packaged-player-journey-measurements) for Game claims. Keep retained records outside Git.

Lead with faster, slower, no measurable difference, or inconclusive. Use inconclusive when correctness, completed work, comparable conditions, or the limiter remains unresolved. State missing evidence and limit the claim to the conditions actually measured. This skill adds no new benchmark harness or delivery authorization.
