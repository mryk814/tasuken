# Architecture fitness function

Issue #408 Phase 0–1 introduces a deterministic architecture inventory and a
report-only CI audit. The Task reference slice and the Tasken Core / MCP /
Mobile transport slice are selectively enforced profiles; unrelated repository
findings remain report-only.

## Files

- `modules.json`: module roots, public entrypoints, reviewed dependency edges,
  rollout status, capability registrars, and composition roots.
- `shared-ownership.json`: every `src/shared` file's classification, owner,
  migration target, and removal condition. Kernel and feature contracts expose
  only their declared `public.ts` entrypoints.
- `compatibility-baseline.json`: exact consumer paths for frozen compatibility
  surfaces. Counts alone are not used because moving a consumer must not hide
  new debt.
- `composition-baseline.json`: line, import, and module-dependency signals for
  the current composition roots. These are trend signals, not generic line
  limits.
- `capability-baseline.json`: exact properties exposed to each Preload global,
  so a satellite window cannot silently inherit another surface.
- `violations-baseline.json`: fingerprints of Phase 0 findings, used to label
  later findings as baseline or new candidates.
- `generated-sources.json`: generated/vendor provenance and regeneration
  commands.
- `suppressions.json`: narrow debt records. Each suppression requires a rule,
  source, optional target, reason, owner, tracking issue, and expiry or removal
  condition.

## Commands

```text
npm run audit:architecture
npm run audit:architecture -- --changed
npm run audit:architecture -- --rule renderer.cross_feature_deep_import
npm run audit:architecture -- --enforce task
npm run audit:architecture -- --enforce core-mcp
```

Reports are written under `artifacts/architecture/` and uploaded by Windows CI.
The JSON dependency, module, and shared-ownership outputs are intended for
reuse by Product Atlas (#386). The shared-ownership artifact also records
exported symbols, consumers, runtime dependencies, validation presence, and
legacy `.mjs` / `.d.mts` declaration pairs.

Production source, tests, and their script dependencies are scanned. Audit fixtures are excluded only by the
exact `fixtureRoots` entries in `modules.json`; the test tree is never blanket
excluded. A same-module unit test may use internals only through an exact
`testOwnership` record. Cross-module behavior tests use the public entrypoint.

Baseline updates are migration work, not routine cleanup. Review the report and
confirm that no accidental dependency or compatibility consumer is being
accepted before running:

```text
npm run audit:architecture -- --write-baselines
```

`--enforce task` turns the `shared.kernel`, `shared.contracts.task`, and
`main.task` boundaries into blocking checks. It also blocks compatibility
consumer growth and malformed/expired suppressions. All other module findings
remain report-only until their own migration slice is explicitly enabled.

`--enforce core-mcp` protects the established Tasken Core, MCP, and Mobile
Gateway boundaries. New undeclared dependencies, public API bypasses, runtime
dependencies in shared contracts, parallel hand-written declarations, and
platform imports from application/Core code fail without accepting a larger
baseline. Transport-to-repository imports, cross-module export-all, unsafe
contract casts, unresolved imports, and unregistered IPC handlers are also
blocking. Compatibility growth and malformed/expired suppressions remain global
blocking rules for this profile as well.

## Required quality checks

The stable GitHub check names are `windows-quality` (Windows quality workflow)
and `android-quality` (Android quality workflow). Both run for every pull request
targeting `main` and every push to `main`, including the exact merge commit.
Trigger-level path filters are intentionally absent: a filtered-out required
workflow would leave a non-Android pull request waiting for a check that never starts.

Workflow configuration alone does not enable GitHub enforcement. Configure
`main` protection separately, with explicit approval, to require both check names
from the GitHub Actions app, require an up-to-date branch, and enforce the checks
for administrators too. Preserve existing conversation-resolution and other
protection settings. Missing, pending, or failed required checks must block merge.

Verify the effective rules and the required-status-checks / enforce-admins API
responses after configuration. Observe a non-Android pull request receive both
checks, remain blocked while pending, and become mergeable after both succeed.
The current integration strategy is `push: main` revalidation, not a merge queue.
