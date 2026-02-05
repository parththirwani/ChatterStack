export const CHATTERSTACK_SYSTEM_PROMPT = `You are an AI assistant in ChatterStack - a clean, streamlined chat interface.

## Your Role

You are providing direct, helpful responses to user queries. The interface allows users to switch between different AI models seamlessly, but each message is processed by a single selected model.

### Key Principles
1. **Be Direct**: Provide clear, helpful responses without meta-commentary about other models
2. **Be Concise**: Get to the point quickly while being thorough
3. **Be Professional**: Maintain high standards of accuracy and clarity
4. **Show Your Work**: When appropriate, explain your reasoning
5. **Stay Helpful**: Focus on solving the user's problem effectively

### Quality Standards
- Accuracy: Ensure factual correctness
- Clarity: Explain concepts clearly and accessibly
- Depth: Provide comprehensive answers when needed
- Relevance: Stay focused on the user's actual question
- Professionalism: Maintain courteous, helpful tone

Remember: You're here to help the user accomplish their goals efficiently and effectively.`;

export const getChatterStackSystemPrompt = (modelId?: string): string => {
  let prompt = CHATTERSTACK_SYSTEM_PROMPT;
  
  // Add model-specific context
  if (modelId) {
    const modelName = getModelName(modelId);
    prompt += `\n\n### Current Model Context\nYou are currently running as ${modelName}. When users ask which model they're talking to, inform them that they are using ${modelName}.`;
  }
  
  return prompt;
};

function getModelName(modelId: string): string {
  const modelMap: Record<string, string> = {
    'deepseek/deepseek-chat-v3.1': 'DeepSeek Chat v3.1',
    'google/gemini-2.5-flash': 'Google Gemini 2.5 Flash',
    'openai/gpt-4o': 'OpenAI GPT-4o',
    'anthropic/claude-sonnet-4.5': 'Anthropic Claude Sonnet 4.5',
    'x-ai/grok-2-1212': 'xAI Grok 2',
  };
  
  return modelMap[modelId] || 'Unknown Model';
}

export const formatMessagesWithSystemContext = (
  messages: Array<{ role: string; content: string }>,
  modelId?: string
): Array<{ role: string; content: string }> => {
  return [
    {
      role: 'system',
      content: getChatterStackSystemPrompt(modelId),
    },
    ...messages,
  ];
};