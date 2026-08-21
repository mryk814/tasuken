# Packaged MCP readiness smoke evidence

Issue: #448

## Failure pattern

The Windows `Smoke packaged MCP with system Node` gate failed during the first run of PRs #444, #446, and #447, then passed after one failed-job rerun. Each failure exhausted the previous 30-second fixed poll and ended with an ENOENT for the isolated `tasken-core.json`. The child `Tasken.exe` used ignored stdio and its lifecycle was not part of the wait, so CI could not distinguish a slow cold launch from an early process failure.

## Change

- Packaged Core startup now has an explicit 90-second Windows cold-launch deadline.
- Readiness polling races the packaged child lifecycle. An early exit or spawn error fails immediately with its exit reason.
- Child stdout/stderr is retained only in a bounded 16 KiB tail and emitted only on failure.
- The random smoke marker, isolated temporary root, bearer values, and 43-character credentials are redacted before diagnostics leave the process.
- The success path and its canonical assertions are unchanged: 33 tools, exact canonical fixture, Desktop restart persistence, Proposal idempotency, one pending Proposal, and retired persistence absence.

## Automated verification

Five focused tests cover:

- delayed discovery succeeding before the deadline;
- immediate early-exit failure with diagnostic output;
- explicit timeout and last-probe reporting;
- credential redaction;
- bounded diagnostic retention.

Windows-native `npm run ci` passed:

- full suite: 1,276 passed, 1 pre-existing skip, 0 failed;
- consistency, architecture, Task architecture, and script inventory audits passed;
- renderer/main build and focused Electron smoke passed.

Windows-native `npm run package` produced the unpacked app, NSIS installer, and portable executable.

The resulting `release/win-unpacked/Tasken.exe` passed `npm run smoke:mcp-package` five consecutive times without retry. Every run returned:

- `toolCount: 33`;
- `coreCapabilityCount: 27`;
- `restartReadSucceeded: true`;
- `duplicateSuppressed: true`;
- `retiredPersistenceAbsent: true`.

The remaining acceptance gate is one fresh Windows GitHub Actions run succeeding without a rerun.
