import { z } from 'zod';
import { tool, generateText, generateObject, type DataStreamWriter } from 'ai';
import { db } from '@/lib/db/queries';
import * as schema from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { google } from '@ai-sdk/google';

interface GiftFinderProps {
  userId: string;
  dataStream?: DataStreamWriter;
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
  stage: 'context' | 'parsing' | 'searching' | 'formatting',
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

async function findGiftIdeas(
  query: string,
  context: string | null,
  recipient: string,
  website: string,
): Promise<z.infer<typeof giftIdeasSchema>> {
  const prompt = `
    Use your web search capabilities to search for: "${query} site:${website}"
    
    You need to find 5 real products for "${recipient}" that are currently available on ${website}.
    
    STEP BY STEP PROCESS:
    1. Search the web for: "${query} site:${website}"
    2. Look through the search results for actual product pages
    3. Visit the specific product pages to get real names, prices, and URLs
    4. Verify each URL leads to an actual product page
    5. ALL 5 PRODUCTS MUST have real, direct product URLs that work
    6. Do NOT use fallback formats - only real product links
    
    Recipient context: ${context || "No context provided."}
    
    CRITICAL: Actually perform web searches and visit product pages. Don't make up products or URLs.
    
    If you cannot find 5 real products with verified working URLs, return fewer products rather than fake ones.
    
    Return 5 real products with verified working URLs.
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
): Promise<string> {
    if (allIdeas.length === 0) {
        return `I wasn't able to find any gift ideas for ${recipient}. If you tell me a little more about what she likes, I can try again! Or, I can help you find a gift for someone else.`;
    }

    const uniqueIdeas = Array.from(new Map(allIdeas.map(idea => [idea.name, idea])).values());

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
        prompt: `Format these gift ideas for ${recipient} in a clean markdown list:

${JSON.stringify(topIdeas, null, 2)}

Use this exact format:
# Gift Ideas for ${recipient}

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


export const giftFinder = ({ userId, dataStream }: GiftFinderProps) =>
  tool({
    description: `The Gift Finder tool is used to get personalized gift recommendations for a specific person. It uses the recipient's known preferences and past gifts to find unique ideas with real-time pricing and purchase links. You only need to provide the recipient's name and the occasion or your general request. For example: "Find a birthday gift for Meghan." The tool will handle the research. The tool will return a markdown list of suggestions.`,

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

        emitProgress(dataStream, 'parsing', `Analyzing what ${recipient} might like based on the request...`);
        
        const allGiftIdeas: z.infer<typeof giftIdeaSchema>[] = [];
        const totalWebsites = giftWebsites.length;

        for (let i = 0; i < totalWebsites; i++) {
            const site = giftWebsites[i];
            const siteName = new URL(site).hostname.replace('www.', '');
            emitProgress(dataStream, 'searching', `Searching for gifts on ${siteName}...`, i + 1, totalWebsites, siteName);
            try {
                const results = await findGiftIdeas(query, userContext, recipient, site);
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
            return { response: `I wasn't able to find any gift ideas for ${recipient}. If you tell me a little more about what she likes, I can try again! Or, I can help you find a gift for someone else.` };
        }

        emitProgress(dataStream, 'formatting', 'Putting together your personalized gift list...');
        
        const formattedResults = await formatGiftResults(allGiftIdeas, userContext, query, recipient);

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