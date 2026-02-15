import Image from 'next/image';

const modelInfo = {
  'deepseek/deepseek-chat-v3.1': { name: 'DeepSeek', logo: '/deepseek.svg' },
  // ... other models
};

export const AIMessageHeader = ({ modelId }) => {
  const model = modelId ? modelInfo[modelId] : null;
  
  return (
    <div className="w-8 h-8 rounded-lg bg-gray-800/80">
      {model ? (
        <Image src={model.logo} alt={model.name} width={20} height={20} />
      ) : (
        <span className="text-yellow-500">AI</span>
      )}
    </div>
  );
};