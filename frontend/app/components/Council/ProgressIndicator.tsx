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
  hideWhenGenerating?: boolean;
  hasStartedGenerating?: boolean;
}

const modelInfo: Record<string, { name: string; logo: string; invert?: boolean }> = {
  'openai/gpt-5.1': { name: 'GPT-5.1', logo: '/openai.svg', invert: true },
  'google/gemini-3-pro-preview': { name: 'Gemini 3 Pro', logo: '/gemini.svg' },
  'anthropic/claude-sonnet-4.5': { name: 'Claude 4.5', logo: '/claude.svg' },
  'x-ai/grok-4': { name: 'Grok 4', logo: '/grok.svg' },
};

const stageNames: Record<string, string> = {
  stage1: 'Gathering Expert Opinions',
  stage2: 'Peer Review & Analysis',
  stage3: 'Synthesizing Final Answer',
  initialization: 'Initializing Council',
};

const CouncilProgressIndicator: React.FC<CouncilProgressIndicatorProps> = ({
  progress,
  isActive,
  hideWhenGenerating = false,
  hasStartedGenerating = false,
}) => {
  // Hide if answer has started generating
  if (hideWhenGenerating && hasStartedGenerating) {
    return null;
  }

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
  const stageOrder = ['initialization', 'stage1', 'stage2', 'stage3'];
  
  // Calculate overall progress
  const totalStages = 3; // stage1, stage2, stage3
  const completedStages = stageOrder.filter(stage => {
    const stageProgress = progressByStage[stage];
    return stageProgress && stageProgress.every(p => p.progress === 100);
  }).length;

  return (
    <div className="w-full max-w-3xl mx-auto px-4 py-6 animate-in fade-in duration-300">
      <div className="bg-gradient-to-br from-gray-800/80 to-gray-900/80 border border-yellow-500/30 rounded-2xl p-6 backdrop-blur-sm shadow-xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 bg-yellow-500/20 rounded-xl ring-2 ring-yellow-500/30">
            <Brain className="w-6 h-6 text-yellow-400 animate-pulse" />
          </div>
          <div className="flex-1">
            <h3 className="text-white font-semibold text-lg flex items-center gap-2">
              AI Council Deliberating
              <span className="text-xs font-normal text-gray-400">
                ({completedStages}/{totalStages} stages)
              </span>
            </h3>
            <p className="text-yellow-400 text-sm font-medium">
              {stageNames[currentStage] || 'Processing...'}
            </p>
          </div>
        </div>

        {/* Overall Progress Bar */}
        <div className="mb-6">
          <div className="h-2 bg-gray-700/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-yellow-500 to-yellow-400 transition-all duration-500 ease-out"
              style={{ width: `${(completedStages / totalStages) * 100}%` }}
            />
          </div>
        </div>

        {/* Stage Progress */}
        <div className="space-y-4">
          {Object.entries(progressByStage)
            .sort(([a], [b]) => stageOrder.indexOf(a) - stageOrder.indexOf(b))
            .map(([stage, stageProgress]) => {
              if (stage === 'initialization') return null; // Skip initialization display
              
              const stageName = stageNames[stage] || stage;
              const completedModels = stageProgress.filter(p => p.progress === 100).length;
              const totalModels = stageProgress.length;
              const isCurrentStage = stage === currentStage;
              const isCompleted = completedModels === totalModels;

              return (
                <div key={stage} className={`space-y-3 p-4 rounded-xl transition-all duration-300 ${
                  isCurrentStage 
                    ? 'bg-yellow-500/10 border border-yellow-500/30' 
                    : isCompleted
                    ? 'bg-green-500/10 border border-green-500/20'
                    : 'bg-gray-800/30 border border-gray-700/30'
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {isCompleted ? (
                        <CheckCircle className="w-5 h-5 text-green-400" />
                      ) : isCurrentStage ? (
                        <Loader2 className="w-5 h-5 text-yellow-400 animate-spin" />
                      ) : (
                        <div className="w-5 h-5 rounded-full border-2 border-gray-600" />
                      )}
                      <span className={`text-sm font-semibold ${
                        isCurrentStage 
                          ? 'text-yellow-400' 
                          : isCompleted
                          ? 'text-green-400'
                          : 'text-gray-300'
                      }`}>
                        {stageName}
                      </span>
                    </div>
                    <span className="text-xs font-medium text-gray-400">
                      {completedModels}/{totalModels} complete
                    </span>
                  </div>

                  {/* Model Progress Grid */}
                  <div className="grid grid-cols-2 gap-2">
                    {stageProgress.map((p) => {
                      const model = modelInfo[p.model];
                      const isComplete = p.progress === 100;
                      const isProcessing = p.progress > 0 && p.progress < 100;

                      return (
                        <div 
                          key={`${p.stage}-${p.model}`} 
                          className={`flex items-center gap-2 p-2 rounded-lg transition-all duration-200 ${
                            isComplete 
                              ? 'bg-green-500/10 border border-green-500/30'
                              : isProcessing
                              ? 'bg-yellow-500/10 border border-yellow-500/30 animate-pulse'
                              : 'bg-gray-800/50 border border-gray-700/30'
                          }`}
                        >
                          {/* Model Icon */}
                          <div className="w-6 h-6 flex-shrink-0 flex items-center justify-center">
                            {model ? (
                              <Image
                                src={model.logo}
                                alt={model.name}
                                width={16}
                                height={16}
                                className={model.invert ? 'invert brightness-0' : ''}
                              />
                            ) : (
                              <Brain className="w-4 h-4 text-gray-500" />
                            )}
                          </div>

                          {/* Model Name and Status */}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-white truncate">
                              {model?.name || 'Processing'}
                            </div>
                          </div>

                          {/* Status Icon */}
                          <div className="w-4 h-4 flex-shrink-0">
                            {isComplete ? (
                              <CheckCircle className="w-4 h-4 text-green-400" />
                            ) : isProcessing ? (
                              <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />
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
            <p className="text-xs text-center text-gray-400 leading-relaxed">
              <span className="inline-flex items-center gap-1">
                <Brain className="w-3 h-3" />
                Multiple AI experts analyzing and debating to provide the best answer
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CouncilProgressIndicator;