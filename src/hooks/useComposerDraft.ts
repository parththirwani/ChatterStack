import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAppStore } from '@/src/store/rootStore';

const DRAFT_SAVE_MS = 300;

/**
 * Composer text with a separate unsent draft per chat. Typing stays in local
 * state (only the composer re-renders); the store, which the sidebar reads,
 * is updated after a short pause and whenever you switch chats.
 */
export function useComposerDraft(conversationKey: string) {
  const [message, setMessageState] = useState('');
  const messageRef = useRef('');
  const keyRef = useRef(conversationKey);
  const draftsHydrated = useAppStore((state) => state.draftsHydrated);

  const setMessage = useCallback((value: string) => {
    messageRef.current = value;
    setMessageState(value);
  }, []);

  // Show this chat's draft before paint; keep the outgoing chat's text.
  useLayoutEffect(() => {
    keyRef.current = conversationKey;
    setMessage(useAppStore.getState().drafts[conversationKey] ?? '');
    return () => useAppStore.getState().setDraft(conversationKey, messageRef.current);
  }, [conversationKey, setMessage]);

  // Drafts are restored from localStorage after mount.
  useEffect(() => {
    if (draftsHydrated && !messageRef.current) {
      setMessage(useAppStore.getState().drafts[keyRef.current] ?? '');
    }
  }, [draftsHydrated, setMessage]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => useAppStore.getState().setDraft(keyRef.current, messageRef.current),
      DRAFT_SAVE_MS
    );
    return () => window.clearTimeout(timer);
  }, [message]);

  /** Empty the composer and drop the draft (the message was sent). */
  const clearDraft = useCallback(() => {
    setMessage('');
    useAppStore.getState().setDraft(keyRef.current, '');
  }, [setMessage]);

  return { message, setMessage, clearDraft };
}
