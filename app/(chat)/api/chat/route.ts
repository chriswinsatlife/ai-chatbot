import type { UIMessage } from 'ai';
import { type CoreMessage, streamText, tool } from 'ai';
import { StreamingTextResponse, streamToResponse } from 'ai';
import { auth } from '@clerk/nextjs/server';
import * as schema from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { systemPrompt } from '@/lib/ai/prompts';
import {
  db,
  deleteChatById,
  getChatById,
  saveChat,
  saveMessages,
  getMessagesByChatId,
  type NewDBMessage,
} from '@/lib/db/queries';
import {
  generateUUID,
  getTrailingMessageId,
} from '@/lib/utils';
import { generateTitleFromUserMessage } from '../../actions';
import { myProvider } from '@/lib/ai/providers';
import { chatModels } from '@/lib/ai/models';
import { AISDKExporter } from 'langsmith/vercel';
import { revalidateTag } from 'next/cache';
import { getGoogleOAuthToken } from '@/app/actions/get-google-token';
import { assembleTools } from '@/lib/ai/tools/tool-list';
import MemoryClient from 'mem0ai';
import {
  postRequestBodySchema,
  type PostRequestBody,
  type Message as ClientMessage,
} from './schema';
import { z } from 'zod';

// Add this new function to create the stream filter
function createToolCallFilteringStream() {
  let hasSeenToolCall = false;
  const textEncoder = new TextEncoder();

  return new TransformStream({
    transform(chunk, controller) {
      const decodedChunk = new TextDecoder().decode(chunk);
      // Example chunk: 0:" Thinking..."
      // Tool call chunk: 2:I[{"type":"tool-call",...
      if (decodedChunk.startsWith('2:')) {
        hasSeenToolCall = true;
      }

      // If we see a tool call, we let it and all subsequent chunks pass through.
      // If we haven't seen a tool call, we block the chunk (which is text filler).
      if (hasSeenToolCall) {
        controller.enqueue(chunk);
      }
    },
    flush(controller) {
      // This stream doesn't need to do anything on flush.
    },
  });
}

const client = new MemoryClient({ apiKey: process.env.MEM0_API_KEY || '' });

export const maxDuration = 300;

// Define n8n webhook URLs from environment variables
const n8nWebhookUrls: Record<string, string> = {
  'n8n-assistant':
    process.env.N8N_ASSISTANT_WEBHOOK_URL ||
    'https://n8n-naps.onrender.com/webhook/05af71c4-23a8-44fb-bfd6-3536345edbac',
  'n8n-assistant-1': process.env.N8N_ASSISTANT_1_WEBHOOK_URL || '',
  'n8n-assistant-2': process.env.N8N_ASSISTANT_2_WEBHOOK_URL || '',
};

function mapDBMessagesToCoreMessages(
  dbMessages: schema.DBMessage[],
): CoreMessage[] {
  return dbMessages
    .map(dbMsg => {
      let content = '';
      if (typeof dbMsg.parts === 'string') {
        content = dbMsg.parts;
      } else if (Array.isArray(dbMsg.parts)) {
        content = (dbMsg.parts as Array<any>)
          .filter(p => p.type === 'text' && typeof p.text === 'string')
          .map(p => p.text)
          .join('\n');
      }

      return {
        id: dbMsg.id,
        role: dbMsg.role as CoreMessage['role'],
        content: content,
        ...(dbMsg.role === 'tool' && {
          tool_calls: (dbMsg.parts as any)?.tool_calls,
        }),
      };
    })
    .filter(
      (msg): msg is CoreMessage =>
        ['user', 'assistant', 'system', 'tool'].includes(msg.role) &&
        typeof msg.content === 'string',
    );
}

function mapClientMessageToCoreMessage(
  clientMsg: ClientMessage,
): CoreMessage | null {
  if (clientMsg.role !== 'user') return null;
  return {
    role: 'user',
    content: clientMsg.content,
  };
}

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const parsedRequestBody = postRequestBodySchema.parse(json);

    const {
      id: chatId,
      message: incomingUserMessageFromClient,
      selectedChatModel,
      selectedVisibilityType,
    } = parsedRequestBody;

    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return new Response('Unauthorized', { status: 401 });
    }
    const profile = await db.query.userProfiles.findFirst({
      columns: { id: true },
      where: eq(schema.userProfiles.clerkId, clerkUserId),
    });
    const userId = profile?.id;
    if (!userId) {
      return new Response('User profile not found', { status: 500 });
    }

    const tokenResult = await getGoogleOAuthToken();
    if (tokenResult.error) {
      console.warn(
        `[SERVER_API_CHAT_DEBUG] Failed to get Google OAuth token for user ${userId}: ${tokenResult.error}`,
      );
    }

    const existingChat = await getChatById({ id: chatId });
    const isNewChat = !existingChat;

    if (isNewChat) {
      const newChatTitle = await generateTitleFromUserMessage({
        message: incomingUserMessageFromClient as UIMessage as Message,
      });
      await saveChat({
        id: chatId,
        userId: userId,
        title: newChatTitle,
        visibility: selectedVisibilityType,
      });
      revalidateTag(`chat-${chatId}`);
      revalidateTag(`history-${userId}`);
    } else {
      if (existingChat.userId !== userId) {
        return new Response('Unauthorized', { status: 401 });
      }
      if (existingChat.visibility !== selectedVisibilityType) {
        await db
          .update(schema.Chat)
          .set({ visibility: selectedVisibilityType })
          .where(eq(schema.Chat.id, chatId));
        revalidateTag(`chat-${chatId}`);
      }
    }

    const userMessageToSave: NewDBMessage = {
      chatId: chatId,
      id: incomingUserMessageFromClient.id,
      role: incomingUserMessageFromClient.role as NewDBMessage['role'],
      parts: incomingUserMessageFromClient.parts,
      attachments: incomingUserMessageFromClient.experimental_attachments ?? [],
      createdAt: incomingUserMessageFromClient.createdAt || new Date(),
    };
    await saveMessages({ messages: [userMessageToSave] });

    const selectedModelInfo = chatModels.find(
      m => m.id === selectedChatModel,
    );

    if (selectedModelInfo?.isN8n) {
      const webhookUrl = n8nWebhookUrls[selectedChatModel];
      if (!webhookUrl) {
        return new Response('Assistant configuration error', { status: 500 });
      }

      const n8nPayload = {
        chatId: chatId,
        userId: userId,
        messageId: incomingUserMessageFromClient.id,
        userMessage: incomingUserMessageFromClient.content,
        userMessageParts: incomingUserMessageFromClient.parts,
        userMessageDatetime: incomingUserMessageFromClient.createdAt,
        history: [],
        ...(tokenResult.token && { google_token: tokenResult.token }),
      };

      await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.N8N_WEBHOOK_SECRET_KEY && {
            Authorization: `Bearer ${process.env.N8N_WEBHOOK_SECRET_KEY}`,
          }),
        },
        body: JSON.stringify(n8nPayload),
      });

      return new Response(null, { status: 204 });
    } else {
      const dbMessages = await getMessagesByChatId({ id: chatId });
      const coreMessages = mapDBMessagesToCoreMessages(dbMessages);
      const userCoreMessage = mapClientMessageToCoreMessage(
        incomingUserMessageFromClient,
      );
      if (userCoreMessage) {
        coreMessages.push(userCoreMessage);
      }
      
      const combinedTools = await assembleTools({
        userId: userId,
        chatId: chatId,
      });

      const result = await streamText({
        model: myProvider.languageModel(selectedChatModel),
        system: systemPrompt({ selectedChatModel }),
        messages: coreMessages,
        tools: combinedTools,
        onFinish: async event => {
          const newAssistantMessage: NewDBMessage = {
            chatId: chatId,
            id: generateUUID(),
            role: 'assistant',
            parts: event.toolCalls
              ? { tool_calls: event.toolCalls }
              : (event.text as any),
            createdAt: new Date(),
          };
          await saveMessages({ messages: [newAssistantMessage] });
        },
      });
      
      const filteredStream = result.toAIStream().pipeThrough(
        createToolCallFilteringStream()
      );

      return new StreamingTextResponse(filteredStream);
    }
  } catch (error: any) {
    console.error('[API /api/chat] An unexpected error occurred:', error);
    return new Response(error.message || 'An error occurred', {
      status: 500,
      statusText: error.statusText || 'Internal Server Error',
    });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return new Response('Missing chat ID', { status: 400 });
    }

    const { userId: clerkUserId } = auth();
    if (!clerkUserId) {
      return new Response('Unauthorized', { status: 401 });
    }

    const profile = await db.query.userProfiles.findFirst({
      columns: { id: true },
      where: eq(schema.userProfiles.clerkId, clerkUserId),
    });
    const userId = profile?.id;
    if (!userId) {
      return new Response('User profile not found', { status: 500 });
    }

    const deletedChatId = await deleteChatById({ id, userId });

    if (!deletedChatId) {
      return new Response('Chat not found or you do not have permission', {
        status: 404,
      });
    }
    revalidateTag(`history-${userId}`);

    return new Response(JSON.stringify({ id: deletedChatId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Failed to delete chat:', error);
    return new Response('Failed to delete chat', { status: 500 });
  }
}
