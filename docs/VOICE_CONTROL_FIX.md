# Voice recovery update — 2026-10-02

## Baseline and rollback

- Website baseline: Sites v16, commit `10021f75871dbf67eb5cbaff3b0bb0f87bc9b60d`.
- Source backup outside the publish checkout: `../before-voice-fix-full-10021f7.zip`.
- LiveKit baseline: agent `CA_9m8JtxCdn4bi`, version `cZERZLuuidZg`.
- Roll back both transports together if required. Do not delete interview records or change secrets.

## Changed behavior

- Finish sends an authenticated, question-and-sequence-bound RPC, not just a microphone mute.
- The worker flushes STT and submits its original transcript through the existing policy API; manual finish does not depend on the LLM choosing a tool.
- Automatic and manual submission share a lock. Stale controls cannot submit the next question; repeated in-flight controls return BUSY.
- The worker waits for the participant before opening speech. Reconnection creates a new room and reloads the authoritative question.
- Repeat-question RPC speaks the current approved question without submitting an answer.
- Browser RPC waits at most 10 seconds; save confirmation has a 45-second recovery message. Switching to text retains the browser transcript as an editable draft and separately inspectable copy.
- Browser playback blocking has a recovery prompt. Microphone control and reconnect/read-question controls are separate.

## Verification and boundaries

- TypeScript check and the existing 76 web tests passed.
- 51 focused Python voice/control tests passed, including participant wait, unauthorized RPC rejection, repeat without submission, duplicate and stale finish controls.
- Local end-to-end policy flow passed: 7 saved answers, 7 replay matches; guided demo passed.
- The full Python suite also exposes a pre-existing question-bank hash mismatch in 10 scorer-fixture tests on this checkout. Those fixtures and the scoring engine were not changed by this repair.
- Actual microphone, speaker, browser permissions and network behavior still need a human voice acceptance test. Automated checks are not proof of end-to-end live audio quality.

## Acceptance sequence

1. Create a new diagnostic, wait for the question, answer, then use manual finish. Check exactly one saved turn and the next question.
2. Switch to text while an answer is unsaved; verify the retained draft before submitting.
3. On a later question switch back to voice; confirm it reads the current question. Try repeat-question without changing the saved turn count.
4. Block playback or disconnect briefly; confirm the UI offers recovery rather than claiming that audio is playing.
