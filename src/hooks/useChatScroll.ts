import { useRef, useCallback } from 'react';

interface UseChatScrollReturn {
  smoothScrollToBottom: () => void;
  autoScrollEnabledRef: React.MutableRefObject<boolean>;
}

export const useChatScroll = (
  containerRef: React.RefObject<HTMLDivElement | null>,
): UseChatScrollReturn => {
  const autoScrollEnabledRef = useRef<boolean>(true);

  const smoothScrollToBottom = useCallback(() => {
    if (!containerRef.current || !autoScrollEnabledRef.current) return;

    const container = containerRef.current;
    const targetScrollTop = container.scrollHeight - container.clientHeight;
    const currentScrollTop = container.scrollTop;
    const distance = targetScrollTop - currentScrollTop;

    // If we're close enough, just jump there
    if (Math.abs(distance) < 1) {
      container.scrollTop = targetScrollTop;
      return;
    }

    // Smooth easing
    const easeAmount = 0.15;
    const delta = distance * easeAmount;
    container.scrollTop = currentScrollTop + delta;
  }, [containerRef]);

  return {
    smoothScrollToBottom,
    autoScrollEnabledRef,
  };
};