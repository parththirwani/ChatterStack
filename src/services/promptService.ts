import fs from 'fs';
import path from 'path';

// Load the system prompt from file
const SYSTEM_PROMPT_PATH = path.join(process.cwd(), 'src/prompts/system-prompt.md');
const SECURITY_POLICY_PATH = path.join(process.cwd(), 'src/prompts/security-policy.md');

export const CHATTERSTACK_SYSTEM_PROMPT = fs.existsSync(SYSTEM_PROMPT_PATH)
  ? fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8')
  : `You are an AI assistant operating within ChatterStack, a multi-model AI platform.`;

export const SECURITY_POLICY = fs.existsSync(SECURITY_POLICY_PATH)
  ? fs.readFileSync(SECURITY_POLICY_PATH, 'utf-8')
  : `Follow all safety and security guidelines. Do not assist with harmful, illegal, or unethical activities.`;

/**
 * Get the ChatterStack system prompt with model-specific context
 */
export const getChatterStackSystemPrompt = (modelId?: string): string => {
  let prompt = CHATTERSTACK_SYSTEM_PROMPT;
  
  // Replace date placeholder
  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  prompt = prompt.replace('{{date}}', currentDate);
  
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

/**
 * Get display name for a model ID
 */
function getModelDisplayName(modelId: string): string {
  const modelMap: Record<string, string> = {
    'deepseek/deepseek-chat-v3.1': 'DeepSeek Chat v3.1',
    'google/gemini-2.5-flash': 'Google Gemini 2.5 Flash',
    'google/gemini-3-pro-preview': 'Google Gemini 3 Pro Preview',
    'openai/gpt-4o': 'OpenAI GPT-4o',
    'openai/gpt-5.1': 'OpenAI GPT-5.1',
    'anthropic/claude-sonnet-4.5': 'Anthropic Claude Sonnet 4.5',
    'x-ai/grok-4': 'xAI Grok 4',
    'x-ai/grok-2-1212': 'xAI Grok 2',
  };
  
  if (modelId.startsWith('council:')) {
    return 'AI Council (Multi-Model Synthesis)';
  }
  
  return modelMap[modelId] || 'AI Assistant';
}

/**
 * Get model-specific context and strengths
 */
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
    'google/gemini-3-pro-preview': `
**Your Strengths**:
- Advanced reasoning and analysis
- Large context window (1M tokens)
- Strong multimodal capabilities
- Excellent for synthesis and summarization

**When to mention ChatterStack features**:
- Users can try other models for different approaches
- You serve as the chairman in Council mode
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
    'openai/gpt-5.1': `
**Your Strengths**:
- State-of-the-art reasoning
- Superior problem-solving
- Advanced analysis and synthesis
- Exceptional creative capabilities

**When to mention ChatterStack features**:
- Users can compare responses across different models
- Council mode leverages your expertise along with others
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
    'x-ai/grok-4': `
**Your Strengths**:
- Real-time information access
- Direct and honest responses
- Strong technical capabilities
- Balanced perspective

**When to mention ChatterStack features**:
- Users can switch models for different tones
- Council mode combines your insights with other experts
`,
  };
  
  return contextMap[modelId] || '';
}

/**
 * Format messages with system context and security policy
 */
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

/**
 * Get council-specific system prompt for stage 1 (initial responses)
 */
export const getCouncilStage1Prompt = (): string => {
  return `${CHATTERSTACK_SYSTEM_PROMPT}

## Council Mode - Stage 1: Expert Analysis

You are participating in a multi-model council deliberation. Your task:

1. **Analyze the user's question independently**
2. **Provide your best, most comprehensive answer**
3. **Show your reasoning and expertise**
4. **Be thorough but concise**

Your response will be:
- Anonymized and presented to other expert models
- Peer-reviewed by other AI systems
- Synthesized into a final collaborative answer

Focus on quality, accuracy, and clarity. This is NOT the final answer - it's your expert contribution to the deliberation.

Remember: You are one expert voice in a council of AI models working together.
`;
};

/**
 * Get council-specific prompt for stage 2 (peer review)
 */
export const getCouncilStage2Prompt = (
  userQuery: string,
  anonymizedResponses: Array<{ label: string; response: string }>
): string => {
  const responsesText = anonymizedResponses
    .map((r) => `${r.label}:\n${r.response}\n`)
    .join('\n');

  return `${SECURITY_POLICY}

## Council Mode - Stage 2: Peer Review

You are an expert evaluator analyzing different AI responses to the same question.

**ORIGINAL QUESTION:**
${userQuery}

**RESPONSES TO EVALUATE:**
${responsesText}

**YOUR TASK:**

1. Critically evaluate each response for:
   - Accuracy and correctness
   - Completeness and depth
   - Clarity and organization
   - Practical usefulness
   - Any errors or misconceptions

2. Provide detailed critiques for each response.

3. End with a **FINAL RANKING** section that lists the responses in order from best to worst.
   Format: Use numbered list like:
   1. Response C
   2. Response A
   3. Response B
   etc.

Be thorough in your analysis and decisive in your ranking.

**FINAL RANKING:**`;
};

/**
 * Get council chairman prompt for final synthesis
 */
export const getCouncilChairmanPrompt = (
  userQuery: string,
  stage1Results: Array<{ model: string; response: string }>,
  aggregateRankings: Array<{ model: string; averageRank: number }>,
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
): string => {
  const stage1Context = stage1Results
    .map((r) => `Model: ${r.model}\nResponse: ${r.response}`)
    .join('\n\n---\n\n');

  const rankingSummary = aggregateRankings
    .map((r, i) => `${i + 1}. ${r.model} (avg rank: ${r.averageRank.toFixed(2)})`)
    .join('\n');

  const contextSummary = conversationHistory && conversationHistory.length > 0
    ? `\n\n**CONVERSATION HISTORY:**\n${conversationHistory
        .slice(-6)
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n\n')}\n`
    : '';

  return `${CHATTERSTACK_SYSTEM_PROMPT}

## Council Mode - Stage 3: Chairman Synthesis

You are the chairman of an AI council. Multiple expert AI models have analyzed this question and peer-reviewed each other's responses.

${contextSummary}

**CURRENT QUESTION:**
${userQuery}

**COUNCIL RESPONSES:**
${stage1Context}

**AGGREGATE RANKINGS (based on peer review):**
${rankingSummary}

**YOUR TASK:**

Synthesize a comprehensive, authoritative answer that:

1. Incorporates the best insights from all council members
2. Maintains continuity with the conversation history (if any)
3. Resolves disagreements by weighing evidence and rankings
4. Provides a clear, unified response
5. Acknowledges any remaining uncertainties or different perspectives
6. Delivers practical, actionable information

Create the definitive answer that represents the council's collective wisdom.

${SECURITY_POLICY}
`;
};