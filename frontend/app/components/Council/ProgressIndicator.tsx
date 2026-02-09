import React from 'react';
import { Brain, CheckCircle, Loader2 } from 'lucide-react';
import Image from 'next/image';

interface CouncilProgress {
  stage: string;
  model: string;
  progress: number;
}

interface CouncilProgressIndicatorProps {
  progress: CouncilProgress[];
  isActive: boolean;
}

const modelInfo: Record<string, { name: string; logo: string; invert?: boolean }> = {
  'openai/gpt-5.1': { name: 'GPT-5.1', logo: '/openai.svg', invert: true },
  'google/gemini-3-pro-preview': { name: 'Gemini 3 Pro', logo: '/gemini.svg' },
  'anthropic/claude-sonnet-4.5': { name: 'Claude 4.5', logo: '/claude.svg' },
  'x-ai/grok-4': { name: 'Grok 4', logo: '/grok.svg' },
};

const stageNames: Record<string, string> = {
  stage1: 'Initial Responses',
  stage2: 'Peer Review',
  stage3: 'Final Synthesis',
  initialization: 'Starting Council',
};

const CouncilProgressIndicator: React.FC<CouncilProgressIndicatorProps> = ({
  progress,
  isActive,
}) => {
  if (!isActive && progress.length === 0) {
    return null;
  }

  // Group progress by stage
  const progressByStage = progress.reduce((acc, p) => {
    if (!acc[p.stage]) {
      acc[p.stage] = [];
    }
    acc[p.stage].push(p);
    return acc;
  }, {} as Record<string, CouncilProgress[]>);

  const currentStage = progress.length > 0 ? progress[progress.length - 1].stage : '';

  return (
    <div className="w-full max-w-3xl mx-auto px-4 py-6">
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-2xl p-6 backdrop-blur-sm">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-yellow-500/20 rounded-lg">
            <Brain className="w-6 h-6 text-yellow-500 animate-pulse" />
          </div>
          <div className="flex-1">
            <h3 className="text-white font-semibold text-lg">AI Council Deliberating</h3>
            <p className="text-gray-400 text-sm">
              {stageNames[currentStage] || 'Processing...'}
            </p>
          </div>
        </div>

        {/* Stage Progress */}
        <div className="space-y-4">
          {Object.entries(progressByStage).map(([stage, stageProgress]) => {
            const stageName = stageNames[stage] || stage;
            const completedModels = stageProgress.filter(p => p.progress === 100).length;
            const totalModels = stageProgress.length;
            const isCurrentStage = stage === currentStage;

            return (
              <div key={stage} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium ${isCurrentStage ? 'text-yellow-400' : 'text-gray-300'}`}>
                    {stageName}
                  </span>
                  <span className="text-xs text-gray-400">
                    {completedModels}/{totalModels} models
                  </span>
                </div>

                {/* Model Progress Bars */}
                <div className="space-y-2">
                  {stageProgress.map((p) => {
                    const model = modelInfo[p.model];
                    const isComplete = p.progress === 100;

                    return (
                      <div key={`${p.stage}-${p.model}`} className="flex items-center gap-3">
                        {/* Model Icon */}
                        <div className="w-6 h-6 flex-shrink-0 flex items-center justify-center">
                          {model ? (
                            <Image
                              src={model.logo}
                              alt={model.name}
                              width={20}
                              height={20}
                              className={model.invert ? 'invert brightness-0' : ''}
                            />
                          ) : (
                            <Brain className="w-4 h-4 text-gray-500" />
                          )}
                        </div>

                        {/* Progress Bar */}
                        <div className="flex-1">
                          <div className="h-2 bg-gray-700/50 rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all duration-300 ${
                                isComplete
                                  ? 'bg-green-500'
                                  : isCurrentStage
                                  ? 'bg-yellow-500 animate-pulse'
                                  : 'bg-gray-500'
                              }`}
                              style={{ width: `${p.progress}%` }}
                            />
                          </div>
                        </div>

                        {/* Status Icon */}
                        <div className="w-5 h-5 flex-shrink-0">
                          {isComplete ? (
                            <CheckCircle className="w-5 h-5 text-green-500" />
                          ) : isCurrentStage ? (
                            <Loader2 className="w-5 h-5 text-yellow-500 animate-spin" />
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Info Text */}
        {isActive && (
          <div className="mt-6 pt-4 border-t border-gray-700/50">
            <p className="text-xs text-gray-400 text-center">
              The council is analyzing multiple perspectives to provide the best possible answer
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CouncilProgressIndicator;