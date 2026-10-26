import React from 'react';
import { Download } from 'lucide-react';

interface DownloadButtonProps {
  content: string;
  filename?: string;
  className?: string;
  title?: string;
}

const DownloadButton: React.FC<DownloadButtonProps> = ({
  content,
  filename,
  className = '',
  title = 'Download message'
}) => {
  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    // Generate filename if not provided
    const defaultFilename = `ai-response-${new Date().toISOString().split('T')[0]}.md`;
    link.download = filename || defaultFilename;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <button
      onClick={handleDownload}
      aria-label={title}
      className={`flex h-11 w-11 items-center justify-center rounded-lg text-[#aaa6a2] transition-colors hover:bg-white/[0.07] hover:text-white ${className}`}
      title={title}
    >
      <Download className="w-4 h-4" />
    </button>
  );
};

export default DownloadButton;
