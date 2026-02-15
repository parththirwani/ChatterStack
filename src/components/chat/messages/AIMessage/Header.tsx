import Image from 'next/image';

interface ModelInfo {
  name: string;
  logo: string;
  invert?: boolean;
}

const modelInfo: Record<string, ModelInfo> = {
  'deepseek/deepseek-chat-v3.1': { name: 'DeepSeek', logo: '/deepseek.svg' },
  'google/gemini-2.5-flash': { name: 'Gemini', logo: '/gemini.svg' },
  'google/gemini-3-pro-preview': { name: 'Gemini 3 Pro', logo: '/gemini.svg' },
  'openai/gpt-4o': { name: 'GPT-4o', logo: '/openai.svg', invert: true },
  'anthropic/claude-sonnet-4.5': { name: 'Claude', logo: '/claude.svg' },
  'council': { name: 'AI Council', logo: '/logo.png' },
};

interface AIMessageHeaderProps {
  modelId?: string;
}

export const AIMessageHeader: React.FC<AIMessageHeaderProps> = ({ modelId }) => {
  const model = modelId ? modelInfo[modelId] : null;
  
  return (
    <div className="w-8 h-8 rounded-lg bg-gray-800/80 flex items-center justify-center flex-shrink-0 mt-1 border border-gray-700/50">
      {model ? (
        <Image 
          src={model.logo} 
          alt={model.name} 
          width={20} 
          height={20}
          className={model.invert ? 'invert brightness-0' : ''}
        />
      ) : (
        <span className="text-xs font-bold text-yellow-500">AI</span>
      )}
    </div>
  );
};