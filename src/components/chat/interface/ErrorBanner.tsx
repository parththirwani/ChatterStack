import { AlertCircle } from 'lucide-react';

export const ErrorBanner = ({ error, onDismiss }) => {
  return (
    <div className="bg-red-500/10 border-b border-red-500/20">
      <div className="max-w-3xl mx-auto px-4 py-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400" />
          <span className="text-sm text-red-400">{error}</span>
          <button onClick={onDismiss}>Dismiss</button>
        </div>
      </div>
    </div>
  );
};