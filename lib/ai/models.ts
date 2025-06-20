export const DEFAULT_CHAT_MODEL: string = 'n8n-assistant';

interface ChatModel {
  id: string;
  name: string;
  description: string;
  isN8n?: boolean;
}

export const chatModels: Array<ChatModel> = [
  {
    id: 'n8n-assistant',
    name: 'Y-1',
    description:
      'Proprietary model with advanced tool-calling and user context • Context: 512k tokens • Text-only',
    isN8n: true,
  },
  {
    id: 'chat-model',
    name: 'GPT 4.1',
    description:
      'Strong for all-purpose chat and problem solving across domains • Context: 1m tokens',
  },
  {
    id: 'chat-model-reasoning',
    name: 'o3',
    description:
      'Excels at reasoning, coding, and instruction-following • Context: 200k tokens',
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description:
      'Fast, effective reasoning with efficient performance in coding and visual tasks • Context: 200k tokens',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    description:
      'Powerful capabilities for complex tasks, reasoning, and coding • Context: 1m tokens',
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    description:
      'Best intelligence for speed and cost tradeoff; great for simple tasks, questions, and chat • Context: 1m tokens',
  },
  {
    id: 'deepseek-v3',
    name: 'DeepSeek V3',
    description:
      'Mixture-of-Experts model challenging top AI models (0324 version) • Context: 131k tokens',
  },
  {
    id: 'deepseek-r1',
    name: 'DeepSeek R1',
    description:
      'Open source model excelling in creative writing, math, code, reasoning, and cost efficiency • Context: 164k tokens',
  },
  {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4',
    description:
      'High-performance model with strong reasoning capabilities • Context: 200k tokens',
  },
  {
    id: 'claude-opus-4',
    name: 'Claude Opus 4',
    description:
      "Anthropic's most powerful and capable model; skilled at coding and editing long-form prose • Context: 200k tokens",
  },
];
