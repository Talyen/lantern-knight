# Handoff and performance evidence

Report the actual changes, local integration/commit, tests executed and unavailable coverage. Do not replace current evidence with persistent passing receipts. [Verification](verification.md) owns commands and [coordination](task-coordination.md) owns task integration.

## Performance comparisons

Compare cold acquisition/startup separately from warm iteration, checks, builds and packaging. Use repeated equivalent samples; record hardware, assets, settings, sample duration, background/foreground policy and rendering quality. Count transferred bytes and repeated launches as well as elapsed time.

`npm run benchmark -- sandbox --benchmark` records renderer measurements; `npm run benchmark -- compare <baseline.json> <candidate.json>` compares retained external records. Preserve a needed baseline outside Git. Native output and exact pixel parity are required when a renderer calculation changes; fewer submissions alone do not prove better visible pacing.

## Packaged player journey measurements

`npm run benchmark -- game --benchmark` exercises the actual Game package. Run only for a concrete investigation after explicit packaging. Preserve gameplay, animation timing, sound behavior and visual fidelity. Automated hidden/software runs do not certify 60 FPS on reference hardware or visible polish.
