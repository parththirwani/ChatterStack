import React from 'react';
import { RotateCcw } from 'lucide-react';

interface RetryButtonProps {
  onRetry: () => void;
  className?: string;
  title?: string;
}

/** Sends the question again and replaces the answer with the new one. */
const RetryButton: React.FC<RetryButtonProps> = ({
  onRetry,
  className = '',
  title = 'Retry message',
}) => (
  <button
    type="button"
    onClick={onRetry}
    aria-label={title}
    className={`flex h-8 w-8 items-center justify-center rounded-md text-[#aaa6a2] transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-2 focus-visible:outline-white ${className}`}
    title={title}
  >
    <RotateCcw className="h-[15px] w-[15px]" />
  </button>
);

export default RetryButton;
