import React, { memo } from 'react';
import { useAppStore } from '@/src/store/rootStore';
import { NEW_CHAT_DRAFT_KEY } from '@/src/store/slices/drafts/draftSlice';
import { DraftPreview } from './ConversationItem';

interface NewChatDraftProps {
  /** The new-chat page is open, so its draft is already in the composer. */
  isOpen: boolean;
  onOpen: () => void;
}

/** Text typed on the new-chat page but not sent, so it isn't lost when you switch away. */
const NewChatDraft: React.FC<NewChatDraftProps> = ({ isOpen, onOpen }) => {
  const draft = useAppStore((state) => (isOpen ? undefined : state.drafts[NEW_CHAT_DRAFT_KEY]));
  if (!draft) return null;

  return (
    <section aria-label="Unsent new chat" className="pt-3">
      <div className="px-2">
        <button
          type="button"
          onClick={onOpen}
          className="group w-full rounded-lg px-3 py-2 text-left text-[13px] leading-5 transition-colors hover:bg-white/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        >
          <span className="block truncate text-[#c4c0bb] group-hover:text-white">New chat</span>
          <DraftPreview text={draft} />
        </button>
      </div>
    </section>
  );
};

export default memo(NewChatDraft);
