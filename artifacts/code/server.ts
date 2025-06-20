import { z } from 'zod';
import { streamObject } from 'ai';
import { myProvider } from '@/lib/ai/providers';
import { codePrompt, updateDocumentPrompt } from '@/lib/ai/prompts';
import { createDocumentHandler } from '@/lib/artifacts/server';

export const codeDocumentHandler = createDocumentHandler<'code'>({
  kind: 'code',
  onCreateDocument: async ({ title, dataStream, instructions }) => {
    let draftContent = '';

    const systemPromptWithInstructions = `${codePrompt} ${instructions ? `IMPORTANT: Adhere to the following user instructions: ${instructions}` : ''}`;

    const { fullStream } = streamObject({
      model: myProvider.languageModel('artifact-model'),
      system: systemPromptWithInstructions,
      prompt: title,
      schema: z.object({
        code: z.string(),
      }),
    });

    console.log('[codeDocumentHandler][onCreate] Entering stream loop...');
    for await (const delta of fullStream) {
      // --- Log Delta Start ---
      console.log(
        '[codeDocumentHandler][onCreate] Received delta:',
        JSON.stringify(delta),
      );
      // --- Log Delta End ---
      const { type } = delta;

      if (type === 'object') {
        const { object } = delta;
        const { code } = object;

        if (code) {
          dataStream.writeData({
            type: 'code-delta',
            content: code ?? '',
          });

          draftContent = code;
        }
      }
    }

    return draftContent;
  },
  onUpdateDocument: async ({
    document,
    description,
    dataStream,
    instructions,
  }) => {
    let draftContent = '';

    const baseSystemPrompt = updateDocumentPrompt(document.content, 'code');
    const systemPromptWithInstructions = `${baseSystemPrompt} ${instructions ? `IMPORTANT: Also adhere to the following user instructions for this update: ${instructions}` : ''}`;

    const { fullStream } = streamObject({
      model: myProvider.languageModel('artifact-model'),
      system: systemPromptWithInstructions,
      prompt: description,
      schema: z.object({
        code: z.string(),
      }),
    });

    console.log('[codeDocumentHandler][onUpdate] Entering stream loop...');
    for await (const delta of fullStream) {
      // --- Log Delta Start ---
      console.log(
        '[codeDocumentHandler][onUpdate] Received delta:',
        JSON.stringify(delta),
      );
      // --- Log Delta End ---
      const { type } = delta;

      if (type === 'object') {
        const { object } = delta;
        const { code } = object;

        if (code) {
          dataStream.writeData({
            type: 'code-delta',
            content: code ?? '',
          });

          draftContent = code;
        }
      }
    }

    return draftContent;
  },
});
