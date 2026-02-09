import fs from 'fs';
import path from 'path';

// Load the system prompt from file
const SYSTEM_PROMPT_PATH = path.join(__dirname, '../prompts/system-prompt.md');
const SECURITY_POLICY_PATH = path.join(__dirname, '../prompts/security-policy.md');

export const CHATTERSTACK_SYSTEM_PROMPT = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');
export const SECURITY_POLICY = fs.readFileSync(SECURITY_POLICY_PATH, 'utf-8');

export const getChatterStackSystemPrompt = (modelId?: string): string => {
  let prompt = CHATTERSTACK_SYSTEM_PROMPT;
  
  // Add model-specific context
  if (modelId) {
    const modelName = getModelDisplayName(modelId);
    const modelContext = getModelContext(modelId);
    
    prompt += `\n\n## Current Session Context\n\n`;
    prompt += `You are currently running as **${modelName}**.\n\n`;
    
    if (modelContext) {
      prompt += modelContext;
    }
    
    // Add council mode context if applicable
    if (modelId.startsWith('council:')) {
      prompt += `\n### Council Mode Active\n\n`;
      prompt += `This response represents the collective analysis of 4 expert AI models:\n`;
      prompt += `- GPT-5.1 (OpenAI)\n`;
      prompt += `- Gemini 3 Pro Preview (Google)\n`;
      prompt += `- Claude Sonnet 4.5 (Anthropic)\n`;
      prompt += `- Grok 4 (xAI)\n\n`;
      prompt += `Your response should acknowledge this collaborative process and present the synthesized wisdom.\n`;
    }
  }
  
  return prompt;
};

function getModelDisplayName(modelId: string): string {
  const modelMap: Record<string, string> = {
    'deepseek/deepseek-chat-v3.1': 'DeepSeek Chat v3.1',
    'google/gemini-2.5-flash': 'Google Gemini 2.5 Flash',
    'openai/gpt-4o': 'OpenAI GPT-4o',
    'anthropic/claude-sonnet-4.5': 'Anthropic Claude Sonnet 4.5',
    'x-ai/grok-2-1212': 'xAI Grok 2',
  };
  
  if (modelId.startsWith('council:')) {
    return 'AI Council (Multi-Model Synthesis)';
  }
  
  return modelMap[modelId] || 'AI Assistant';
}

function getModelContext(modelId: string): string {
  const contextMap: Record<string, string> = {
    'deepseek/deepseek-chat-v3.1': `
**Your Strengths**:
- Efficient reasoning and logical analysis
- Strong coding and technical problem-solving
- Mathematical and scientific computations
- Clear, structured explanations

**When to mention ChatterStack features**:
- Users can switch to other models for different strengths
- Council mode available for complex multi-perspective analysis
`,
    'google/gemini-2.5-flash': `
**Your Strengths**:
- Fast response times
- Multimodal understanding
- Versatile general-purpose assistance
- Creative and adaptive responses

**When to mention ChatterStack features**:
- Users can switch to specialized models for specific tasks
- Council mode available for complex questions
`,
    'openai/gpt-4o': `
**Your Strengths**:
- Advanced reasoning capabilities
- Strong creative writing
- Complex problem-solving
- Nuanced analysis

**When to mention ChatterStack features**:
- Users can try other models for different perspectives
- Council mode combines insights from 4 expert models
`,
    'anthropic/claude-sonnet-4.5': `
**Your Strengths**:
- Highly capable reasoning
- Safety-conscious responses
- Detailed analysis and explanations
- Ethical consideration in advice

**When to mention ChatterStack features**:
- Users can compare responses across different models
- Council mode provides multi-model deliberation
`,
  };
  
  return contextMap[modelId] || '';
}

export const formatMessagesWithSystemContext = (
  messages: Array<{ role: string; content: string }>,
  modelId?: string
): Array<{ role: string; content: string }> => {
  const systemPrompt = getChatterStackSystemPrompt(modelId);
  
  return [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'developer',
      content: SECURITY_POLICY,
    },
    ...messages,
  ];
};