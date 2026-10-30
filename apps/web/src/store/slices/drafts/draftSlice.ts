import { StateCreator } from 'zustand';

/** The draft for a chat that hasn't been created yet. */
export const NEW_CHAT_DRAFT_KEY = 'new';

export interface DraftSlice {
  /** Unsent composer text by conversation id ('new' for the new-chat page). */
  drafts: Record<string, string>;
  /** Whose drafts these are, so another account on this browser never sees them. */
  draftsOwner: string | null;
  /** False until drafts are restored from localStorage after mount. */
  draftsHydrated: boolean;
  setDraft: (key: string, text: string) => void;
}

interface StoreWithUser {
  user: { id?: string } | null;
}

export const createDraftSlice: StateCreator<DraftSlice> = (set, get) => ({
  drafts: {},
  draftsOwner: null,
  draftsHydrated: false,

  setDraft: (key, text) => {
    const { drafts } = get();
    const keep = text.trim().length > 0;
    if (keep ? drafts[key] === text : !(key in drafts)) return;

    const next = { ...drafts };
    if (keep) next[key] = text;
    else delete next[key];
    set({ drafts: next, draftsOwner: (get() as unknown as StoreWithUser).user?.id ?? null });
  },
});
