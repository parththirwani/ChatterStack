import { Send, Loader2 } from 'lucide-react';

export const SendButton = ({ onClick, disabled, loading }) => {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="bg-yellow-500 p-2.5 rounded-xl"
    >
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin" />
      ) : (
        <Send className="w-5 h-5" />
      )}
    </button>
  );
};