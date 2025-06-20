import { createStreamableValue } from 'ai/rsc';
import { z } from 'zod';
import { tool } from 'ai';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db/queries';
import { userProfiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getJson } from 'serpapi';

// Use provided API keys directly
const GOOGLE_API_KEY = 'AIzaSyBEPIFuC3JvxEpMaCtQmqhIP8l38svfqMM';
const SERPAPI_API_KEY = '4c964694f77ae45f7e16a8cf0d202e54108a368e82ab5ce0566bc2b53d54e8fe';

const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

interface GoogleHotelsProps {
  userId: string;
}

// JSON Schema for structured output parsing (matching n8n workflow)
const searchQuerySchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  properties: {
    payload: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "Search query, required field"
        },
        check_in_date: {
          type: "string",
          format: "date",
          description: "Check-in date, required field"
        },
        check_out_date: {
          type: "string",
          format: "date",
          description: "Check-out date, required field"
        },
        vacation_rentals: {
          type: "boolean",
          description: "Indicates if vacation rentals are included. Should be omitted if searching for hotels or when the user does not explicitly ask for vacation rentals",
          default: null
        },
        adults: {
          type: "number",
          default: 2
        },
        children: {
          type: "number",
          default: 0
        }
      },
      required: ["q", "check_in_date", "check_out_date"],
      additionalProperties: false
    }
  },
  required: ["payload"],
  additionalProperties: false
};

async function getUserContext(userId: string): Promise<string | null> {
  const [userProfile] = await db
    .select({ context_hotels: userProfiles.context_hotels })
    .from(userProfiles)
    .where(eq(userProfiles.clerkId, userId));

  return userProfile?.context_hotels ?? null;
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
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash-preview-0514',
    });
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();
    const jsonString = text
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();
    
    // Try to parse the JSON and validate against schema
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (e) {
      // If direct parsing fails, try to extract JSON from the response
      const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not parse JSON from response');
      }
    }

    // Extract payload from the parsed response (matching n8n schema)
    const payload = parsed.payload || parsed;
    
    // Add fixed parameters from n8n workflow
    const searchParams: any = {
      q: payload.q.replace(/, /g, ' '),
      check_in_date: payload.check_in_date,
      check_out_date: payload.check_out_date,
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

    return searchParams;
  } catch (error) {
    console.error('Error parsing search query:', error);
    // Fallback to basic parsing
    return {
      q: query,
      check_in_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      check_out_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      adults: 1,
      children: 0,
      rating: '8',
      hotel_class: '3,4,5',
      property_types: '12,13,15,17,18,19,20,21,22,23,24'
    };
  }
}

async function searchGoogleHotels(searchParams: any): Promise<any> {
  return getJson('google_hotels', {
    ...searchParams,
    api_key: SERPAPI_API_KEY,
  });
}

async function getPropertyDetails(property: any): Promise<any> {
  if (!property.serpapi_property_details_link) {
    return property; // Return original property if no details link
  }
  try {
    console.log(
      `Fetching details for ${property.name} from ${property.serpapi_property_details_link}`,
    );
    const details = await getJson(
      property.serpapi_property_details_link.split('?')[0], // Use the base URL
      {
        api_key: SERPAPI_API_KEY,
        ...Object.fromEntries(
          new URL(property.serpapi_property_details_link).searchParams,
        ),
      },
    );
    return { ...property, ...details };
  } catch (error) {
    console.error(`Failed to fetch details for ${property.name}:`, error);
    return property; // Return original property on error
  }
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
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash-preview-0514',
    });
    const result = await model.generateContent(reviewContent);
    const summary = result.response.text();
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
    'message', 'index', 'logprobs', 'finish_reason', 'rate_per_night', 
    'total_rate', 'deal', 'deal_description', 'nearby_places', 'images', 
    'serpapi_property_details_link', 'search_metadata', 'search_parameters', 
    'reviews_breakdown', 'other_reviews', 'prices', 'featured_prices'
  ];
  
  excludeFields.forEach(field => {
    delete trimmed[field];
  });

  // Add computed fields (matching n8n workflow)
  trimmed.reviews_summary = property.reviews_summary || 'No review data available.';
  trimmed.rate_per_night_lowest_usd = property.rate_per_night?.extracted_lowest;
  trimmed.total_rate_lowest_usd = property.total_rate?.extracted_lowest;
  trimmed.link = property.link;
  trimmed.google_maps_link = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([property.name, property.address].join("+"))}`;

  // Clean up featured_prices (matching n8n workflow)
  if (property.featured_prices) {
    trimmed.featured_prices = property.featured_prices.map((f: any) => ({
      ...f,
      logo: undefined,
      remarks: undefined,
      rate_per_night: f.rate_per_night ? {
        ...f.rate_per_night,
        before_taxes_fees: undefined,
        extracted_before_taxes_fees: undefined
      } : undefined,
      total_rate: f.total_rate ? {
        ...f.total_rate,
        before_taxes_fees: undefined,
        extracted_before_taxes_fees: undefined
      } : undefined,
      rooms: (f.rooms || []).map((r: any) => ({
        ...r,
        images: undefined,
        rate_per_night: r.rate_per_night ? {
          ...r.rate_per_night,
          before_taxes_fees: undefined,
          extracted_before_taxes_fees: undefined
        } : undefined,
        total_rate: r.total_rate ? {
          ...r.total_rate,
          before_taxes_fees: undefined,
          extracted_before_taxes_fees: undefined
        } : undefined
      }))
    }));
  }

  // Clean up prices (matching n8n workflow)
  if (property.prices) {
    trimmed.prices = property.prices.map((item: any) => {
      const currentItem = { ...item };
      if (currentItem && typeof currentItem === 'object') {
        // Remove top-level fields
        delete currentItem.logo;
        delete currentItem.original_rate_per_night;

        // Remove nested field: total_rate.before_taxes_fees
        if (currentItem.total_rate && typeof currentItem.total_rate === 'object') {
          delete currentItem.total_rate.before_taxes_fees;
        }
        
        // Remove nested field: rate_per_night.before_taxes_fees
        if (currentItem.rate_per_night && typeof currentItem.rate_per_night === 'object') {
          delete currentItem.rate_per_night.before_taxes_fees;
        }

        // Remove nested field: total_rate.extracted_before_taxes_fees
        if (currentItem.total_rate && typeof currentItem.total_rate === 'object') {
          delete currentItem.total_rate.extracted_before_taxes_fees;
        }

        // Remove nested field: rate_per_night.extracted_before_taxes_fees
        if (currentItem.rate_per_night && typeof currentItem.rate_per_night === 'object') {
          delete currentItem.rate_per_night.extracted_before_taxes_fees;
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
  const formattingPrompt = `<instructions>
Please organize the following accommodation options in a proper markdown output. 

- Include all the relevant details like property names, amenities, costs, data points from reviews, etc into a markdown-fromatted output.
- Output markdown following the example provided. 
- Ensure to include the full booking URLs and NEVER truncate them. You only need to include 1-2 booking options per property--not all.
- Make sure to take into account the client's accommodation preferences when ordering the hotels, which are given below.
- You may omit options from the output if they do not fit the client's preferences. You do not have to output every single one.
- You can and should re-arrange the order based on what you believe the client would select themselves for this particular trip.
- Where there is a conflict between <Client_Context> and the <Current_Client_Accommodation_Search_Query>, the <Current_Client_Accommodation_Search_Query> should always win. This goes for inclusion/exclusion of results, sort order, etc.
</instructions>

<accommodation_options (${properties.length}_options)>
${properties.map((OptionItem, index) => {
  function flatten(obj: any, prefix = '') {
    return Object.entries(obj).reduce((acc: any, [k, v]) => {
      const pre = prefix.length ? prefix + '.' : ''; 
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        Object.assign(acc, flatten(v, pre + k));
      } else {
        acc[pre + k] = v;
      }
      return acc;
    }, {});
  }

  const flattenedOption = flatten(OptionItem); 

  const formattedProperties = Object.entries(flattenedOption)
    .map(([k, v]) => `\n\t${k}: ${v}`)
    .join('');

  return `- ## Option ${index + 1} of ${properties.length}${formattedProperties}`;
}).join('\n\n')}
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

See more options or change the search details on **[🏨 Google Hotels](${searchResults.search_metadata?.google_hotels_url || searchResults.search_metadata?.prettify_html_file})**.
</example_markdown_output>`;

  try {
    const formattingModel = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp', // Using the same model as n8n workflow
    });
    const result = await formattingModel.generateContent(formattingPrompt);
    const response = result.response;
    const formattedText = result.response.text();
    
    // Add the final response structure (matching n8n workflow)
    const finalResponse = `# Accommodation Options
${formattedText.split('\n').filter(item => item.slice(0,3) !== '```').join('\n')}

## Accommodation Preferences
${context || 'No context provided.'}

## Current Accommodation Query
${query}

## Google Hotels Search Results Page
${searchResults.search_metadata?.prettify_html_file || searchResults.search_metadata?.google_hotels_url || 'Search results not available'}`;

    return finalResponse;
  } catch (error) {
    console.error('Error formatting results:', error);
    // Fallback to basic formatting
    return `# Accommodation Options

${properties.map(p => `## ${p.name}
* 🌐 [Website](${p.link})
* 📍[${p.address}](${p.google_maps_link})
* 💬 ${p.reviews_summary}
* ⭐ ${p.overall_rating} - ${p.rating_word} (${p.reviews} reviews)
${p.prices?.slice(0, 2).map((price: any) => `* [${price.source}](${price.link}) - ${price.rate_per_night?.extracted_lowest ? `$${price.rate_per_night.extracted_lowest}/night` : 'Price not available'}`).join('\n') || 'No pricing found.'}`).join('\n\n')}

## Accommodation Preferences
${context || 'No context provided.'}

## Current Accommodation Query
${query}

## Google Hotels Search Results Page
${searchResults.search_metadata?.prettify_html_file || searchResults.search_metadata?.google_hotels_url || 'Search results not available'}`;
  }
}

export const googleHotels = ({ userId }: { userId: string }) =>
  tool({
    description:
      'Search for hotels and vacation rentals using Google Hotels via SerpAPI. This tool helps find accommodations with detailed information including prices, reviews, amenities, and availability.',
    parameters: z.object({
      query: z
        .string()
        .describe(
          'The search query for hotels or vacation rentals, including location and any specific requirements',
        ),
    }),
    execute: async ({ query }: { query: string }) => {
      const stream = createStreamableValue();

      (async () => {
        try {
          stream.update('Fetching user preferences...');
          const context = await getUserContext(userId);

          stream.update('Parsing your request...');
          const searchParams = await parseSearchQuery(query, context);

          stream.update('Searching for hotels...');
          const hotelsResponse = await searchGoogleHotels(searchParams);

          if (
            !hotelsResponse.properties ||
            hotelsResponse.properties.length === 0
          ) {
            stream.done({
              result:
                'No hotels found matching your search criteria. Please try adjusting your search parameters.',
            });
            return;
          }

          // Limit to 40 properties (matching n8n workflow)
          const limitedProperties = hotelsResponse.properties?.slice(0, 40) || [];

          stream.update('Fetching detailed information for top results...');
          const detailedProperties = await Promise.all(
            limitedProperties.map(getPropertyDetails),
          );

          stream.update('Summarizing reviews...');
          const summarizedProperties = await Promise.all(
            detailedProperties.map(summarizeReviews),
          );

          stream.update('Processing and formatting results...');
          // Apply field trimming (matching n8n workflow)
          const trimmedProperties = summarizedProperties.map(trimFields);

          const finalResult = await formatHotelResults(
            trimmedProperties,
            hotelsResponse,
            context,
            query,
          );

          stream.done({ result: finalResult });
        } catch (error) {
          console.error('Error in Google Hotels tool:', error);
          stream.done({
            result:
              'I encountered an error while searching for hotels. Please try again later.',
          });
        }
      })();

      return stream.value;
    },
  });
