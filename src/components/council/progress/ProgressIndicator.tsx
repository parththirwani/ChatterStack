import React from 'react';
import { Brain, CheckCircle, Loader2, Users, Scale, Sparkles } from 'lucide-react';
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

const stageInfo: Record<string, { name: string; icon: React.ReactNode; color: string }> = {
  initialization: {
    name: 'Initializing Council',
    icon: <Brain className="w-5 h-5" />,
    color: 'text-blue-400'
  },
  stage1: {
    name: 'Expert Analysis',
    icon: <Users className="w-5 h-5" />,
    color: 'text-purple-400'
  },
  stage2: {
    name: 'Peer Review',
    icon: <Scale className="w-5 h-5" />,
    color: 'text-orange-400'
  },
  stage3: {
    name: 'Final Synthesis',
    icon: <Sparkles className="w-5 h-5" />,
    color: 'text-green-400'
  },
};

const CouncilProgressIndicator: React.FC<CouncilProgressIndicatorProps> = ({
  progress,
  isActive,
}) => {
  if (!isActive || progress.length === 0) {
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

  const currentStage = progress[progress.length - 1]?.stage || 'initialization';
  const stageOrder = ['initialization', 'stage1', 'stage2', 'stage3'];
  
  // Calculate overall progress (0-100)
  const completedStages = stageOrder.filter(stage => {
    const stageProgress = progressByStage[stage];
    return stageProgress && stageProgress.every(p => p.progress === 100);
  }).length;
  
  const totalStages = 3; // Only count the main 3 stages
  const overallProgress = Math.round((completedStages / totalStages) * 100);

  return (
    <div className="w-full max-w-3xl mx-auto px-4 py-6">
      <div className="bg-gradient-to-br from-gray-900/90 to-gray-800/90 border-2 border-yellow-500/40 rounded-2xl p-6 backdrop-blur-md shadow-2xl shadow-yellow-500/20">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <div className="relative">
            <div className="p-3 bg-yellow-500/20 rounded-xl ring-2 ring-yellow-500/50 animate-pulse">
              <Brain className="w-7 h-7 text-yellow-400" />
            </div>
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full animate-ping" />
          </div>
          
          <div className="flex-1">
            <h3 className="text-white font-bold text-xl flex items-center gap-2">
              AI Council Deliberating
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-yellow-400 text-sm font-semibold">
                {stageInfo[currentStage]?.name || 'Processing'}
              </span>
              <span className="text-gray-400 text-sm">
                • {overallProgress}% Complete
              </span>
            </div>
          </div>
        </div>

        {/* Overall Progress Bar */}
        <div className="mb-6">
          <div className="h-3 bg-gray-800/80 rounded-full overflow-hidden border border-gray-700/50">
            <div
              className="h-full bg-gradient-to-r from-yellow-500 via-yellow-400 to-yellow-300 transition-all duration-500 ease-out relative"
              style={{ width: `${overallProgress}%` }}
            >
              <div className="absolute inset-0 bg-white/20 animate-pulse" />
            </div>
          </div>
        </div>

        {/* Stage Progress */}
        <div className="space-y-4">
          {stageOrder.map((stageKey) => {
            if (stageKey === 'initialization') return null; // Skip initialization in display
            
            const stage = stageInfo[stageKey];
            const stageProgress = progressByStage[stageKey] || [];
            const isCurrentStage = stageKey === currentStage;
            const completedModels = stageProgress.filter(p => p.progress === 100).length;
            const totalModels = stageProgress.length;
            const isCompleted = completedModels === totalModels && totalModels > 0;
            const hasStarted = totalModels > 0;

            return (
              <div 
                key={stageKey}
                className={`p-4 rounded-xl border-2 transition-all duration-300 ${
                  isCurrentStage 
                    ? 'bg-yellow-500/10 border-yellow-500/50 shadow-lg shadow-yellow-500/20' 
                    : isCompleted
                    ? 'bg-green-500/10 border-green-500/30'
                    : hasStarted
                    ? 'bg-gray-800/50 border-gray-700/50'
                    : 'bg-gray-900/30 border-gray-800/30 opacity-50'
                }`}
              >
                {/* Stage Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`${
                      isCompleted 
                        ? 'text-green-400' 
                        : isCurrentStage 
                        ? stage.color 
                        : 'text-gray-500'
                    }`}>
                      {isCompleted ? (
                        <CheckCircle className="w-5 h-5" />
                      ) : isCurrentStage ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        stage.icon
                      )}
                    </div>
                    
                    <span className={`font-bold ${
                      isCurrentStage 
                        ? 'text-yellow-400' 
                        : isCompleted
                        ? 'text-green-400'
                        : 'text-gray-400'
                    }`}>
                      {stage.name}
                    </span>
                  </div>
                  
                  {hasStarted && (
                    <span className="text-xs font-medium text-gray-400 bg-gray-800/60 px-2 py-1 rounded">
                      {completedModels}/{totalModels} models
                    </span>
                  )}
                </div>

                {/* Model Progress Grid */}
                {hasStarted && (
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
                              ? 'bg-green-500/20 border border-green-500/40'
                              : isProcessing
                              ? 'bg-yellow-500/20 border border-yellow-500/40'
                              : 'bg-gray-800/50 border border-gray-700/30'
                          }`}
                        >
                          {/* Model Icon */}
                          <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
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

                          {/* Model Name */}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-white truncate">
                              {model?.name || 'Model'}
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
                )}
              </div>
            );
          })}
        </div>

        {/* Footer Info */}
        <div className="mt-6 pt-4 border-t border-gray-700/50">
          <p className="text-xs text-center text-gray-400 leading-relaxed flex items-center justify-center gap-2">
            <Brain className="w-3 h-3" />
            <span>4 expert AI models analyzing, debating, and synthesizing the optimal response</span>
          </p>
        </div>
      </div>
    </div>
  );
};

export default CouncilProgressIndicator;