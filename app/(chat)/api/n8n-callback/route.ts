import { NextResponse } from 'next/server';
import { saveMessages } from '@/lib/db/queries';
import { revalidateTag } from 'next/cache';

export async function POST(request: Request) {
  console.log('[n8n-callback] POST request received');

  try {
    // Verify callback secret if configured
    const callbackSecret = process.env.N8N_CALLBACK_SECRET_KEY;
    console.log(
      '[n8n-callback] Checking auth with secret:',
      callbackSecret ? 'present' : 'missing',
    );

    if (callbackSecret) {
      const authHeader = request.headers.get('authorization');
      console.log(
        '[n8n-callback] Auth header:',
        authHeader ? 'present' : 'missing',
      );

      if (!authHeader || authHeader !== `Bearer ${callbackSecret}`) {
        console.error('[n8n-callback] Invalid or missing authorization header');
        console.error('[n8n-callback] Expected:', `Bearer ${callbackSecret}`);
        console.error('[n8n-callback] Received:', authHeader);
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const body = await request.json();
    console.log('[n8n-callback] Request body:', JSON.stringify(body, null, 2));

    const {
      chatId,
      responseMessage,
      parts,
    }: {
      chatId: string;
      responseMessage: string;
      parts?: Array<{ type: string; text: string }>;
    } = body;

    console.log('[n8n-callback] Received callback for chat:', chatId);
    console.log(
      '[n8n-callback] Response message length:',
      responseMessage?.length || 0,
    );

    // Build message parts
    const messageParts =
      parts && parts.length > 0
        ? parts
        : [{ type: 'text', text: responseMessage }];

    // Save message to database
    console.log('[n8n-callback] Saving assistant message to database...');
    await saveMessages({
      messages: [
        {
          chatId: chatId,
          role: 'assistant',
          parts: messageParts,
          attachments: [],
          createdAt: new Date(),
        },
      ],
    });

    console.log('[n8n-callback] Successfully saved assistant message');

    // Revalidate chat cache so polling can pick up the new message
    revalidateTag(`chat-${chatId}`);

    console.log('[n8n-callback] Successfully processed callback');

    return NextResponse.json({
      ok: true,
      message: 'Assistant message saved successfully',
    });
  } catch (error: any) {
    console.error('[n8n-callback] Error processing callback:', error);
    console.error('[n8n-callback] Error stack:', error.stack);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 },
    );
  }
}
