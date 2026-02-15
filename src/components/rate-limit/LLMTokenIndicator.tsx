import React, { useEffect, useState } from 'react';
import { Clock, Zap, AlertCircle, Brain } from 'lucide-react';

interface LLMTokenStatus {
  tokensUsed: number;
  tokensLimit: number;
  tokensRemaining: number;
  councilUsed: number;
  councilLimit: number;
  councilRemaining: number;
  resetAt: number;
  canSendRegular: boolean;
  canSendCouncil: boolean;
  resetTime: string;
}

interface LLMTokenIndicatorProps {
  isCouncilMode: boolean;
  className?: string;
}

const LLMTokenIndicator: React.FC<LLMTokenIndicatorProps> = ({
  isCouncilMode,
  className = '',
}) => {
  const [status, setStatus] = useState<LLMTokenStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeUntilReset, setTimeUntilReset] = useState('');

  // Fetch rate limit status
  const fetchStatus = async () => {
    try {
      const response = await fetch('/api/llm-token-status');
      if (response.ok) {
        const data = await response.json();
        setStatus(data);
      }
    } catch (error) {
      console.error('Failed to fetch LLM token status:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    // Refresh every 10 seconds (since tokens change with each message)
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  // Update countdown timer
  useEffect(() => {
    if (!status) return;

    const updateTimer = () => {
      const now = Date.now();
      const diff = status.resetAt - now;

      if (diff <= 0) {
        setTimeUntilReset('Resetting...');
        fetchStatus();
        return;
      }

      const hours = Math.floor(diff / (60 * 60 * 1000));
      const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));

      if (hours > 0) {
        setTimeUntilReset(`${hours}h ${minutes}m`);
      } else if (minutes > 0) {
        setTimeUntilReset(`${minutes}m`);
      } else {
        setTimeUntilReset('< 1m');
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [status]);

  if (loading || !status) {
    return null;
  }

  const percentTokensUsed = (status.tokensUsed / status.tokensLimit) * 100;
  const tokensLow = status.tokensRemaining < 500; // Warning when less than 500 tokens
  const councilLow = status.councilRemaining <= 0;

  // Show warning if tokens are low OR council limit reached
  const showWarning = tokensLow || (isCouncilMode && councilLow);

  if (!showWarning) {
    return null;
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Council message limit warning */}
      {isCouncilMode && councilLow && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs">
          <Brain className="w-4 h-4 text-red-400 flex-shrink-0" />
          <div className="flex-1">
            <div className="text-red-300 font-medium">
              Council limit reached
            </div>
            <div className="text-red-400/80 mt-0.5">
              {status.councilUsed}/2 council messages used • Resets in {timeUntilReset}
            </div>
          </div>
        </div>
      )}

      {/* Token limit warning/error */}
      {tokensLow && (
        <>
          {status.tokensRemaining > 0 ? (
            <div className="flex items-center gap-2 px-3 py-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-xs">
              <AlertCircle className="w-4 h-4 text-yellow-400 flex-shrink-0" />
              <div className="flex-1">
                <span className="text-yellow-300 font-medium">
                  {status.tokensRemaining.toLocaleString()} tokens remaining
                </span>
                <span className="text-yellow-400/80 ml-2">
                  • Resets in {timeUntilReset}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs">
              <Clock className="w-4 h-4 text-red-400 flex-shrink-0" />
              <div className="flex-1">
                <div className="text-red-300 font-medium">
                  Token limit reached
                </div>
                <div className="text-red-400/80 mt-0.5">
                  More tokens available in {timeUntilReset}
                </div>
              </div>
            </div>
          )}

          {/* Token usage progress bar */}
          <div>
            <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3" />
                Daily LLM Tokens
              </span>
              <span>
                {status.tokensUsed.toLocaleString()}/{status.tokensLimit.toLocaleString()}
              </span>
            </div>
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  percentTokensUsed >= 100
                    ? 'bg-red-500'
                    : percentTokensUsed >= 90
                    ? 'bg-yellow-500'
                    : 'bg-green-500'
                }`}
                style={{ width: `${Math.min(percentTokensUsed, 100)}%` }}
              />
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {status.tokensRemaining > 0 ? (
                <span>
                  ~{Math.floor(status.tokensRemaining / 150)}-
                  {Math.floor(status.tokensRemaining / 50)} messages left
                </span>
              ) : (
                <span className="text-red-400">No tokens remaining</span>
              )}
            </div>
          </div>
        </>
      )}

      {/* Council usage indicator (if not at limit) */}
      {isCouncilMode && !councilLow && status.councilUsed > 0 && (
        <div className="flex items-center justify-between px-3 py-2 bg-gray-800/50 border border-gray-700/30 rounded-lg text-xs">
          <div className="flex items-center gap-2">
            <Brain className="w-3 h-3 text-gray-400" />
            <span className="text-gray-300">Council Messages</span>
          </div>
          <span className="text-gray-400">
            {status.councilUsed}/{status.councilLimit} used
          </span>
        </div>
      )}

      {/* Help text */}
      <div className="text-xs text-gray-500 px-1">
        💡 Each message uses ~50-500 tokens (input + output)
        {isCouncilMode && ' • Council messages count toward daily limit'}
      </div>
    </div>
  );
};

export default LLMTokenIndicator;