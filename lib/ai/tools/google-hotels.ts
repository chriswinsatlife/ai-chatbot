import { createStreamableValue } from 'ai/rsc';
import { z } from 'zod';
import { tool } from 'ai';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db/queries';
import { userProfiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getJson } from 'serpapi';

if (!process.env.GOOGLE_API_KEY) {
  throw new Error('Missing GOOGLE_API_KEY environment variable');
}
if (!process.env.SERPAPI_API_KEY) {
  throw new Error('Missing SERPAPI_API_KEY environment variable');
}

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

interface GoogleHotelsProps {
  userId: string;
}

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
- Output JSON according to this schema:
{
  "q": "string - search query",
  "check_in_date": "YYYY-MM-DD",
  "check_out_date": "YYYY-MM-DD",
  "vacation_rentals": boolean or null,
  "adults": number (default 1),
  "children": number (default 0)
}

<Current_DateTime>
${new Date().toISOString()}
</Current_DateTime>

<Client_Context>
${context || 'No context provided.'}
</Client_Context>

<User_Query>
${query}
</User_Query>
`;
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
  const parsed = JSON.parse(jsonString);

  // Add fixed parameters from n8n workflow
  const searchParams: any = {
    q: parsed.q.replace(/, /g, ' '),
    check_in_date: parsed.check_in_date,
    check_out_date: parsed.check_out_date,
    adults: parsed.adults || 1,
    children: parsed.children,
    rating: '8', // from n8n
  };

  if (parsed.vacation_rentals) {
    searchParams.vacation_rentals = true;
    searchParams.property_types = '1,2,3,4,5,6,7,8,10,11,21'; // from n8n
  } else {
    searchParams.hotel_class = '3,4,5'; // from n8n
    searchParams.property_types = '12,13,15,17,18,19,20,21,22,23,24'; // from n8n
  }

  return searchParams;
}

async function searchGoogleHotels(searchParams: any): Promise<any> {
  return getJson('google_hotels', {
    ...searchParams,
    api_key: process.env.SERPAPI_API_KEY,
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
        api_key: process.env.SERPAPI_API_KEY,
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

  const reviewContent = `
    Let's summarize the reviews about this hotel or vacation rental. Be as concise as possible. Just capture the key details, red flags, and positive points. You do not need to speak in complete sentences.

    ## Property Name:
    ${property.name}

    ## Reviews & Ratings:
    ### Review Count: ${property.reviews}
    ### Overall Rating: ${property.overall_rating} / 5

    ## Review Breakdown:
    ${
      property.reviews_breakdown
        ?.map(
          (item: any) =>
            `- ${item.description}: Mentions: ${item.total_mentioned}, Positive: ${item.positive}, Negative: ${item.negative}, Neutral: ${item.neutral}`,
        )
        .join('\n') || 'Not available.'
    }

    ## Other Reviews:
    ${
      property.other_reviews
        ?.slice(0, 10)
        .map(
          (item: any) =>
            `- ${item.user_review.comment} (Score: ${item.user_review.rating.score}/${item.user_review.rating.max_score})`,
        )
        .join('\n') || 'Not available.'
    }
    `;

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

async function formatHotelResults(
  properties: any[],
  searchResults: any,
  context: string | null,
  query: string,
): Promise<string> {
  const formattingPrompt = `
<instructions>
Please organize the following accommodation options in a proper markdown output. 

- Include all the relevant details like property names, amenities, costs, data points from reviews, etc into a markdown-fromatted output.
- Output markdown following the example provided. 
- Ensure to include the full booking URLs and NEVER truncate them. You only need to include 1-2 booking options per property--not all.
- Make sure to take into account the client's accommodation preferences when ordering the hotels, which are given below.
- You may omit options from the output if they do not fit the client's preferences. You do not have to output every single one.
- You can and should re-arrange the order based on what you believe the client would select themselves for this particular trip.
- Where there is a conflict between <Client_Context> and the <Current_Client_Accommodation_Search_Query>, the <Current_Client_Accommodation_Search_Query> should always win. This goes for inclusion/exclusion of results, sort order, etc.
</instructions>

<accommodation_options>
${JSON.stringify(properties, null, 2)}
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

See more options or change the search details on **[🏨 Google Hotels](${
    searchResults.search_metadata.google_hotels_url
  })**.
</example_markdown_output>`;

  const propertiesMarkdown = properties
    .map(
      (p) =>
        `## ${p.name}\n* 🌐 [Website](${p.link})\n* 📍[${
          p.address
        }](https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          `${p.name} ${p.address}`,
        )})\n* 🏨 ${
          p.amenities_extracted?.join(', ') || 'Amenities not listed'
        }\n* 💬 ${p.reviews_summary}\n* ⭐ ${p.overall_rating} - ${
          p.rating_word
        } (${p.reviews} reviews)\n${
          p.prices
            ?.slice(0, 3)
            .map(
              (price: any) =>
                `* [${price.source}](${price.link}) - ${
                  price.rate_per_night?.extracted_lowest
                    ? `$${price.rate_per_night.extracted_lowest}/night`
                    : 'Price not available'
                }`,
            )
            .join('\n') || 'No pricing found.'
        }`,
    )
    .join('\n\n');

  const fullPrompt = `${formattingPrompt}\n\n<properties_markdown>\n${propertiesMarkdown}\n</properties_markdown>`;

  const formattingModel = genAI.getGenerativeModel({
    model: 'gemini-1.5-pro-preview-0514',
  });
  const result = await formattingModel.generateContent(fullPrompt);
  const response = result.response;
  return response.text();
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

          const topProperties = hotelsResponse.properties?.slice(0, 10) || [];

          if (topProperties.length === 0) {
            stream.done({
              result:
                'No hotels found matching your search criteria. Please try adjusting your search parameters.',
            });
            return;
          }

          stream.update('Fetching detailed information for top results...');
          const detailedProperties = await Promise.all(
            topProperties.map(getPropertyDetails),
          );

          stream.update('Summarizing reviews...');
          const summarizedProperties = await Promise.all(
            detailedProperties.map(summarizeReviews),
          );

          stream.update('Formatting results...');
          const finalResult = await formatHotelResults(
            summarizedProperties,
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
