import { z } from 'zod';
import { tool, generateText, generateObject } from 'ai';
import { db } from '@/lib/db/queries';
import * as schema from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';

// SerpAPI configuration
const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY;

if (!SERPAPI_API_KEY) {
  throw new Error('SERPAPI_API_KEY environment variable is required');
}

console.log('[GoogleHotels] Tool initialized');

interface GoogleHotelsProps {
  userId: string;
}

// JSON Schema for structured output parsing (matching n8n workflow)
const searchQuerySchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    payload: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description: 'Search query, required field',
        },
        check_in_date: {
          type: 'string',
          format: 'date',
          description: 'Check-in date, required field',
        },
        check_out_date: {
          type: 'string',
          format: 'date',
          description: 'Check-out date, required field',
        },
        vacation_rentals: {
          type: 'boolean',
          description:
            'Indicates if vacation rentals are included. Should be omitted if searching for hotels or when the user does not explicitly ask for vacation rentals',
          default: null,
        },
        adults: {
          type: 'number',
          default: 2,
        },
        children: {
          type: 'number',
          default: 0,
        },
      },
      required: ['q', 'check_in_date', 'check_out_date'],
      additionalProperties: false,
    },
  },
  required: ['payload'],
  additionalProperties: false,
};

async function getUserContext(userId: string): Promise<string | null> {
  try {
    console.log(
      `[GoogleHotels] [getUserContext] Fetching context for userId: ${userId}`,
    );
    const [userProfile] = await db
      .select({ context_hotels: schema.userProfiles.context_hotels })
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.id, userId));

    console.log(
      `[GoogleHotels] [getUserContext] User profile found:`,
      userProfile ? 'Yes' : 'No',
    );
    if (userProfile) {
      console.log(
        `[GoogleHotels] [getUserContext] Context hotels:`,
        userProfile.context_hotels || 'None',
      );
    }

    return userProfile?.context_hotels ?? null;
  } catch (error) {
    console.error(
      `[GoogleHotels] [getUserContext] Error fetching user context:`,
      error,
    );
    return null;
  }
}

async function parseSearchQuery(
  query: string,
  context: string | null,
): Promise<any> {
  console.log(`[GoogleHotels] [parseSearchQuery] Received query: "${query}"`);
  console.log(`[GoogleHotels] [parseSearchQuery] Received context:`, context);

  // EXACT PROMPT FROM N8N WORKFLOW - NO CHANGES
  const prompt = `Based on the user query, please output the search JSON. Leave a value null or blank if it is unclear. 

- If the user specifies vacation rentals or Airbnb-type listings, set "vacation_rentals" to true, otherwise assume hotels and set it to false. 
- Do not use commas or special characters in the query string. 
- Check in and check out date is *required* (default to check in date as 1 week from today if not provided in the query).
- Assume the client is traveling alone as one adult unless otherwise specified in the context or query.
- The <Client_Context> is general historic information and should be used when details are not specified in the <User_Query>. 
     - For example, if the user does not specify the bed size, we may use context from <Client_Context> to fill this in. 
- The <User_Query> overrides on any conflict, since it is a current request from the user. 
     - For example, if the context says "the client typically travels alone" and "always prefers hotels" but the <User_Query> requests an Airbnb or villa which sleeps 4, the JSON you output should conform to the <User_Query>. 
- The <Current_DateTime> should be used for interpreting queries like "next month" or "next week".
- The "q" is a query that would be entered into a search box on hotels.google.com. You can use anything that you would use in a regular Google Hotels search. Avoid crazy search syntax or very long q strings.
- Output JSON according to the schema. 
</Guidelines>

<Current_DateTime>
${new Date().toISOString()}
</Current_DateTime>

<Client_Context>
${context || 'No context provided.'}
</Client_Context>

<User_Query>
${query}
</User_Query>`;

  console.log(
    `[GoogleHotels] [parseSearchQuery] Prompt for generateObject length:`,
    prompt.length,
  );

  try {
    // Use generateObject which handles JSON parsing automatically
    const { object } = await generateObject({
      model: google('gemini-2.5-flash'),
      prompt: prompt,
      schema: z.object({
        payload: z.object({
          q: z.string().describe('Search query, required field'),
          check_in_date: z.string().describe('Check-in date, required field'),
          check_out_date: z.string().describe('Check-out date, required field'),
          vacation_rentals: z
            .boolean()
            .optional()
            .describe('Indicates if vacation rentals are included'),
          adults: z.number().default(2),
          children: z.number().default(0),
        }),
      }),
    });

    console.log(`[GoogleHotels] [parseSearchQuery] Generated object:`, object);

    const payload = object.payload;

    // Build search params exactly like n8n workflow
    const searchParams: any = {
      q: payload.q.replace(/, /g, ' '),
      check_in_date: payload.check_in_date,
      check_out_date: payload.check_out_date,
      adults: payload.adults || 1,
      children: payload.children || 0,
      rating: '8', // from n8n
    };

    // Dynamic parameter based on vacation_rentals like n8n
    if (payload.vacation_rentals) {
      searchParams.vacation_rentals = true;
      searchParams.property_types = '1,2,3,4,5,6,7,8,10,11,21'; // from n8n
    } else {
      searchParams.hotel_class = '3,4,5'; // from n8n
      searchParams.property_types = '12,13,15,17,18,19,20,21,22,23,24'; // from n8n
    }

    console.log(
      `[GoogleHotels] [parseSearchQuery] Parsed search params:`,
      searchParams,
    );
    return searchParams;
  } catch (error) {
    console.error(
      '[GoogleHotels] [parseSearchQuery] Error parsing search query:',
      error,
    );
    throw error;
  }
}

async function searchGoogleHotels(searchParams: any): Promise<any> {
  console.log(
    `[GoogleHotels] [searchGoogleHotels] searchParams:`,
    searchParams,
  );
  try {
    // Build URL with query parameters like n8n does
    const url = new URL('https://serpapi.com/search');
    url.searchParams.append('engine', 'google_hotels');
    url.searchParams.append('api_key', SERPAPI_API_KEY as string);

    // Add all search parameters
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    });

    console.log(
      `[GoogleHotels] [searchGoogleHotels] Fetching URL: ${url.toString()}`,
    );

    const response = await fetch(url.toString());
    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[GoogleHotels] [searchGoogleHotels] SerpAPI error response: ${errorText}`,
      );
      throw new Error(`SerpAPI returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log(
      `[GoogleHotels] [searchGoogleHotels] SerpAPI response received.`,
    );
    return data;
  } catch (error) {
    console.error(
      `[GoogleHotels] [searchGoogleHotels] Error fetching from SerpAPI:`,
      error,
    );
    throw error;
  }
}

async function getPropertyDetails(property: any): Promise<any> {
  console.log(
    `[GoogleHotels] [getPropertyDetails] Fetching details for property:`,
    property.name,
  );
  try {
    // Parse the serpapi_property_details_link to get the URL
    const detailsUrl = new URL(property.serpapi_property_details_link);
    // Add our API key
    detailsUrl.searchParams.set('api_key', SERPAPI_API_KEY as string);

    console.log(
      `[GoogleHotels] [getPropertyDetails] Fetching URL: ${detailsUrl.toString()}`,
    );

    const response = await fetch(detailsUrl.toString());
    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[GoogleHotels] [getPropertyDetails] SerpAPI error response: ${errorText}`,
      );
      throw new Error(`SerpAPI returned ${response.status}: ${errorText}`);
    }

    const details = await response.json();
    console.log(
      `[GoogleHotels] [getPropertyDetails] Received details for ${property.name}`,
    );
    return details;
  } catch (error) {
    console.error(
      `[GoogleHotels] [getPropertyDetails] Error fetching details for ${property.name}:`,
      error,
    );
    return property; // Return original if details fail
  }
}

async function summarizeReviews(property: any): Promise<any> {
  console.log(
    `[GoogleHotels] [summarizeReviews] Summarizing reviews for:`,
    property.name,
  );

  // EXACT PROMPT FROM N8N WORKFLOW - NO CHANGES
  const reviewContent = `Let's summarize the reviews about this hotel or vacation rental. Be as concise as possible. Just capture the key details, red flags, and positive points. You do not need to speak in complete sentences.

## Property Name:
${property.name}

## Reviews & Ratings:
### Review Count: ${property.reviews}
### Overall Rating: ${property.overall_rating} / 5
  - Note: The average Google star rating for hotels is generally around 4.42 stars, according to a study from BrightLocal. Below 4.4 is below average. Below a 4 indicates serious issues with the property. 4.5-4.6+ is likely the bare minimum for a respectable property.
### Rating Details: 
${
  property.ratings
    ?.map(
      (item: any) =>
        `\t- ${item.stars}/5 Stars: ${item.count}/${property.reviews} (${((item.count / property.reviews) * 100).toFixed(1)}%)`,
    )
    .join('\n') || 'Not available.'
}

## Review Breakdown:
${
  property.reviews_breakdown
    ?.map(
      (item: any) =>
        `- ${item.description}: \n\tMentions: ${item.total_mentioned} \n\tPositive: ${item.positive} (${((item.positive / item.total_mentioned) * 100).toFixed(1)}%) \n\tNegative: ${item.negative} (${((item.negative / item.total_mentioned) * 100).toFixed(1)}%) \n\tNeutral: ${item.neutral} (${((item.neutral / item.total_mentioned) * 100).toFixed(1)}%)`,
    )
    .join('\n') || 'Not available.'
}

## Review_Breakdown:
${
  property.other_reviews
    ?.slice(0, 24)
    .map(
      (item: any, index: number) =>
        `Review ${index + 1} \n\tDate: ${item.user_review.date} \n\tScore: ${item.user_review.rating.score}/${item.user_review.rating.max_score} \n\tReview: ${item.user_review.comment} \n\tSource: ${item.source}`,
    )
    .join('\n\n') || 'Not available.'
}`;

  console.log(
    `[GoogleHotels] [summarizeReviews] Prompt length: ${reviewContent.length}`,
  );

  try {
    const { text: summary } = await generateText({
      model: google('gemini-2.5-flash'),
      prompt: reviewContent,
    });
    console.log(
      `[GoogleHotels] [summarizeReviews] Summary generated for ${property.name}.`,
    );
    return summary
      .split('\n')
      .map((item: string) => `\t${item}`)
      .join('\n');
  } catch (error) {
    console.error(
      `[GoogleHotels] [summarizeReviews] Failed to summarize reviews for ${property.name}:`,
      error,
    );
    return 'Could not summarize reviews.';
  }
}

function trimFields(property: any): any {
  // Matching n8n Trim Fields node exactly
  const trimmed: any = {
    ...property,
    reviews_summary: property.reviews_summary,
    rate_per_night_lowest_usd: property.rate_per_night?.extracted_lowest,
    total_rate_lowest_usd: property.total_rate?.extracted_lowest,
    link: property.link,
    google_maps_link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([property.name, property.address].join('+'))}`,
  };

  // Process featured_prices like n8n
  if (property.featured_prices) {
    trimmed.featured_prices = property.featured_prices.map((f: any) => ({
      ...f,
      logo: undefined,
      remarks: undefined,
      rate_per_night: f.rate_per_night
        ? {
            ...f.rate_per_night,
            before_taxes_fees: undefined,
            extracted_before_taxes_fees: undefined,
          }
        : undefined,
      total_rate: f.total_rate
        ? {
            ...f.total_rate,
            before_taxes_fees: undefined,
            extracted_before_taxes_fees: undefined,
          }
        : undefined,
      rooms: (f.rooms || []).map((r: any) => ({
        ...r,
        images: undefined,
        rate_per_night: r.rate_per_night
          ? {
              ...r.rate_per_night,
              before_taxes_fees: undefined,
              extracted_before_taxes_fees: undefined,
            }
          : undefined,
        total_rate: r.total_rate
          ? {
              ...r.total_rate,
              before_taxes_fees: undefined,
              extracted_before_taxes_fees: undefined,
            }
          : undefined,
      })),
    }));
  }

  // Process prices like n8n
  if (property.prices) {
    trimmed.prices = property.prices.map((item: any) => {
      const currentItem = { ...item };
      if (currentItem && typeof currentItem === 'object') {
        // Remove top-level fields
        currentItem.logo = undefined;
        currentItem.original_rate_per_night = undefined;

        // Remove nested fields
        if (
          currentItem.total_rate &&
          typeof currentItem.total_rate === 'object'
        ) {
          currentItem.total_rate.before_taxes_fees = undefined;
          currentItem.total_rate.extracted_before_taxes_fees = undefined;
        }

        if (
          currentItem.rate_per_night &&
          typeof currentItem.rate_per_night === 'object'
        ) {
          currentItem.rate_per_night.before_taxes_fees = undefined;
          currentItem.rate_per_night.extracted_before_taxes_fees = undefined;
        }
      }
      return currentItem;
    });
  }

  // Exclude fields like n8n
  const excludeFields = [
    'message',
    'index',
    'logprobs',
    'finish_reason',
    'rate_per_night',
    'total_rate',
    'deal',
    'deal_description',
    'nearby_places',
    'images',
    'serpapi_property_details_link',
    'search_metadata',
    'search_parameters',
    'reviews_breakdown',
    'other_reviews',
  ];

  excludeFields.forEach((field) => {
    trimmed[field] = undefined;
  });

  return trimmed;
}

async function formatHotelResults(
  properties: any[],
  searchResults: any,
  context: string | null,
  query: string,
): Promise<string> {
  console.log(
    `[GoogleHotels] [formatHotelResults] Formatting ${properties.length} properties.`,
  );

  // Flatten function exactly like n8n
  function flatten(obj: any, prefix = ''): any {
    return Object.entries(obj).reduce((acc: any, [k, v]) => {
      const pre = prefix.length ? `${prefix}.` : '';
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        Object.assign(acc, flatten(v, pre + k));
      } else {
        acc[pre + k] = v;
      }
      return acc;
    }, {});
  }

  // Create accommodation options string exactly like n8n
  const accommodationOptions = properties
    .map((property, index) => {
      const flattenedOption = flatten(property);
      const formattedProperties = Object.entries(flattenedOption)
        .map(([k, v]) => `\n\t${k}: ${v}`)
        .join('');
      return `- ## Option ${index + 1} of ${properties.length}${formattedProperties}`;
    })
    .join('\n\n');

  // EXACT PROMPT FROM N8N WORKFLOW - NO CHANGES
  const formattingPrompt = `<instructions>
Please organize the following accommodation options in a proper markdown output. 

- Include all the relevant details like property names, amenities, costs, data points from reviews, etc into a markdown-fromatted output.
- Output markdown following the example provided. 
- Ensure to include the full booking URLs and NEVER truncate them. You only need to include 1-2 booking options per property--not all.
- Make sure to take into account the client's accommodation preferences when ordering the hotels, which are given below.
- You may omit options from the output if they do not fit the client's preferences. You do not have to output every single one.
- You can and should re-arrange the order based on what you believe the client would select themselves for this particular trip.
- Where there is a conflict between <Client_Context> and the <Current_Client_Accommodation_Search_Query>, the <Current_Client_Accommodation_Search_Query> shoul always win. This goes for inclusion/exclusion of results, sort order, etc.
</instructions>

<accommodation_options (${properties.length}_options)>
${accommodationOptions}
</accommodation_options>

<Client_Context>
${context || 'No context provided.'}
</Client_Context>

<Current_Client_Accommodation_Search_Query>
${query}
</Current_Client_Accommodation_Search_Query>

<example_markdown_output>
## The Aviator Bali
* 🌐 [Website](https://aviatorbali.com)
* 📍[Jalan Tegal Sari Gang Kana No.59, Tibubeneng, Kuta Utara, 80363 Canggu](https://www.google.com/maps/search/?api=1&query=name+address)
* 🏨 \${key_amenities_summary}
* 💬 \${reviews_summary}
* ⭐ 9.2 - Exceptional (74 reviews) 
* [Booking.com](https://www.booking.com/full_link) - $1,826
	* Pay online, non-refundable
* [Agoda](https://www.agoda.com/aviator-bali/hotel/full_link) - $2,735
	* Pay at check-in, free cancellation until 11:59PM on July 13, 2025
* [Website](https://hotels.cloudbeds.com/en/reservation/full_link - $ 1,627.81
	* Pay online, non-refundable

\${3-11 similar reviews...}

See more options or change the search details on **[🏨 Google Hotels](${searchResults.search_metadata?.prettify_html_file || searchResults.search_metadata?.google_hotels_url || 'https://www.google.com/travel/hotels'})**.
</example_markdown_output>`;

  console.log('[GoogleHotels] [formatHotelResults] Starting AI formatting');

  try {
    const { text: formattedText } = await generateText({
      model: google('gemini-2.5-flash'),
      prompt: formattingPrompt,
    });

    console.log(
      '[GoogleHotels] [formatHotelResults] AI formatting completed successfully.',
    );

    // Create final response exactly like n8n Response node
    const googleHotelsUrl =
      searchResults.search_metadata?.prettify_html_file ||
      searchResults.search_metadata?.google_hotels_url ||
      'https://www.google.com/travel/hotels';

    const finalResponse = `# Accommodation Options
${formattedText
  .split('\n')
  .filter((item: string) => item.slice(0, 3) !== '```')
  .join('\n')}

## Accommodation Preferences
${context || 'No accommodation preferences available.'}

## Current Accommodation Query
${query}

## Google Hotels Search Results Page
${googleHotelsUrl}`;

    return finalResponse;
  } catch (error) {
    console.error(
      '[GoogleHotels] [formatHotelResults] Error formatting results with AI:',
      error,
    );
    throw error;
  }
}

export const googleHotels = ({ userId }: GoogleHotelsProps) =>
  tool({
    description: `The Google Hotels tool is used to search for hotels and vacation rentals. This tool contains information about the user's accommodation preferences, so you generally do not need to ask the user about their preferences like hotel vs Airbnb, preferred brands, desired amenities, pricing, etc. You will need only the trip-specific information like the date of the trip, destination, required amenities, etc. Simply call the tool with a detailed query on their itinerary. Note the tool will only output links to book hotels and vacation rentals, and accommodation cannot be booked directly by the AI. YOU CANNOT BOOK ACCOMMODATIONS. DO NOT CLAIM YOU CAN BOOK ACCOMMODATIONS ON THE USER'S BEHALF.`,
    parameters: z.object({
      query: z
        .string()
        .describe(
          'The user\'s hotel search request (e.g., "luxury hotel in Paris next month", "beachfront villa in Bali for 4 people")',
        ),
    }),
    execute: async ({ query }) => {
      console.log(
        `[GoogleHotels] [execute] Executing search for userId: ${userId}, query: "${query}"`,
      );
      try {
        // Step 1: Get user context
        const userContext = await getUserContext(userId);
        console.log(`[GoogleHotels] [execute] User context fetched.`);

        // Step 2: Parse query to get structured search parameters
        const searchParams = await parseSearchQuery(query, userContext);
        console.log(
          `[GoogleHotels] [execute] Parsed search parameters:`,
          searchParams,
        );

        // Step 3: Execute SerpAPI Google Hotels search
        const searchResults = await searchGoogleHotels(searchParams);
        console.log(
          `[GoogleHotels] [execute] Found ${searchResults.properties?.length || 0} properties`,
        );

        if (
          !searchResults.properties ||
          searchResults.properties.length === 0
        ) {
          console.log(
            `[GoogleHotels] [execute] No properties found for "${query}".`,
          );
          return `No hotels found for "${query}". Try adjusting your search criteria or dates.`;
        }

        // Step 4: Limit to top 40 properties (like n8n Limit node)
        const limitedProperties = searchResults.properties.slice(0, 40);

        // Step 5: Get details and summarize reviews for each property (like n8n)
        const detailedProperties = await Promise.all(
          limitedProperties.map(async (property: any) => {
            const details = await getPropertyDetails(property);
            const mergedProperty = { ...property, ...details };
            const reviewsSummary = await summarizeReviews(mergedProperty);
            return {
              ...mergedProperty,
              reviews_summary: reviewsSummary,
            };
          }),
        );

        // Step 6: Trim fields (like n8n Trim Fields node)
        const trimmedProperties = detailedProperties.map(trimFields);

        // Step 7: Format results (like n8n Review & Format node)
        const formattedResults = await formatHotelResults(
          trimmedProperties,
          searchResults,
          userContext,
          query,
        );

        console.log(`[GoogleHotels] [execute] Returning formatted results.`);
        return formattedResults;
      } catch (error) {
        console.error(
          '[GoogleHotels] [execute] Error during execution:',
          error,
        );
        return `Error searching hotels: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    },
  });
