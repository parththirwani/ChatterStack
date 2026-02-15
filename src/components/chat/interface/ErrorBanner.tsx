import { AlertCircle } from 'lucide-react';

interface ErrorBannerProps {
  error: string;
  onDismiss: () => void;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({ error, onDismiss }) => {
  return (
    <div className="bg-red-500/10 border-b border-red-500/20">
      <div className="max-w-3xl mx-auto px-4 py-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400" />
          <span className="text-sm text-red-400">{error}</span>
          <button
            onClick={onDismiss}
            className="ml-auto text-red-400 hover:text-red-300 text-sm underline transition-colors duration-200 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};