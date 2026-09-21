import type { AssistantDraft } from "../api/assistant";

export const ASSISTANT_DRAFT_KEY = "internal_ticket_system.assistant-draft";

export function saveAssistantDraft(draft: AssistantDraft) {
  window.sessionStorage.setItem(ASSISTANT_DRAFT_KEY, JSON.stringify(draft));
}

export function readAssistantDraft(): AssistantDraft | null {
  try {
    const raw = window.sessionStorage.getItem(ASSISTANT_DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AssistantDraft;
  } catch {
    return null;
  }
}

export function clearAssistantDraft() {
  window.sessionStorage.removeItem(ASSISTANT_DRAFT_KEY);
}
