import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, CheckCircle, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { getModelMeta } from '@/src/lib/models';

interface CouncilProgress {
  stage: string;
  model: string;
  progress: number;
}

interface CouncilProgressIndicatorProps {
  progress: CouncilProgress[];
  isActive: boolean;
}

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
    <div aria-live="polite" className="mx-auto w-full max-w-3xl py-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="relative"
      >
        {/* Main Card */}
        <div className="rounded-xl border border-white/10 bg-[#242424] p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#e8b775]/10">
                  <Brain className="h-4 w-4 text-[#e8b775]" />
                </div>
                <motion.div
                  className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[#e8b775]"
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
              </div>
              
              <div>
                <h3 className="text-sm font-semibold text-white">
                  AI Council
                </h3>
                <p className="text-xs text-[#aaa6a2]">
                  {currentStageInfo.description}
                </p>
              </div>
            </div>

            {/* Stage indicator */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#aaa6a2]">
                Step {currentStageIndex + 1}/4
              </span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mb-4">
            <div className="h-1 overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full bg-[#e8b775]"
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
                  <span className="text-xs text-[#aaa6a2]">
                    {completedModels}/{totalModels} models
                  </span>
                )}
              </div>

              {/* Models Grid */}
              {totalModels > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {currentStageProgress.map((p) => {
                    const model = getModelMeta(p.model);
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
                            ? 'bg-white/[0.05] border border-white/10'
                            : isProcessing
                            ? 'bg-white/[0.05] border border-white/10'
                            : 'bg-white/[0.025] border border-white/[0.06]'
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
                            <Loader2 className="w-4 h-4 animate-spin text-[#e8b775]" />
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
