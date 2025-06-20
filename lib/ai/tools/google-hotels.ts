import { createStreamableValue } from 'ai/rsc';
import { z } from 'zod';
import { tool, generateText } from 'ai';
import { db } from '@/lib/db/queries';
import * as schema from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getJson } from 'serpapi';
import { openai } from '@ai-sdk/openai';

// SerpAPI configuration
const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY;

if (!SERPAPI_API_KEY) {
  throw new Error('SERPAPI_API_KEY environment variable is required');
}

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
): Promise<any> {
  const prompt = `Based on the user query, please output the search JSON. Leave a value null or blank if it is unclear.

- If the user specifies vacation rentals or Airbnb-type listings, set "vacation_rentals" to true, otherwise assume hotels and set it to false.
- Do not use commas or special characters in the query string.
- Check in and check out date is *required* (default to check in date as 1 week from today if not provided in the query).
- Assume the client is traveling alone as one adult unless otherwise specified in the context or query.
- The <Client_Context> is general historic information and should be used when details are not specified in the <User_Query>.
- The <User_Query> overrides on any conflict, since it is a current request from the user.
- The <Current_DateTime> should be used for interpreting queries like "next month" or "next week".
- The "q" is a query that would be entered into a search box on hotels.google.com.
- Output JSON according to the schema.

<Current_DateTime>
${new Date().toISOString()}
</Current_DateTime>

<Client_Context>
${context || 'No context provided.'}
</Client_Context>

<User_Query>
${query}
</User_Query>`;

  try {
    const { text } = await generateText({
      model: openai('gpt-4.1'),
      prompt: prompt,
    });
    const jsonString = text
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();

    // Try to parse the JSON and validate against schema
    let parsed: { payload?: any } | null = null;
    try {
      parsed = JSON.parse(jsonString);
    } catch (parseError) {
      // If direct parsing fails, try to extract JSON from the response
      const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not parse JSON from response');
      }
    }

    // Extract payload from the parsed response (matching n8n schema)
    const payload = parsed?.payload || parsed;

    // Add fixed parameters from n8n workflow
    // Ensure dates are always provided with fallbacks
    const checkInDate =
      payload.check_in_date ||
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];
    const checkOutDate =
      payload.check_out_date ||
      new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

    const searchParams: any = {
      q: payload.q.replace(/, /g, ' '),
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
      adults: payload.adults || 1,
      children: payload.children || 0,
      rating: '8', // from n8n
    };

    if (payload.vacation_rentals) {
      searchParams.vacation_rentals = true;
      searchParams.property_types = '1,2,3,4,5,6,7,8,10,11,21'; // from n8n
    } else {
      searchParams.hotel_class = '3,4,5'; // from n8n
      searchParams.property_types = '12,13,15,17,18,19,20,21,22,23,24'; // from n8n
    }

    console.log(`[GoogleHotels] Parsed search params:`, searchParams);
    return searchParams;
  } catch (error) {
    console.error('Error parsing search query:', error);
    // Fallback to basic parsing
    const fallbackParams = {
      q: query,
      check_in_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0],
      check_out_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0],
      adults: 1,
      children: 0,
      rating: '8',
      hotel_class: '3,4,5',
      property_types: '12,13,15,17,18,19,20,21,22,23,24',
    };
    console.log(`[GoogleHotels] Using fallback params:`, fallbackParams);
    return fallbackParams;
  }
}

async function searchGoogleHotels(searchParams: any): Promise<any> {
  return getJson('google_hotels', {
    ...searchParams,
    api_key: SERPAPI_API_KEY,
  });
}

async function getPropertyDetails(property: any): Promise<any> {
  // Skip property details fetching to avoid SerpAPI errors
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
      model: openai('gpt-4.1'),
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
    // Use Gemini 2.5 Flash like the n8n workflow
    const { text: formattedText } = await generateText({
      model: openai('gpt-4.1'), // Using GPT-4.1 since Gemini was causing issues
      prompt: formattingPrompt,
    });

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
    console.error('Error formatting results with AI:', error);
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
        const searchParams = await parseSearchQuery(query, userContext);
        console.log(`[GoogleHotels] Parsed search parameters:`, searchParams);

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

        // Step 4: Process and format results (following n8n workflow)
        const formattedResults = await formatHotelResults(
          searchResults.properties.slice(0, 10), // Limit to top 10 like n8n
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
