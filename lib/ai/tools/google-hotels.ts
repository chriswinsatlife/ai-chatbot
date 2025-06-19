import { tool } from 'ai';
import { z } from 'zod';

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
    description: 'Search for hotels and vacation rentals using Google Hotels via SerpAPI. This tool helps find accommodations with detailed information including prices, reviews, amenities, and availability.',
    parameters: z.object({
      query: z.string().describe('The search query for hotels or vacation rentals, including location and any specific requirements'),
    }),
    execute: async ({ query }: { query: string }) => {
      try {
        // Get user context
        const context = await getUserContext(userId);

        // Step 1: Parse the query using OpenAI to extract structured search parameters
        const searchParams = await parseSearchQuery(query, context);

        // Step 2: Search Google Hotels via SerpAPI
        const hotelsResponse = await searchGoogleHotels(searchParams);

        if (!hotelsResponse.properties || hotelsResponse.properties.length === 0) {
          return {
            response: "No hotels found matching your search criteria. Please try adjusting your search parameters.",
          };
        }

        // Step 3: Get detailed information for top properties (limit to 10)
        const topProperties = hotelsResponse.properties.slice(0, 10);
        const detailedProperties = await Promise.all(
          topProperties.map(async (property: any) => {
            if (property.serpapi_property_details_link) {
              const details = await getPropertyDetails(property.serpapi_property_details_link);
              return { ...property, ...details };
            }
            return property;
          })
        );

        // Step 4: Format the results
        const formattedResults = formatHotelResults(detailedProperties, searchParams, context, query);

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

async function getUserContext(userId: string): Promise<string> {
  try {
    // For server-side tools, we need to directly access the Supabase database
    // This assumes you have the user's Supabase profile ID
    // If you only have the Clerk ID, you'll need to look up the profile first
    
    // For now, return empty string as the context lookup needs to be done via
    // the proper database query method used in this project
    // TODO: Implement proper context lookup using project's DB patterns
    return '';
  } catch (error) {
    console.error('Error fetching user context:', error);
    return '';
  }
}

async function parseSearchQuery(query: string, context: string): Promise<any> {
  const openAIApiKey = process.env.OPENAI_API_KEY;
  
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
  "adults": number (default 2),
  "children": number (default 0)
}

<Current_DateTime>
${new Date().toISOString()}
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
      model: 'gpt-4o-mini',
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
    adults: params.adults?.toString() || '2',
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
  const details = await response.json();

  // Summarize reviews if available
  if (details.reviews_breakdown || details.other_reviews) {
    const reviewSummary = await summarizeReviews(details);
    return { ...details, reviews_summary: reviewSummary };
  }

  return details;
}

async function summarizeReviews(propertyDetails: any): Promise<string> {
  const openAIApiKey = process.env.OPENAI_API_KEY;
  
  const reviewData = {
    name: propertyDetails.name,
    reviews: propertyDetails.reviews,
    overall_rating: propertyDetails.overall_rating,
    ratings: propertyDetails.ratings,
    reviews_breakdown: propertyDetails.reviews_breakdown,
    other_reviews: propertyDetails.other_reviews?.slice(0, 10),
  };

  const prompt = `Summarize the reviews about this hotel or vacation rental. Be concise and capture key details, red flags, and positive points.

Property Name: ${reviewData.name}
Review Count: ${reviewData.reviews}
Overall Rating: ${reviewData.overall_rating} / 5
Note: Average Google star rating for hotels is around 4.42. Below 4.4 is below average. Below 4.0 indicates serious issues.

${JSON.stringify(reviewData, null, 2)}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openAIApiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300,
    }),
  });

  const data = await response.json();
  return data.choices[0].message.content;
}

function formatHotelResults(properties: any[], searchParams: any, context: string, query: string): string {
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
      reviewInfo += `\n* 💬 ${property.reviews_summary}`;
    }

    let bookingLinks = '';
    if (property.prices && property.prices.length > 0) {
      const topPrices = property.prices.slice(0, 2);
      bookingLinks = topPrices
        .map((price: any) => {
          if (price.link && price.source) {
            const totalPrice = price.total_rate?.extracted_lowest || price.total_rate?.lowest;
            return `\n* [${price.source}](${price.link}) - $${totalPrice || 'Check price'}`;
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

  const searchUrl = `https://www.google.com/hotels/search?q=${encodeURIComponent(searchParams.q)}&check_in_date=${searchParams.check_in_date}&check_out_date=${searchParams.check_out_date}`;

  return `# Accommodation Options

Based on your search for "${query}", here are the top options:

${formattedProperties.join('\n\n')}

## Search Details
- Check-in: ${searchParams.check_in_date}
- Check-out: ${searchParams.check_out_date}
- Guests: ${searchParams.adults} adult(s)${searchParams.children > 0 ? `, ${searchParams.children} child(ren)` : ''}

See more options on **[🏨 Google Hotels](${searchUrl})**.`;
}