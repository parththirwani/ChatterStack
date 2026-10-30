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
      className={`flex h-8 w-8 items-center justify-center rounded-md text-[#aaa6a2] transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-2 focus-visible:outline-white ${className}`}
      title={title}
    >
      <Download className="h-[15px] w-[15px]" />
    </button>
  );
};

export default DownloadButton;
