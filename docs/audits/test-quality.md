# Test quality audit

Keep only tests whose significant failure detection justifies their authoring, maintenance and execution cost. Reduce redundancy and flake. Apply the [shared audit contract](README.md) and [test value policy](../verification.md#test-value).

## Investigation

- Map important failures to current protection and its owning layer before adding or deleting coverage. A gap is a risky behavior without a trustworthy assertion, not an uncovered line. For suspicious tests, identify a plausible broken implementation that would still pass.
- Check isolation of mutable simulations, sessions, editor history, profiles and resource state. Pure fixtures can be shared where immutable; native asset registration and packaged input/storage/renderer contracts need their appropriate layers.
- For failures or flake, distinguish product races from harness timing, fixture leakage and environment problems. Inspect bounded diagnostics and reproduce the suspect scenario and relevant ordering. An isolated pass does not prove a concurrent failure is fixed.
- Compare overlapping assertions by failure mode, layer and execution tier. Consult the existing coverage owners and [E2E tiers](../verification.md#e2e-coverage-and-execution-budgets); assess startup/setup, renderer submissions and total execution cost alongside test code.

## Remedy and evidence

Strengthen or remove medium-value assertions, delete low-value coverage, consolidate overlap and move valuable protection to a cheaper sufficient layer under the canonical test policy. No deletion quota applies; zero new tests can be appropriate. Preserve meaningful known-regression and current behavior protection; diagnose failures before changing expectations. Do not add retries or weaken assertions to hide defects.

Use observable state/frame conditions instead of fixed sleeps unless elapsed time is the behavior being tested. Preserve exact pixel/subpixel and resource-lifetime checks where they own renderer risks; treat screenshot galleries and long motion traces as diagnostics under the existing policy.

Measure suite and command cost including setup when choosing local versus CI execution. Roughly ten seconds is a local guideline, not a hard cutoff; valuable expensive checks run in CI by default. Use the existing [test selection](../verification.md#test-selection) and packaged smoke coverage. Include surviving protection when consolidating and account for deletions in the handoff. Verify changed assertions can detect the intended failure and report measured timing comparisons when changing expensive suites.
