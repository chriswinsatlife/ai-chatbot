import { z } from 'zod';
import { tool, generateText, generateObject } from 'ai';
import { db } from '@/lib/db/queries';
import * as schema from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { openai } from '@ai-sdk/openai';

console.log('[GoogleHotels] Tool file loaded.');

interface GoogleHotelsProps {
  userId: string;
}

// Zod schema for structured output parsing, matching the n8n workflow's fields.
// The `payload` wrapper is removed as it's not needed for our implementation.
const searchQuerySchema = z.object({
  q: z.string().describe('Search query, required field'),
  check_in_date: z
    .string()
    .describe('Check-in date in YYYY-MM-DD format, required field'),
  check_out_date: z
    .string()
    .describe('Check-out date in YYYY-MM-DD format, required field'),
  vacation_rentals: z
    .boolean()
    .describe(
      'Set to true for vacation rentals, false for hotels. This is a required field.',
    ),
  adults: z.number().optional().default(1).describe('Number of adults'),
  children: z.number().optional().default(0).describe('Number of children'),
});

async function getUserContext(userId: string): Promise<string | null> {
  try {
    console.log(`[GoogleHotels] Fetching context for userId: ${userId}`);
    const [userProfile] = await db
      .select({ context_hotels: schema.userProfiles.context_hotels })
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.id, userId));

    console.log(
      `[GoogleHotels] User profile found:`,
      userProfile ? 'Yes' : 'No',
    );
    console.log(
      `[GoogleHotels] Context hotels:`,
      userProfile?.context_hotels || 'None',
    );

    return userProfile?.context_hotels ?? null;
  } catch (error) {
    console.error(`[GoogleHotels] Error fetching user context:`, error);
    return null;
  }
}

async function parseSearchQuery(
  query: string,
  context: string | null,
): Promise<z.infer<typeof searchQuerySchema>> {
  const currentDate = new Date().toString();
  // This prompt is copied EXACTLY from the working n8n workflow.
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
${currentDate}
</Current_DateTime>

<Client_Context>
${context || 'No context provided.'}
</Client_Context>

<User_Query>
${query}
</User_Query>`;

  console.log(
    `[GoogleHotels] Parsing search query with gpt-4-turbo and exact n8n prompt.`,
  );

  const { object: parsedResult } = await generateObject({
    model: openai('gpt-4-turbo'),
    schema: searchQuerySchema,
    prompt,
  });

  console.log('[GoogleHotels] AI produced object:', parsedResult);
  return parsedResult;
}

async function searchGoogleHotels(
  searchParams: z.infer<typeof searchQuerySchema>,
) {
  if (!process.env.SERPAPI_API_KEY) {
    throw new Error('SERPAPI_API_KEY is not set');
  }

  console.log(
    '[GoogleHotels] Constructing search from parameters:',
    searchParams,
  );

  // This logic is copied EXACTLY from the n8n workflow's HTTP Request node.
  const finalParams: { [key: string]: any } = {
    engine: 'google_hotels',
    api_key: process.env.SERPAPI_API_KEY,
    q: searchParams.q.replace(/, /g, ' '),
    check_in_date: searchParams.check_in_date,
    check_out_date: searchParams.check_out_date,
    adults: searchParams.adults,
    children: searchParams.children,
    rating: '8', // Hardcoded as per the n8n workflow
  };

  // This is the CRITICAL conditional logic from the n8n workflow.
  if (searchParams.vacation_rentals) {
    console.log('[GoogleHotels] Search Type: Vacation Rentals');
    finalParams.vacation_rentals = true;
    finalParams.property_types = '1,2,3,4,5,6,7,8,10,11,21'; // VR property types
  } else {
    console.log('[GoogleHotels] Search Type: Hotels');
    finalParams.hotel_class = '3,4,5'; // Hotel classes
    finalParams.property_types = '12,13,15,17,18,19,20,21,22,23,24'; // Hotel property types
  }

  // Remove undefined values so they aren't included in the URL
  Object.keys(finalParams).forEach(
    (key) =>
      (finalParams[key] === undefined || finalParams[key] === null) &&
      delete finalParams[key],
  );

  const url = new URL('https://serpapi.com/search.json');
  url.search = new URLSearchParams(finalParams).toString();

  console.log(`[GoogleHotels] Making DIRECT HTTP request to SerpAPI: ${url}`);

  const response = await fetch(url.toString());
  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      `[GoogleHotels] SerpAPI request failed with status ${response.status}:`,
      errorBody,
    );
    throw new Error(
      `SerpAPI request failed with status ${response.status}: ${response.statusText}`,
    );
  }
  const result = await response.json();

  console.log(
    `[GoogleHotels] SerpAPI direct response metadata:`,
    JSON.stringify(result.search_metadata, null, 2),
  );
  console.log(
    `[GoogleHotels] SerpAPI direct response search parameters:`,
    JSON.stringify(result.search_parameters, null, 2),
  );

  if (result.error) {
    console.error('[GoogleHotels] SerpAPI returned an error:', result.error);
    throw new Error(result.error);
  }

  return result;
}

async function getPropertyDetails(property: any): Promise<any> {
  const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY;
  if (!SERPAPI_API_KEY) {
    throw new Error('FATAL: SERPAPI_API_KEY environment variable is not set.');
  }
  // SerpAPI call #2: Get property details using serpapi_property_details_link (matching n8n workflow exactly)
  if (property.serpapi_property_details_link) {
    try {
      console.log(
        `[GoogleHotels] Getting details for ${property.name} using serpapi_property_details_link`,
      );

      // Make direct HTTP request to the SerpAPI details link with API key
      const detailsUrl = `${property.serpapi_property_details_link}&api_key=${SERPAPI_API_KEY}`;

      console.log(
        `[GoogleHotels] Making DIRECT property details request to: ${detailsUrl.replace(
          SERPAPI_API_KEY,
          '***REDACTED***',
        )}`,
      );

      const response = await fetch(detailsUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const detailsResult = await response.json();
      if (detailsResult.error) {
        console.error(
          '[GoogleHotels] SerpAPI property details returned an error:',
          detailsResult.error,
        );
        return null; // Don't throw, just skip this property
      }

      console.log(
        `[GoogleHotels] Successfully fetched details for ${property.name}`,
      );
      // Per n8n workflow, nest details under a 'details' key
      return {
        ...property,
        details: detailsResult,
      };
    } catch (error) {
      console.error(
        `[GoogleHotels] Failed to get details for ${property.name}:`,
        error,
      );
      return null; // Return null if details fetch fails, to not break the entire flow
    }
  }
  return property;
}

async function summarizeReviews(property: any): Promise<any> {
  if (!property.reviews_breakdown && !property.other_reviews) {
    return { ...property, reviews_summary: 'No review data available.' };
  }

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

  try {
    const { text: summary } = await generateText({
      model: openai('gpt-4o-mini'),
      prompt: reviewContent,
    });
    return { ...property, reviews_summary: summary };
  } catch (error) {
    console.error(`Failed to summarize reviews for ${property.name}:`, error);
    return { ...property, reviews_summary: 'Could not summarize reviews.' };
  }
}

// Function to trim fields (matching n8n workflow)
function trimFields(property: any): any {
  const trimmed = { ...property };

  // Remove fields that should be excluded (matching n8n workflow)
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
    'prices',
    'featured_prices',
  ];

  excludeFields.forEach((field) => {
    delete trimmed[field];
  });

  // Add computed fields (matching n8n workflow)
  trimmed.reviews_summary =
    property.reviews_summary || 'No review data available.';
  trimmed.rate_per_night_lowest_usd = property.rate_per_night?.extracted_lowest;
  trimmed.total_rate_lowest_usd = property.total_rate?.extracted_lowest;
  trimmed.link = property.link;
  trimmed.google_maps_link = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([property.name, property.address].join('+'))}`;

  // Clean up featured_prices (matching n8n workflow)
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

  // Clean up prices (matching n8n workflow)
  if (property.prices) {
    trimmed.prices = property.prices.map((item: any) => {
      const currentItem = { ...item };
      if (currentItem && typeof currentItem === 'object') {
        // Remove top-level fields
        currentItem.logo = undefined;
        currentItem.original_rate_per_night = undefined;

        // Remove nested field: total_rate.before_taxes_fees
        if (
          currentItem.total_rate &&
          typeof currentItem.total_rate === 'object'
        ) {
          currentItem.total_rate.before_taxes_fees = undefined;
        }

        // Remove nested field: rate_per_night.before_taxes_fees
        if (
          currentItem.rate_per_night &&
          typeof currentItem.rate_per_night === 'object'
        ) {
          currentItem.rate_per_night.before_taxes_fees = undefined;
        }

        // Remove nested field: total_rate.extracted_before_taxes_fees
        if (
          currentItem.total_rate &&
          typeof currentItem.total_rate === 'object'
        ) {
          currentItem.total_rate.extracted_before_taxes_fees = undefined;
        }

        // Remove nested field: rate_per_night.extracted_before_taxes_fees
        if (
          currentItem.rate_per_night &&
          typeof currentItem.rate_per_night === 'object'
        ) {
          currentItem.rate_per_night.extracted_before_taxes_fees = undefined;
        }
      }
      return currentItem;
    });
  }

  return trimmed;
}

async function formatHotelResults(
  properties: any[],
  searchResults: any,
  context: string | null,
  query: string,
): Promise<string> {
  console.log(
    `[GoogleHotels] Formatting ${properties.length} properties with context: ${context ? 'Available' : 'None'}`,
  );

  // Flatten each property's data exactly like the n8n workflow does
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

  // Create the accommodation options data structure exactly like n8n
  const accommodationOptions = properties
    .map((property, index) => {
      const flattenedOption = flatten(property);
      const formattedProperties = Object.entries(flattenedOption)
        .map(([k, v]) => `\n\t${k}: ${v}`)
        .join('');
      return `- ## Option ${index + 1} of ${properties.length}${formattedProperties}`;
    })
    .join('\n\n');

  // Use the exact prompt from the n8n workflow
  const formattingPrompt = `<instructions>
Please organize the following accommodation options in a proper markdown output. 

- Include all the relevant details like property names, amenities, costs, data points from reviews, etc into a markdown-formatted output.
- Output markdown following the example provided. 
- Ensure to include the full booking URLs and NEVER truncate them. You only need to include 1-2 booking options per property--not all.
- Make sure to take into account the client's accommodation preferences when ordering the hotels, which are given below.
- You may omit options from the output if they do not fit the client's preferences. You do not have to output every single one.
- You can and should re-arrange the order based on what you believe the client would select themselves for this particular trip.
- Where there is a conflict between <Client_Context> and the <Current_Client_Accommodation_Search_Query>, the <Current_Client_Accommodation_Search_Query> should always win. This goes for inclusion/exclusion of results, sort order, etc.
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
* 🏨 Key Amenities Summary
* 💬 Reviews Summary
* ⭐ 9.2 - Exceptional (74 reviews) 
* [Booking.com](https://www.booking.com/full_link) - $1,826
        * Pay online, non-refundable
* [Agoda](https://www.agoda.com/aviator-bali/hotel/full_link) - $2,735
        * Pay at check-in, free cancellation until 11:59PM on July 13, 2025
* [Website](https://hotels.cloudbeds.com/en/reservation/full_link) - $1,627.81
        * Pay online, non-refundable

See more options or change the search details on **[🏨 Google Hotels](${searchResults.search_metadata?.prettify_html_file || searchResults.search_metadata?.google_hotels_url || 'https://www.google.com/travel/hotels'})**.
</example_markdown_output>`;

  try {
    console.log(
      `[GoogleHotels] Starting AI formatting with ${properties.length} properties`,
    );
    console.log(
      `[GoogleHotels] Accommodation options data length: ${accommodationOptions.length} characters`,
    );

    // Use Gemini 2.5 Flash like the n8n workflow
    const { text: formattedText } = await generateText({
      model: openai('gpt-4o'), // Using GPT-4.1 since Gemini was causing issues
      prompt: formattingPrompt,
    });

    console.log(
      `[GoogleHotels] AI formatting completed successfully. Result length: ${formattedText.length} characters`,
    );

    // Create the final response exactly like the n8n workflow Response node
    const googleHotelsUrl =
      searchResults.search_metadata?.prettify_html_file ||
      searchResults.search_metadata?.google_hotels_url ||
      'https://www.google.com/travel/hotels';

    const finalResponse = `# Accommodation Options
${formattedText
  .split('\n')
  .filter((item) => item.slice(0, 3) !== '```')
  .join('\n')}

## Accommodation Preferences
${context || 'No context provided.'}

## Current Accommodation Query
${query}

## Google Hotels Search Results Page
${googleHotelsUrl}`;

    return finalResponse;
  } catch (error) {
    console.error('[GoogleHotels] Error formatting results with AI:', error);
    console.error(
      '[GoogleHotels] Falling back to simple formatting. This means NO booking links or real data will be shown.',
    );
    // Fallback to simple formatting if AI fails
    const simpleFormat = properties
      .map(
        (p, i) => `## ${i + 1}. ${p.name}
* 📍 ${p.address}
* ⭐ ${p.overall_rating} - ${p.rating_word} (${p.reviews} reviews)
* 🌐 [View Details](${p.link})`,
      )
      .join('\n\n');

    return `# Accommodation Options

${simpleFormat}

## Accommodation Preferences
${context || 'No context provided.'}

## Current Accommodation Query
${query}

## Google Hotels Search Results Page
${searchResults.search_metadata?.prettify_html_file || searchResults.search_metadata?.google_hotels_url || 'https://www.google.com/travel/hotels'}`;
  }
}

export const googleHotels = ({ userId }: GoogleHotelsProps) =>
  tool({
    description: `The Google Hotels tool is used to search for hotels and vacation rentals. This tool contains information about the user's accommodation preferences, so you generally do not need to ask the user about their preferences like hotel vs Airbnb, preferred brands, desired amenities, pricing, etc. You will need only the trip-specific information like the date of the trip, destination, required amenities, etc. Simply call the tool with a detailed query on their itinerary. Note the tool will only output links to book hotels and vacation rentals, and accommodation cannot be booked directly by the AI. YOU CANNOT BOOK ACCOMMODATIONS. DO NOT CLAIM YOU CAN BOOK ACCOMMODATIONS ON THE USER'S BEHALF.

This tool will return the user's preferences and best available accommodation options in markdown, which you can use in your subsequent message to them. Aim to output 4-12 options.

CRITICAL: The user CANNOT see the results of the tool--only you can. You must put information from the tool's output in your message to the user if you want them to see it. You must ALWAYS output the accommodation links with your accommodation options, and truncate these links.

Sometimes the tool will return extremely long links, in which case you must shorten them when you output these to the user (e.g. [M4YA Hotel Canggu](https://hotels.google.com/tons-of-parameters-and-hundreds-of-characters). Always output the Google Hotels search link at the end of your recommended accommodations, so the user can continue the search on the website or view the full results.`,

    parameters: z.object({
      query: z
        .string()
        .describe(
          'The user\'s hotel search request (e.g., "luxury hotel in Paris next month", "beachfront villa in Bali for 4 people")',
        ),
    }),

    execute: async ({ query }) => {
      try {
        console.log(
          `[GoogleHotels] Executing search for userId: ${userId}, query: "${query}"`,
        );

        // Step 1: Get user's hotel context for personalization
        const userProfile = await db.query.userProfiles.findFirst({
          columns: {
            id: true,
            full_name: true,
            context_hotels: true,
          },
          where: eq(schema.userProfiles.id, userId),
        });

        if (!userProfile) {
          console.error(
            `[GoogleHotels] User profile not found for userId: ${userId}`,
          );
          return { error: 'User profile not found' };
        }

        const userContext =
          userProfile.context_hotels || 'No hotel preferences available.';
        console.log(
          `[GoogleHotels] Found user profile for: ${userProfile.full_name || 'Unknown'}`,
        );

        // Step 2: Parse user query into structured search parameters (exact n8n logic)
        const userContextForPrompt = `The user's name is ${
          userProfile.full_name
        }. Their email is null. Other details: ${JSON.stringify(
          userProfile.context_hotels,
        )}`;

        const searchParams = await parseSearchQuery(
          query,
          userContextForPrompt,
        );

        console.log('[GoogleHotels] Parsed search parameters:', searchParams);

        // Step 3: Execute SerpAPI Google Hotels search
        const searchResults = await searchGoogleHotels(searchParams);
        console.log(
          `[GoogleHotels] Found ${searchResults.properties?.length || 0} properties`,
        );

        if (
          !searchResults.properties ||
          searchResults.properties.length === 0
        ) {
          return {
            response: `No hotels found for "${query}". Try adjusting your search criteria or dates.`,
            searchParams,
          };
        }

        // Step 4: Split Out, Limit, Get Details, Summarize Reviews, Merge, Trim, Aggregate (following n8n workflow)
        const limitedProperties = searchResults.properties.slice(0, 10); // Limit step

        // Get property details and summarize reviews for each property
        const processedProperties = await Promise.all(
          limitedProperties.map(async (property: any) => {
            // SerpAPI call #2: Get property details
            const detailedProperty = await getPropertyDetails(property);
            // LLM call #2: Summarize reviews
            const reviewSummarizedProperty =
              await summarizeReviews(detailedProperty);
            // Trim fields
            return trimFields(reviewSummarizedProperty);
          }),
        );

        // Step 5: Format results (LLM call #3)
        const formattedResults = await formatHotelResults(
          processedProperties,
          searchResults,
          userContext,
          query,
        );

        console.log(
          `[GoogleHotels] Returning formatted results (estimated ${Math.floor(formattedResults.length / 4)} tokens)`,
        );

        return {
          response: formattedResults,
          searchParams,
          resultsCount: searchResults.properties.length,
        };
      } catch (error) {
        console.error('[GoogleHotels] Error during execution:', error);
        return {
          error: 'Failed to search hotels',
          details: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  });
