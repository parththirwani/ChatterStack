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
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    // Generate filename if not provided
    const defaultFilename = `ai-response-${new Date().toISOString().split('T')[0]}.txt`;
    link.download = filename || defaultFilename;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <button
      onClick={handleDownload}
      className={`p-2 rounded-lg bg-gray-800/80 hover:bg-gray-700/80 text-gray-400 hover:text-white transition-colors duration-200 backdrop-blur-sm ${className}`}
      title={title}
    >
      <Download className="w-4 h-4" />
    </button>
  );
};

export default DownloadButton;