import { z } from 'zod';
import { tool, generateText, generateObject, type DataStreamWriter } from 'ai';
import { db } from '@/lib/db/queries';
import * as schema from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { google } from '@ai-sdk/google';
import { getMessagesByChatId } from '@/lib/db/queries';

interface GiftFinderProps {
  userId: string;
  dataStream?: DataStreamWriter;
  chatId: string;
}

const giftWebsites = [
    "https://thingtesting.com",
    "https://nymag.com/strategist/",
    "https://www.nytimes.com/wirecutter/",
    "https://deals.kinja.com/",
    "https://www.businessinsider.com/reviews",
    "https://kit.co",
    "https://www.ongoody.com/",
    "http://alexkwa.com/",
];

function emitProgress(
  dataStream: DataStreamWriter | undefined,
  stage: 'context' | 'parsing' | 'searching' | 'formatting' | 'deduplication',
  message: string,
  current?: number,
  total?: number,
  website?: string,
) {
  if (dataStream) {
    const payload: { [key: string]: any } = { stage, message };
    if (current !== undefined) payload.current = current;
    if (total !== undefined) payload.total = total;
    if (website !== undefined) payload.website = website;

    dataStream.writeData({
      type: 'gift-progress',
      content: payload,
    });
  }
}

const giftIdeaSchema = z.object({
    name: z.string().describe("The name of the gift product."),
    description: z.string().describe("A brief description of the gift."),
    price: z.string().describe("The price of the gift, with currency."),
    url: z.string().describe("A direct link to purchase the gift."),
    recipient_suitability: z.string().describe("Explanation of why this gift is suitable for the recipient based on their profile.")
});

const giftIdeasSchema = z.object({
  ideas: z.array(giftIdeaSchema).min(0).max(5).describe("An array of 5 unique gift ideas with real product links."),
});

async function getUserContext(userId: string): Promise<string | null> {
  try {
    console.log(`[GiftFinder] Fetching context for userId: ${userId}`);
    const [userProfile] = await db
      .select({ 
        context_gift_purchases: schema.userProfiles.context_gift_purchases,
        full_name: schema.userProfiles.full_name,
        first_name: schema.userProfiles.first_name,
      })
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.id, userId));

    console.log(`[GiftFinder] User profile found:`, userProfile ? 'Yes' : 'No');
    console.log(`[GiftFinder] Gift context:`, userProfile?.context_gift_purchases ? 'Available' : 'None');

    return userProfile?.context_gift_purchases ?? null;
  } catch (error) {
    console.error(`[GiftFinder] Error fetching user context:`, error);
    return null;
  }
}

async function getPreviousGiftSuggestions(chatId: string): Promise<string[]> {
  try {
    console.log(`[GiftFinder] Fetching previous gift suggestions for chatId: ${chatId}`);
    const messages = await getMessagesByChatId({ id: chatId });
    
    const giftSuggestions: string[] = [];
    
    for (const message of messages) {
      if (message.role === 'assistant' && message.parts) {
        let content = '';
        
        if (Array.isArray(message.parts)) {
          for (const part of message.parts) {
            if (part.type === 'tool-invocation' && part.toolInvocation?.toolName === 'giftFinder') {
              if (part.toolInvocation.result?.response) {
                content += part.toolInvocation.result.response;
              }
            } else if (part.type === 'text' && part.text?.includes('Gift Ideas')) {
              content += part.text;
            }
          }
        }
        
        if (content) {
          // Extract gift names from markdown format
          const giftMatches = content.match(/##\s+\d+\.\s+(.+?)(?=\n|$)/g);
          if (giftMatches) {
            giftMatches.forEach(match => {
              const giftName = match.replace(/##\s+\d+\.\s+/, '').trim();
              if (giftName) {
                giftSuggestions.push(giftName);
              }
            });
          }
        }
      }
    }
    
    console.log(`[GiftFinder] Found ${giftSuggestions.length} previous gift suggestions:`, giftSuggestions);
    return giftSuggestions;
  } catch (error) {
    console.error(`[GiftFinder] Error fetching previous gift suggestions:`, error);
    return [];
  }
}

async function findGiftIdeas(
  query: string,
  context: string | null,
  recipient: string,
  website: string,
  excludeItems: string[] = [],
): Promise<z.infer<typeof giftIdeasSchema>> {
  const excludeText = excludeItems.length > 0 
    ? `\n\nIMPORTANT: Do NOT suggest these items as they were already suggested: ${excludeItems.join(', ')}`
    : '';

  const prompt = `
    Use your web search capabilities to search for: "${query} site:${website}"
    
    You need to find 5 NEW and DIFFERENT real products for "${recipient}" that are currently available on ${website}.
    
    STEP BY STEP PROCESS:
    1. Search the web for: "${query} site:${website}"
    2. Look through the search results for actual product pages
    3. Visit the specific product pages to get real names, prices, and URLs
    4. Verify each URL leads to an actual product page
    5. ALL 5 PRODUCTS MUST have real, direct product URLs that work
    6. Do NOT use fallback formats - only real product links
    7. Make sure these are DIFFERENT from any previously suggested items
    
    Recipient context: ${context || "No context provided."}
    ${excludeText}
    
    CRITICAL: Actually perform web searches and visit product pages. Don't make up products or URLs.
    Focus on finding UNIQUE items that haven't been suggested before.
    
    If you cannot find 5 real products with verified working URLs, return fewer products rather than fake ones.
    
    Return 5 real products with verified working URLs that are DIFFERENT from previously suggested items.
  `;

  const { object } = await generateObject({
    model: google('gemini-2.5-pro'),
    schema: giftIdeasSchema,
    prompt,
  });

  return object;
}

async function formatGiftResults(
  allIdeas: z.infer<typeof giftIdeaSchema>[],
  context: string | null,
  query: string,
  recipient: string,
  previousSuggestions: string[] = [],
): Promise<string> {
    if (allIdeas.length === 0) {
        return `I wasn't able to find any new gift ideas for ${recipient}. If you tell me a little more about what ${recipient} likes, I can try again with different search terms!`;
    }

    // Filter out duplicates based on name similarity
    const filteredIdeas = allIdeas.filter(idea => {
      const similarExists = previousSuggestions.some(prevSuggestion => {
        const similarity = calculateSimilarity(idea.name.toLowerCase(), prevSuggestion.toLowerCase());
        return similarity > 0.7; // If 70% similar, consider it a duplicate
      });
      return !similarExists;
    });

    console.log(`[GiftFinder] Filtered ${allIdeas.length} ideas down to ${filteredIdeas.length} unique ideas`);

    if (filteredIdeas.length === 0) {
        return `I found some gift ideas for ${recipient}, but they were similar to what I already suggested. Let me try a different approach - could you be more specific about what type of gift you're looking for? For example: tech gadgets, home decor, books, clothing, etc.`;
    }

    const uniqueIdeas = Array.from(new Map(filteredIdeas.map(idea => [idea.name, idea])).values());

    // Prioritize ideas with real product URLs
    const sortedIdeas = uniqueIdeas.sort((a, b) => {
      const aIsReal = !a.url.includes('Search for') && !a.description.includes('Search for');
      const bIsReal = !b.url.includes('Search for') && !b.description.includes('Search for');
      if (aIsReal && !bIsReal) return -1;
      if (!aIsReal && bIsReal) return 1;
      return 0;
    });

    // Take top 5-6 ideas, ensuring most have real links
    const topIdeas = sortedIdeas.slice(0, 6);

    const { text: formattedText } = await generateText({
        model: google('gemini-2.5-flash'),
        prompt: `Format these NEW gift ideas for ${recipient} in a clean markdown list.

These are ADDITIONAL suggestions that are different from previous recommendations.

${JSON.stringify(topIdeas, null, 2)}

Use this exact format:
# More Gift Ideas for ${recipient}

## 1. [Product Name]
**[Price]** • [Buy Now]([URL])

[Description]

**Why this works for ${recipient}:** [Suitability explanation]

---

For products where the URL is a website homepage with search instructions, format the link as:
**[Price]** • [Visit Website]([URL])

[Description with search instructions]

Keep it clean and structured.`,
    });

    return formattedText;
}

// Simple similarity calculation using Levenshtein distance
function calculateSimilarity(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  
  if (len1 === 0) return len2 === 0 ? 1 : 0;
  if (len2 === 0) return 0;
  
  const matrix = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(null));
  
  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;
  
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  
  const distance = matrix[len1][len2];
  return 1 - distance / Math.max(len1, len2);
}

export const giftFinder = ({ userId, dataStream, chatId }: GiftFinderProps) =>
  tool({
    description: `The Gift Finder tool is used to get personalized gift recommendations for a specific person. It uses the recipient's known preferences and past gifts to find unique ideas with real-time pricing and purchase links. The tool automatically avoids suggesting duplicate items if called multiple times in the same conversation. You only need to provide the recipient's name and the occasion or your general request. For example: "Find a birthday gift for Meghan." The tool will handle the research and ensure new suggestions each time.`,

    parameters: z.object({
      recipient: z.string().describe("The name of the person receiving the gift."),
      query: z.string().describe('The user\'s gift search request (e.g., "birthday gift", "something for someone who loves to cook").'),
    }),

    execute: async ({ recipient, query }) => {
      try {
        console.log(`[GiftFinder] Starting gift search for ${recipient} with query: ${query}`);
        
        emitProgress(dataStream, 'context', `Getting ${recipient}'s past gift preferences and purchase history...`);
        const userContext = await getUserContext(userId);
        
        console.log(`[GiftFinder] User context retrieved:`, userContext ? 'Yes' : 'No');
        
        if (!userContext) {
          console.log(`[GiftFinder] No gift context found for user. Proceeding with general search.`);
          emitProgress(dataStream, 'context', `No previous gift data found. Searching for general recommendations...`);
        } else {
          console.log(`[GiftFinder] Using gift context (${userContext.length} characters)`);
          emitProgress(dataStream, 'context', `Found ${recipient}'s gift preferences from past purchases and emails. Personalizing search...`);
        }

        // Get previous gift suggestions to avoid duplicates
        emitProgress(dataStream, 'deduplication', `Checking for previously suggested gifts to avoid duplicates...`);
        const previousSuggestions = await getPreviousGiftSuggestions(chatId);
        
        if (previousSuggestions.length > 0) {
          console.log(`[GiftFinder] Found ${previousSuggestions.length} previous suggestions to avoid`);
          emitProgress(dataStream, 'deduplication', `Found ${previousSuggestions.length} previously suggested items. Ensuring new recommendations...`);
        } else {
          console.log(`[GiftFinder] No previous suggestions found - first time search`);
        }

        emitProgress(dataStream, 'parsing', `Analyzing what ${recipient} might like based on the request...`);
        
        const allGiftIdeas: z.infer<typeof giftIdeaSchema>[] = [];
        const totalWebsites = giftWebsites.length;

        for (let i = 0; i < totalWebsites; i++) {
            const site = giftWebsites[i];
            const siteName = new URL(site).hostname.replace('www.', '');
            emitProgress(dataStream, 'searching', `Searching for NEW gifts on ${siteName}...`, i + 1, totalWebsites, siteName);
            try {
                const results = await findGiftIdeas(query, userContext, recipient, site, previousSuggestions);
                if (results.ideas) {
                    allGiftIdeas.push(...results.ideas);
                    console.log(`[GiftFinder] Found ${results.ideas.length} ideas from ${siteName}`);
                }
            } catch (error) {
                console.error(`[GiftFinder] Error searching ${site}:`, error);
                // Continue to the next site even if one fails
            }
        }

        console.log(`[GiftFinder] Total ideas found: ${allGiftIdeas.length}`);

        if (allGiftIdeas.length === 0) {
            return { response: `I wasn't able to find any new gift ideas for ${recipient}. If you tell me a little more about what ${recipient} likes, I can try again with different search terms!` };
        }

        emitProgress(dataStream, 'formatting', 'Putting together your personalized gift list with new suggestions...');
        
        const formattedResults = await formatGiftResults(allGiftIdeas, userContext, query, recipient, previousSuggestions);

        return { response: formattedResults };

      } catch (error) {
        console.error('[GiftFinder] Error during execution:', error);
        return {
          error: 'Failed to find gifts',
          details: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  }); 