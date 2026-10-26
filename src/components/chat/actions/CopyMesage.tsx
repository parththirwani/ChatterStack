import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface CopyButtonProps {
  content: string;
  className?: string;
  title?: string;
}

const CopyButton: React.FC<CopyButtonProps> = ({
  content,
  className = '',
  title = 'Copy message'
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy text:', error);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = content;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleCopy}
      aria-label={copied ? 'Copied message' : title}
      className={`flex h-11 w-11 items-center justify-center rounded-lg text-[#aaa6a2] transition-colors hover:bg-white/[0.07] hover:text-white ${className}`}
      title={title}
    >
      {copied ? (
        <Check className="w-4 h-4 text-green-400" />
      ) : (
        <Copy className="w-4 h-4" />
      )}
    </button>
  );
};

export default CopyButton;
