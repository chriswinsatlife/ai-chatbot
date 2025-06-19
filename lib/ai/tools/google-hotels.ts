import { tool } from 'ai';
import { z } from 'zod';
import postgres from 'postgres';

interface GoogleHotelsProps {
  userId: string;
  dataStream: any;
  chatId: string;
}

export const googleHotels = ({
  userId,
  dataStream,
  chatId,
}: GoogleHotelsProps) =>
  tool({
    description: 'Search for hotels and vacation rentals using Google Hotels via SerpAPI. This tool helps find accommodations with detailed information including prices, reviews, amenities, and availability. Automatically uses the user\'s accommodation preferences from User_Profiles.context_hotels.',
    parameters: z.object({
      query: z.string().describe('The search query for hotels or vacation rentals'),
    }),
    execute: async ({ query }: { query: string }) => {
      try {
        // Create a postgres client to execute raw SQL
        const sql = postgres(process.env.POSTGRES_URL!);
        
        // Look up the user's context_hotels from the database
        const result = await sql`
          SELECT context_hotels 
          FROM "User_Profiles" 
          WHERE id = ${userId}
        `;
        
        const context = result[0]?.context_hotels || '';
        
        // Close the connection
        await sql.end();

        // Step 1: Parse the query using OpenAI gpt-4.1-mini to extract structured search parameters
        const searchParams = await parseSearchQuery(query, context);

        // Step 2: Search Google Hotels via SerpAPI
        const hotelsResponse = await searchGoogleHotels(searchParams);

        if (!hotelsResponse.properties || hotelsResponse.properties.length === 0) {
          return {
            response: "No hotels found matching your search criteria. Please try adjusting your search parameters.",
          };
        }

        // Step 3: Get detailed information for top properties (limit to 40 as per n8n workflow)
        const topProperties = hotelsResponse.properties.slice(0, 40);
        const detailedProperties = await Promise.all(
          topProperties.map(async (property: any) => {
            if (property.serpapi_property_details_link) {
              const details = await getPropertyDetails(property.serpapi_property_details_link);
              // Summarize reviews if available
              if (details.reviews_breakdown || details.other_reviews) {
                const reviewSummary = await summarizeReviews(details);
                return { ...property, ...details, reviews_summary: reviewSummary };
              }
              return { ...property, ...details };
            }
            return property;
          })
        );

        // Step 4: Format the results using Google Gemini
        const formattedResults = await formatHotelResultsWithGemini(detailedProperties, searchParams, context, query, hotelsResponse.search_metadata?.prettify_html_file);

        return {
          response: formattedResults,
        };
      } catch (error) {
        console.error('Error in Google Hotels tool:', error);
        return {
          response: "I encountered an error while searching for hotels. Please try again later.",
        };
      }
    },
  });

async function parseSearchQuery(query: string, context: string): Promise<any> {
  const openAIApiKey = process.env.OPENAI_API_KEY;
  
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
${new Date().toString()}
</Current_DateTime>

<Client_Context>
${context}
</Client_Context>

<User_Query>
${query}
</User_Query>`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openAIApiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini', // Correct model as per n8n workflow
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    }),
  });

  const data = await response.json();
  const parsedQuery = JSON.parse(data.choices[0].message.content);

  // Add default check-in date if not provided
  if (!parsedQuery.check_in_date) {
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    parsedQuery.check_in_date = nextWeek.toISOString().split('T')[0];
  }

  // Add default check-out date if not provided
  if (!parsedQuery.check_out_date) {
    const checkIn = new Date(parsedQuery.check_in_date);
    checkIn.setDate(checkIn.getDate() + 7);
    parsedQuery.check_out_date = checkIn.toISOString().split('T')[0];
  }

  return parsedQuery;
}

async function searchGoogleHotels(params: any): Promise<any> {
  const serpApiKey = process.env.SERPAPI_API_KEY;
  
  const searchParams = new URLSearchParams({
    engine: 'google_hotels',
    q: params.q.replace(', ', ' '),
    check_in_date: params.check_in_date,
    check_out_date: params.check_out_date,
    adults: params.adults?.toString() || '1',
    children: params.children?.toString() || '0',
    rating: '8',
    api_key: serpApiKey!,
  });

  if (params.vacation_rentals === true) {
    searchParams.append('vacation_rentals', 'true');
    searchParams.append('property_types', '1,2,3,4,5,6,7,8,10,11,21');
  } else {
    searchParams.append('hotel_class', '3,4,5');
    searchParams.append('property_types', '12,13,15,17,18,19,20,21,22,23,24');
  }

  const response = await fetch(`https://serpapi.com/search?${searchParams}`);
  return response.json();
}

async function getPropertyDetails(detailsLink: string): Promise<any> {
  const serpApiKey = process.env.SERPAPI_API_KEY;
  const response = await fetch(`${detailsLink}&api_key=${serpApiKey}`);
  return response.json();
}

async function summarizeReviews(propertyDetails: any): Promise<string> {
  const openAIApiKey = process.env.OPENAI_API_KEY;
  
  const prompt = `Let's summarize the reviews about this hotel or vacation rental. Be as concise as possible. Just capture the key details, red flags, and positive points. You do not need to speak in complete sentences.

## Property Name:
${propertyDetails.name}

## Reviews & Ratings:
### Review Count: ${propertyDetails.reviews}
### Overall Rating: ${propertyDetails.overall_rating} / 5
  - Note: The average Google star rating for hotels is generally around 4.42 stars, according to a study from BrightLocal. Below 4.4 is below average. Below a 4 indicates serious issues with the property. 4.5-4.6+ is likely the bare minimum for a respectable property.
### Rating Details: 
${propertyDetails.ratings?.map((item: any) => 
  `\t- ${item.stars}/5 Stars: ${item.count}/${propertyDetails.reviews} (${(item.count/propertyDetails.reviews*100).toFixed(1)}%)`
).join('\n') || ''}

## Review Breakdown:
${propertyDetails.reviews_breakdown?.map((item: any) => 
  `- ${item.description}: 
\tMentions: ${item.total_mentioned} 
\tPositive: ${item.positive} (${(item.positive/item.total_mentioned*100).toFixed(1)}%)
\tNegative: ${item.negative} (${(item.negative/item.total_mentioned*100).toFixed(1)}%)
\tNeutral: ${item.neutral} (${(item.neutral/item.total_mentioned*100).toFixed(1)}%)`
).join('\n') || ''}

## Review_Breakdown:
${propertyDetails.other_reviews?.slice(0, 24).map((item: any, index: number) => 
  `Review ${index+1}
\tDate: ${item.user_review.date}
\tScore: ${item.user_review.rating.score}/${item.user_review.rating.max_score}
\tReview: ${item.user_review.comment}
\tSource: ${item.source}`
).join('\n\n') || ''}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openAIApiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini', // Correct model as per n8n workflow
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json();
  return data.choices[0].message.content;
}

async function formatHotelResultsWithGemini(properties: any[], searchParams: any, context: string, query: string, searchResultsUrl?: string): Promise<string> {
  const geminiApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  
  if (!geminiApiKey) {
    // Fallback to basic formatting if Gemini is not available
    return formatHotelResultsBasic(properties, searchParams, context, query, searchResultsUrl);
  }

  // Prepare the accommodation options data
  const accommodationOptions = properties.map((property, index) => {
    const flattenedProperty = flattenObject(property);
    const formattedProperties = Object.entries(flattenedProperty)
      .map(([k, v]) => `\n\t${k}: ${v}`)
      .join('');
    
    return `- ## Option ${index + 1} of ${properties.length}${formattedProperties}`;
  }).join('\n\n');

  const prompt = `<instructions>
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
${context}
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
\t* Pay online, non-refundable
* [Agoda](https://www.agoda.com/aviator-bali/hotel/full_link) - $2,735
\t* Pay at check-in, free cancellation until 11:59PM on July 13, 2025
* [Website](https://hotels.cloudbeds.com/en/reservation/full_link) - $ 1,627.81
\t* Pay online, non-refundable

\${3-11 similar reviews...}

See more options or change the search details on **[🏨 Google Hotels](${searchResultsUrl || '#'})]**.
</example_markdown_output>`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${geminiApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Clean up the response
    const cleanedText = generatedText
      .split('\n')
      .filter((item: string) => !item.startsWith('```'))
      .join('\n');

    return `# Accommodation Options
${cleanedText}

## Accommodation Preferences
${context}

## Current Accommodation Query
${query}

## Google Hotels Search Results Page
${searchResultsUrl || 'Search results URL not available'}`;

  } catch (error) {
    console.error('Error calling Gemini API:', error);
    // Fallback to basic formatting
    return formatHotelResultsBasic(properties, searchParams, context, query, searchResultsUrl);
  }
}

function formatHotelResultsBasic(properties: any[], searchParams: any, context: string, query: string, searchResultsUrl?: string): string {
  const formattedProperties = properties.map((property, index) => {
    const googleMapsLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${property.name} ${property.address || ''}`
    )}`;

    const lowestRate = property.rate_per_night?.extracted_lowest || property.prices?.[0]?.rate_per_night?.extracted_lowest;
    const totalRate = property.total_rate?.extracted_lowest || property.prices?.[0]?.total_rate?.extracted_lowest;

    let priceInfo = '';
    if (lowestRate) {
      priceInfo = `\n* 💰 From $${lowestRate}/night`;
      if (totalRate) {
        priceInfo += ` (Total: $${totalRate})`;
      }
    }

    let reviewInfo = '';
    if (property.overall_rating) {
      reviewInfo = `\n* ⭐ ${property.overall_rating} - ${property.rating || 'Good'} (${property.reviews || 0} reviews)`;
    }
    if (property.reviews_summary) {
      const summary = property.reviews_summary.split('\n').map((line: string) => `\t${line}`).join('\n');
      reviewInfo += `\n* 💬 ${summary}`;
    }

    let bookingLinks = '';
    if (property.featured_prices && property.featured_prices.length > 0) {
      const topPrices = property.featured_prices.slice(0, 2);
      bookingLinks = topPrices
        .map((price: any) => {
          if (price.link && price.source) {
            const totalPrice = price.total_rate?.extracted_lowest || price.total_rate?.lowest || 'Check price';
            return `\n* [${price.source}](${price.link}) - $${totalPrice}`;
          }
          return '';
        })
        .filter(Boolean)
        .join('');
    } else if (property.prices && property.prices.length > 0) {
      const topPrices = property.prices.slice(0, 2);
      bookingLinks = topPrices
        .map((price: any) => {
          if (price.link && price.source) {
            const totalPrice = price.total_rate?.extracted_lowest || price.total_rate?.lowest || 'Check price';
            return `\n* [${price.source}](${price.link}) - $${totalPrice}`;
          }
          return '';
        })
        .filter(Boolean)
        .join('');
    } else if (property.link) {
      bookingLinks = `\n* [View Details](${property.link})`;
    }

    return `## ${index + 1}. ${property.name}
* 📍 [${property.address || 'View location'}](${googleMapsLink})${priceInfo}${reviewInfo}${bookingLinks}`;
  });

  return `# Accommodation Options

Based on your search for "${query}", here are the top options:

${formattedProperties.join('\n\n')}

## Accommodation Preferences
${context}

## Current Accommodation Query
${query}

## Google Hotels Search Results Page
${searchResultsUrl || 'Search results URL not available'}`;
}

function flattenObject(obj: any, prefix = ''): Record<string, any> {
  return Object.entries(obj).reduce((acc: Record<string, any>, [k, v]) => {
    const pre = prefix.length ? prefix + '.' : '';
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(acc, flattenObject(v, pre + k));
    } else {
      acc[pre + k] = v;
    }
    return acc;
  }, {});
}