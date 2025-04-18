import {
  customProvider,
  extractReasoningMiddleware,
  wrapLanguageModel,
} from 'ai';
import { groq } from '@ai-sdk/groq';
import { xai } from '@ai-sdk/xai';
import { google } from '@ai-sdk/google';
import { fal } from '@ai-sdk/fal';
import { togetherai } from '@ai-sdk/togetherai';
import { openai, OpenAIResponsesProviderOptions } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { fireworks } from '@ai-sdk/fireworks';
import { replicate } from '@ai-sdk/replicate';
import { isTestEnvironment } from '../constants';
import {
  artifactModel,
  chatModel,
  reasoningModel,
  titleModel,
} from './models.test';

export const myProvider = isTestEnvironment
  ? customProvider({
      languageModels: {
        'chat-model': chatModel,
        'chat-model-reasoning': reasoningModel,
        'title-model': titleModel,
        'artifact-model': artifactModel,
      },
    })
  : customProvider({
      languageModels: {
        'chat-model': openai('gpt-4.1'),
        'chat-model-reasoning': wrapLanguageModel({
          model: fireworks('accounts/fireworks/models/deepseek-r1'),
          middleware: extractReasoningMiddleware({ tagName: 'think' }),
        }),
        'title-model': openai('gpt-4.1-mini'),
        'artifact-model': google('gemini-2.5-pro-exp-03-25'),
      },
      imageModels: {
        'small-model': fal.image('fal-ai/recraft-v3'),
      },
    });
