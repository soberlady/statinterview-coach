const PREFIX = "statinterview:answer-draft:v1:";
export const ANSWER_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function browserDraftStorage(): DraftStorage | null {
  try { return window.localStorage; } catch { return null; }
}

export function clearAnswerDraft(storage: DraftStorage | null, interviewId: string): boolean {
  try { if (!storage) return false; storage.removeItem(PREFIX + interviewId); return true; }
  catch { return false; }
}

export function saveAnswerDraft(storage: DraftStorage | null, interviewId: string, questionId: string, text: string, now = Date.now()): boolean {
  if (!text.trim()) return clearAnswerDraft(storage, interviewId);
  try {
    if (!storage || text.length > 20_000) return false;
    storage.setItem(PREFIX + interviewId, JSON.stringify({ questionId, text, savedAt: now }));
    return true;
  } catch { return false; }
}

export function loadAnswerDraft(storage: DraftStorage | null, interviewId: string, questionId: string, now = Date.now()): string | null {
  try {
    const raw = storage?.getItem(PREFIX + interviewId);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (draft?.questionId === questionId && typeof draft.text === "string" &&
      draft.text.length <= 20_000 && typeof draft.savedAt === "number" &&
      Number.isFinite(draft.savedAt) && now >= draft.savedAt && now - draft.savedAt < ANSWER_DRAFT_TTL_MS) {
      return draft.text;
    }
  } catch { /* Storage access or invalid records must not block answering. */ }
  clearAnswerDraft(storage, interviewId);
  return null;
}
