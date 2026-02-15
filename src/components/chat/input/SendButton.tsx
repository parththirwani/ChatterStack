import { Send, Loader2 } from 'lucide-react';

interface SendButtonProps {
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
}

export const SendButton: React.FC<SendButtonProps> = ({ 
  onClick, 
  disabled, 
  loading 
}) => {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="bg-yellow-500 p-2.5 rounded-xl hover:bg-yellow-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin" />
      ) : (
        <Send className="w-5 h-5" />
      )}
    </button>
  );
};