import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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

const stageInfo: Record<string, { name: string; description: string }> = {
  initialization: { name: 'Initializing', description: 'Preparing council' },
  stage1: { name: 'Analysis', description: 'Expert models analyzing' },
  stage2: { name: 'Review', description: 'Peer reviewing responses' },
  stage3: { name: 'Synthesis', description: 'Generating final answer' },
};

const CouncilProgressIndicator: React.FC<CouncilProgressIndicatorProps> = ({
  progress,
  isActive,
}) => {
  if (!isActive || progress.length === 0) {
    return null;
  }

  const currentStage = progress[progress.length - 1]?.stage || 'initialization';
  const currentStageInfo = stageInfo[currentStage] || stageInfo.initialization;
  
  // Get models working on current stage
  const currentStageProgress = progress.filter(p => p.stage === currentStage);
  const completedModels = currentStageProgress.filter(p => p.progress === 100).length;
  const totalModels = currentStageProgress.length;
  
  // Calculate stage completion
  const stageOrder = ['initialization', 'stage1', 'stage2', 'stage3'];
  const currentStageIndex = stageOrder.indexOf(currentStage);
  const isStageComplete = completedModels === totalModels && totalModels > 0;

  return (
    <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 py-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="relative"
      >
        {/* Main Card */}
        <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-700/50 rounded-xl p-4 shadow-lg">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-8 h-8 rounded-lg bg-yellow-500/10 border border-yellow-500/30 flex items-center justify-center">
                  <Brain className="w-4 h-4 text-yellow-400" />
                </div>
                <motion.div
                  className="absolute -top-1 -right-1 w-2 h-2 bg-yellow-500 rounded-full"
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
              </div>
              
              <div>
                <h3 className="text-sm font-semibold text-white">
                  AI Council
                </h3>
                <p className="text-xs text-gray-400">
                  {currentStageInfo.description}
                </p>
              </div>
            </div>

            {/* Stage indicator */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">
                Step {currentStageIndex + 1}/4
              </span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mb-4">
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-yellow-500 to-yellow-400"
                initial={{ width: 0 }}
                animate={{ 
                  width: `${((currentStageIndex + (isStageComplete ? 1 : 0.5)) / 4) * 100}%` 
                }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
            </div>
          </div>

          {/* Current Stage Details */}
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStage}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-3"
            >
              {/* Stage Name */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">
                  {currentStageInfo.name}
                </span>
                {totalModels > 0 && (
                  <span className="text-xs text-gray-400">
                    {completedModels}/{totalModels} models
                  </span>
                )}
              </div>

              {/* Models Grid */}
              {totalModels > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {currentStageProgress.map((p) => {
                    const model = modelInfo[p.model];
                    const isComplete = p.progress === 100;
                    const isProcessing = p.progress > 0 && p.progress < 100;

                    return (
                      <motion.div
                        key={p.model}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className={`
                          flex items-center gap-2 p-2 rounded-lg transition-colors
                          ${isComplete 
                            ? 'bg-green-500/10 border border-green-500/30' 
                            : isProcessing
                            ? 'bg-yellow-500/10 border border-yellow-500/30'
                            : 'bg-gray-800/50 border border-gray-700/30'
                          }
                        `}
                      >
                        {/* Model Icon */}
                        <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
                          {model ? (
                            <Image
                              src={model.logo}
                              alt={model.name}
                              width={14}
                              height={14}
                              className={model.invert ? 'invert brightness-0' : ''}
                            />
                          ) : (
                            <Brain className="w-3 h-3 text-gray-500" />
                          )}
                        </div>

                        {/* Model Name */}
                        <span className="text-xs font-medium text-white flex-1 truncate">
                          {model?.name || 'Model'}
                        </span>

                        {/* Status Icon */}
                        <div className="w-4 h-4 flex-shrink-0">
                          {isComplete ? (
                            <CheckCircle className="w-4 h-4 text-green-400" />
                          ) : isProcessing ? (
                            <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />
                          ) : null}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
};

export default CouncilProgressIndicator;