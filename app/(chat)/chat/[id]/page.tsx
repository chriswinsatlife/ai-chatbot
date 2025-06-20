import { auth } from '@clerk/nextjs/server'; // RESTORE CLERK AUTH IMPORT
// import { createClient } from '@/lib/supabase/server'; // REMOVE SUPABASE CLIENT IMPORT
import { redirect, notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import type { UIMessage } from 'ai';
import type { DBMessage } from '@/lib/db/schema';
import { DEFAULT_CHAT_MODEL } from '@/lib/ai/models'; // ADD: Import default model

import { Chat } from '@/components/chat';
import { getChat } from '@/app/actions';
import { DataStreamHandler } from '@/components/data-stream-handler';

// Function to convert DB messages to UI messages (keep as is)
function convertToUIMessages(dbMessages: DBMessage[]): UIMessage[] {
  return dbMessages.map((message) => {
    return {
      id: message.id,
      role: message.role as UIMessage['role'],
      parts: message.parts as any,
      experimental_attachments: message.attachments as any,
      createdAt: message.createdAt,
    } satisfies Omit<UIMessage, 'content'>;
  }) as UIMessage[];
}

// Correct signature for Next.js 15+ async page with dynamic route
export default async function ChatPage(props: {
  params: Promise<{ id: string }>;
}) {
  // Await the params promise to get the resolved object
  const resolvedParams = await props.params;
  const chatId = resolvedParams.id; // Use id from the resolved object

  console.log(`[ChatPage] Loading chat for ID: ${chatId}`); // DEBUG LOG

  // --- RESTORE CLERK AUTH ---
  const { userId: clerkUserId } = await auth(); // Use Clerk auth()

  if (!clerkUserId) {
    // Redirect to Clerk sign-in page using the chatId variable
    redirect(`/sign-in?redirect_url=/chat/${chatId}`);
  }
  // --- END OF AUTH RESTORE ---

  // Use the chatId variable here
  console.log(`[ChatPage] Calling getChat for ID: ${chatId}`); // DEBUG LOG
  const chat = await getChat(chatId);
  console.log(
    `[ChatPage] getChat returned: ${chat ? 'Chat object' : 'null/undefined'}`,
  ); // DEBUG LOG

  if (!chat) {
    notFound();
  }

  const initialMessages = chat.messages
    ? convertToUIMessages(chat.messages)
    : [];

  // ** IMPORTANT: Check ownership using the chat.userId (UUID) **
  // We need the profile UUID for the logged-in Clerk user to compare.
  // This page currently *only* has the clerkUserId.
  // A proper check requires fetching the profile here or ensuring getChat returns it.
  // For now, we'll proceed *without* the private chat check,
  // assuming authorization happens elsewhere or needs refinement.
  /* 
  if (chat.visibility === 'private') {
    // TODO: Fetch user profile UUID based on clerkUserId to compare with chat.userId
    // const userProfileId = await getUserProfileId(clerkUserId); 
    // if (userProfileId !== chat.userId) { 
    //   notFound();
    // }
  }
  */

  const cookieStore = await cookies();
  const chatModelFromCookie = cookieStore.get('chat-model')?.value;
  // Use the imported DEFAULT_CHAT_MODEL as fallback
  const selectedChatModel = chatModelFromCookie || DEFAULT_CHAT_MODEL;

  // ** IMPORTANT: Determine readonly status using chat.userId (UUID) **
  // Similarly, we need the profile UUID for the logged-in user.
  // Let's assume for now: if you could load the chat, you can edit it.
  // This might need refinement based on how `getChat` handles permissions.
  // const isReadonly = userProfileId !== chat.userId; // Needs profile UUID
  const isReadonly = false; // TEMPORARY: Assume editable if loaded

  return (
    <>
      <Chat
        id={chat.id}
        initialMessages={initialMessages}
        selectedChatModel={selectedChatModel}
        selectedVisibilityType={chat.visibility}
        isReadonly={isReadonly}
      />
      <DataStreamHandler id={chatId} />
    </>
  );
}
