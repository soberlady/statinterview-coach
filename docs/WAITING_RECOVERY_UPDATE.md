# Waiting and recovery update — 2026-10-02

- Baseline: website commit ea8b098cf1ba4773a02cc81f53140c830932f504 (v17); cloud agent HnSZA8j5MhAx.
- Backup: ../before-wait-optimization-ea8b098.zip, outside the publish checkout.
- Voice submission has a 55-second overall request deadline, covering the existing repair (15s) and parallel scorer (20s) budgets with margin. Checkpoint recovery is bounded to 10 seconds. Browser confirmation allows 75 seconds and offers explicit recovery.
- A lost response does not erase an answer. Reload the checkpoint first, keep unconfirmed transcripts, and never blindly repost. Pending status checks reconcile late saves; old question status messages are ignored.
- Manual finish waits for SDK finalization, then 0.5 seconds of transcript stability. Automatic submission counts the existing quiet time since the last committed fragment instead of starting another full wait after model deliberation.
- Question-bound, participant-authorized status RPC exposes listening/transcribing/scoring/saved/recovery; no transcript content or secrets are sent in status messages.
- Loading, recovery, completion and report loading screens use the practice theme.
- Setup labels accurately describe keyword-based question-bank routing and a 15/20-minute selection budget, not a hard countdown. No scoring policy, question quota or database schema change.
- Check the new voice-processing tests, voice-turn recovery tests, existing voice tests and local policy end-to-end flow. Live microphone acceptance remains separate from automated checks.
