# Simplification audit

Reduce demonstrated maintenance cost from obsolete code, duplicate behavior, needless indirection and misplaced responsibilities. Apply the [shared audit contract](README.md); file size, symbol counts and fewer lines alone do not establish improvement.

## Investigation

- For dead candidates, check actual references, HTML/desktop entries, literal dynamic imports, npm entry points, generated fixture consumers and smoke dispatch. [Unused-code configuration](../verification.md#linting-and-unused-code) aids discovery; confirm live consumers before deleting.
- For competing paths or forwarding wrappers, compare callers, unique behavior and compatibility obligations. Show which path can disappear and why the surviving owner expresses the whole responsibility.
- For duplication, identify one responsibility maintained independently and a concrete drift or repeated-edit cost. Compare the resulting caller clarity with leaving intentional variants separate; do not force them into flags merely to share code.
- For ownership or change-locality problems, trace a representative edit through [foundation boundaries](../architecture.md#import-boundaries). Expected composition-root fan-out is not itself a finding. Check whether a rule has multiple independent owners or presentation is deciding gameplay/persistence policy.

## Remedy and evidence

Prefer deletion, retargeting, inlining, reuse or moving responsibility when they resolve the demonstrated cause. Review the final caller path and confirm the obsolete responsibility is removed rather than hidden behind another layer.

Preserve the documented separations between simulation and presentation, checkpoints and settings, Game and developer profiles, authoring and pinned runtime consumption, and illustrated scene artwork and hidden physical/rendering carriers. Historical player compatibility is deferred until external players need it. Current source preservation and storage failures remain protected.

Update affected registrations, imports, documentation and protection together. Asset changes follow [assets](../assets.md); ordinary cleanup must not regenerate artwork or hand-edit generated packs. Apply [test value](../verification.md#test-value) to encountered overlap without weakening meaningful regression protection.
