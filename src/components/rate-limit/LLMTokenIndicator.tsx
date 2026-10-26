import React, { useEffect, useState } from 'react';
import { Clock, AlertCircle, Brain } from 'lucide-react';
import { useAppStore } from '@/src/store/rootStore';

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
  const userId = useAppStore((state) => state.user?.id);

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
    if (userId && userId !== 'guest') fetchStatus();
    // Status is advisory; avoid polling while signed out.
  }, [userId]);

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
    const interval = setInterval(updateTimer, 60000);
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
        <div className="flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/[0.07] px-3.5 py-2.5 text-xs">
          <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-red-300">Council limit reached</div>
            <div className="mt-0.5 text-red-300/70">
              {status.councilUsed}/{status.councilLimit} council messages used · Resets in {timeUntilReset}
            </div>
          </div>
        </div>
      )}

      {/* Token limit warning/error */}
      {tokensLow && (
        <div className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {status.tokensRemaining > 0 ? (
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-[#d8d4ce]" />
            ) : (
              <Clock className="h-3.5 w-3.5 shrink-0 text-red-400" />
            )}
            <span className={status.tokensRemaining > 0 ? 'font-medium text-[#e6e3de]' : 'font-medium text-red-300'}>
              {status.tokensRemaining > 0
                ? `${status.tokensRemaining.toLocaleString()} tokens remaining`
                : 'Token limit reached'}
            </span>
            <span className="ml-auto text-[11px] text-[#8f8b86]">
              {status.tokensRemaining > 0 ? `Resets in ${timeUntilReset}` : `More in ${timeUntilReset}`}
            </span>
          </div>

          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className={`h-full transition-all duration-300 ${
                percentTokensUsed >= 100
                  ? 'bg-red-500'
                  : percentTokensUsed >= 90
                  ? 'bg-[#e6e3de]'
                  : 'bg-[#8fb59a]'
              }`}
              style={{ width: `${Math.min(percentTokensUsed, 100)}%` }}
            />
          </div>

          <div className="mt-1.5 flex justify-between text-[11px] text-[#8f8b86]">
            <span>
              {status.tokensRemaining > 0
                ? `~${Math.floor(status.tokensRemaining / 150)}–${Math.floor(status.tokensRemaining / 50)} messages left`
                : 'No tokens remaining'}
            </span>
            <span>
              {status.tokensUsed.toLocaleString()}/{status.tokensLimit.toLocaleString()}
            </span>
          </div>
        </div>
      )}

      {/* Council usage indicator (if not at limit) */}
      {isCouncilMode && !councilLow && status.councilUsed > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-xs">
          <span className="flex items-center gap-2 text-[#c4c0bb]">
            <Brain className="h-3.5 w-3.5 text-[#8f8b86]" />
            Council messages
          </span>
          <span className="text-[#8f8b86]">
            {status.councilUsed}/{status.councilLimit} used
          </span>
        </div>
      )}
    </div>
  );
};

export default LLMTokenIndicator;
