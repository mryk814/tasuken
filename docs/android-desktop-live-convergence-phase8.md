# Android–Desktop live convergence — Phase 8 evidence

Issue: #399

This phase verifies the real paired S23, Tailscale Serve, Desktop Mobile Gateway, canonical Task capability, Android outbox, cursor sync, and tombstone path together. It advances, but does not close, #399.

## Runtime correction

- The paired S23 retained one pending offline `CreateTask` command.
- The first Desktop runtime was older than the merged outbox, cursor, and field-patch slices; the Android worker had reached `retry_wait` after 16 attempts.
- A separate Windows-native runtime was created at the current `main` merge commit. The existing noisy runtime workspace and Desktop `userData` were preserved.
- Tailscale Serve continued to proxy private HTTPS to the loopback Gateway, and the new Gateway listener became reachable before the device retry.
- The Windows C drive initially had no free bytes. Only the regenerable npm cache and this run's incomplete dependency installation were removed, recovering about 7.46 GB; source and application data were not removed.

## Live convergence evidence

1. The S23 app retained its paired origin, encrypted token material, device ID, Room cache, and outbox across `adb install -r`.
2. The pending `CreateTask` converged after the current Desktop runtime and an Android cold start:
   - Android outbox count became zero.
   - The canonical Task returned with server version 1.
   - The sync cursor and last-successful-sync timestamp advanced.
   - `lastError` was null.
   - The visible `送信待ち` indicator disappeared.
3. The disposable Task was queried by exact ID through the local Task Core contract, then removed through the canonical, version-checked `DeleteTask` command. The unrelated same-title completed Task was not changed.
4. After Android process stop and cold start:
   - launch succeeded in 757 ms;
   - the deletion tombstone advanced the cursor;
   - the disposable Task count in Room became zero;
   - outbox remained zero and `lastError` remained null;
   - the UI showed the empty Today state.

## Diagnostics hardening

- Unexpected token decryption, pairing, Today sync, and command request exceptions now write a stack-bearing internal warning.
- Log messages contain neither the token, request payload, response body, origin, nor Task contents.
- User-facing retry and recovery messages remain unchanged.

## Automated evidence

- Windows-native `assembleDebug`: passed.
- Windows-native `testDebugUnitTest`: passed.
- The diagnostic APK was installed with `adb install -r`; app data was not cleared or uninstalled.

## Remaining boundary

- A real concurrent same-field Android/Desktop title race and both explicit conflict-resolution choices remain unverified against the live Gateway.
- Scheduled background delivery under Doze, device reboot rescheduling, Wi-Fi/cellular transition, and widget projection remain unverified.
- PC sleep/wake remains gated on explicit user permission and belongs to #398.
