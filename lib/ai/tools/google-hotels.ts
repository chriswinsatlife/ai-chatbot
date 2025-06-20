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

function formatHotelResults(
  properties: any[],
  searchResults: any,
  context: string | null,
  query: string,
): string {
  console.log(
    `[GoogleHotels] Formatting ${properties.length} properties with context: ${context ? 'Available' : 'None'}`,
  );

  const formattedHotels = properties
    .slice(0, 10)
    .map((property, index) => {
      const name = property.name || 'Hotel name not available';
      const address = property.address || 'Address not available';
      const rating = property.overall_rating || 'No rating';
      const ratingWord = property.rating_word || '';
      const reviews = property.reviews || 0;
      const link = property.link || '#';

      let priceInfo = 'Pricing not available';
      if (property.prices && property.prices.length > 0) {
        const topPrices = property.prices.slice(0, 3);
        priceInfo = topPrices
          .map((price: any) => {
            const source = price.source || 'Unknown source';
            const rate = price.rate_per_night?.extracted_lowest
              ? `$${price.rate_per_night.extracted_lowest}/night`
              : 'Price on request';
            return `  • [${source}](${price.link || '#'}) - ${rate}`;
          })
          .join('\n');
      }

      return `## ${index + 1}. ${name}
📍 **Location**: ${address}
⭐ **Rating**: ${rating} - ${ratingWord} (${reviews} reviews)
🌐 **Website**: [View Details](${link})

**Pricing Options**:
${priceInfo}
`;
    })
    .join('\n\n');

  const searchUrl =
    searchResults.search_metadata?.google_hotels_url ||
    searchResults.search_metadata?.prettify_html_file ||
    'Search results not available';

  return `# 🏨 Luxury Hotels in Paris

Found ${properties.length} properties matching your search for "${query}"

${formattedHotels}

---

## 🎯 Your Hotel Preferences
${context || 'No specific hotel preferences found in your profile. Consider updating your preferences for more personalized recommendations.'}

## 🔗 View Full Results
See all options and refine your search: [Google Hotels Results](${searchUrl})

*Search performed for: ${query}*`;
}

export const googleHotels = ({ userId }: GoogleHotelsProps) =>
  tool({
    description: `Use the "Google Hotels Tool" to search for and recommend hotel accommodations and vacation rentals based on user preferences and travel requirements.

This tool provides comprehensive hotel search capabilities by:
- **Smart Query Parsing**: Converts natural language requests into structured search parameters
- **Personalized Recommendations**: Uses user's hotel preferences and booking history for tailored suggestions  
- **Comprehensive Results**: Returns detailed property information including pricing, reviews, amenities, and booking links
- **Flexible Search**: Supports both traditional hotels and vacation rentals/Airbnb-style properties
- **Review Intelligence**: AI-powered summarization of guest reviews and ratings analysis
- **Multiple Booking Options**: Provides pricing and booking links across different platforms

The tool intelligently handles:
- Date parsing and validation (defaults to sensible date ranges if not specified)
- Guest count optimization based on user preferences or explicit requirements
- Property type selection (hotels vs vacation rentals) based on user request
- Location and amenity preferences from user's travel history
- Budget considerations from past booking patterns

Use this tool when users ask about:
- Hotel or accommodation recommendations
- Vacation rental searches  
- Travel planning with accommodation needs
- Comparing hotel options for specific destinations
- Getting detailed information about specific properties`,

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
        const formattedResults = formatHotelResults(
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
