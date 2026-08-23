# Android Capture provenance — Phase 18 evidence

Issue: #401

This phase carries the origin of an Android Quick Add from the process-restorable draft through the immutable Room outbox and Mobile Gateway into the canonical `TaskCreated` change event. It advances, but does not close, #401.

## Canonical boundary

- `change_event.metadata.provenance` is the single persisted source of Task-creation provenance; the Task row does not duplicate it.
- The contract records `reported_via`, `captured_at`, optional speech recognition mode/language/confidence, the fixed `source_audio_available=false` declaration, and `text/plain` for Share Target.
- Raw audio, shared text, Task title copies, local paths, recognizer payloads, and credentials are not provenance fields.
- Ordinary app, Widget, App Shortcut, Share Target, and Android speech all use the existing CreateTask command and outbox path.
- Older Mobile CreateTask envelopes without provenance remain accepted. New Android envelopes always include normalized provenance.

## Replay and privacy

- Draft identity still derives stable request, command, and Task ids.
- Replaying an identical envelope returns the original receipt without another event.
- Reusing the same command id with changed provenance is an idempotency conflict.
- Speech metadata is valid only for an `android_speech` capture; Share Target requires exactly `text/plain`.
- Public Activity projection exposes only the allowlisted safe provenance fields and drops unknown captured-content fields.

## Verification

- Focused Core, Mobile Gateway, Task capability, and Activity projection tests cover canonical persistence, replay, changed-provenance conflict, invalid combinations, and content redaction.
- Android unit tests cover Draft conversion, Share Target MIME restoration across process state, and strict CreateTask serialization.
- Android instrumentation covers immutable outbox persistence of normalized speech provenance.

## Remaining boundary

- A physical spoken-input save reaching a live Desktop Gateway is not proven by this slice.
- S23 remains the regular physical-device gate; Pixel Fold emulator covers adaptive compact/expanded behavior.
- Fold7 fold/unfold continuity remains a final #400 signoff and does not block ordinary #401 pull requests.
