import { z } from 'zod';
import { tool, generateText, generateObject, type DataStreamWriter } from 'ai';
import { db } from '@/lib/db/queries';
import * as schema from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';

console.log('[GoogleFlights] Tool file loaded.');

interface GoogleFlightsProps {
  userId: string;
  dataStream?: DataStreamWriter;
}

// Helper function to emit progress events
function emitProgress(
  dataStream: DataStreamWriter | undefined,
  stage: 'preferences' | 'parsing' | 'searching' | 'booking' | 'formatting',
  message: string,
  current?: number,
  total?: number,
  destination?: string,
) {
  if (dataStream) {
    const payload: { [key: string]: any } = { stage, message };
    if (current !== undefined) payload.current = current;
    if (total !== undefined) payload.total = total;
    if (destination !== undefined) payload.destination = destination;

    dataStream.writeData({
      type: 'flight-progress',
      content: payload,
    });
  }
}

// Zod schema for flight search parameters, following the n8n workflow exactly
const flightSearchSchema = z.object({
  departure_id: z.string().describe('Departure airport code (e.g., "SFO", "CDG")'),
  arrival_id: z.string().describe('Arrival airport code (e.g., "BKK", "NRT")'),
  type: z.string().describe('Flight type: "1" = Round trip, "2" = One way, "3" = Multi-city'),
  outbound_date: z.string().describe('Departure date in YYYY-MM-DD format'),
  return_date: z.string().optional().describe('Return date in YYYY-MM-DD format (required if type = "1")'),
  travel_class: z.string().describe('Travel class: "1" = Economy, "2" = Premium economy, "3" = Business, "4" = First'),
  stops: z.string().describe('Stops: "0" = Any, "1" = Nonstop, "2" = ≤1 stop, "3" = ≤2 stops'),
  show_hidden: z.string().describe('Flag to show hidden options'),
  adults: z.string().describe('Number of adult passengers'),
  children: z.string().describe('Number of child passengers'),
  infants_in_seat: z.string().describe('Number of infants needing their own seat'),
  infants_on_lap: z.string().describe('Number of infants sitting on a lap'),
  bags: z.string().describe('Number of carry-on bags'),
  max_price: z.string().optional().describe('Maximum ticket price'),
  outbound_times: z.string().optional().describe('Outbound time ranges (e.g., "8,18")'),
  return_times: z.string().optional().describe('Return time ranges (e.g., "9,23")'),
  layover_duration: z.string().optional().describe('Layover duration range in minutes (e.g., "60,240")'),
  exclude_conns: z.string().optional().describe('Comma-separated IATA codes to exclude as connecting airports'),
  max_duration: z.string().optional().describe('Maximum flight duration in minutes'),
  exclude_airlines: z.string().optional().describe('Comma-separated airlines to exclude'),
  include_airlines: z.string().optional().describe('Comma-separated airlines to include'),
  multi_city_json: z.string().optional().describe('JSON string for multi-city flights'),
});

async function getUserContext(userId: string): Promise<string | null> {
  try {
    console.log(`[GoogleFlights] Fetching context for userId: ${userId}`);
    const [userProfile] = await db
      .select({ 
        context_flights: schema.userProfiles.context_flights,
        context_location: schema.userProfiles.context_location
      })
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.id, userId));

    console.log(
      `[GoogleFlights] User profile found:`,
      userProfile ? 'Yes' : 'No',
    );

    // Combine both contexts
    const combinedContext = [
      userProfile?.context_flights || '',
      userProfile?.context_location || ''
    ].filter(Boolean).join('\n\n');

    console.log(`[GoogleFlights] Combined context:`, combinedContext || 'None');

    return combinedContext || null;
  } catch (error) {
    console.error(`[GoogleFlights] Error fetching user context:`, error);
    return null;
  }
}

async function parseSearchQuery(
  query: string,
  context: string | null,
): Promise<string> {
  const currentDate = new Date().toString();
  
  // Exact prompt from n8n workflow "Generate Query Metadata1" node
  const prompt = `Based on the below data, please output the search YAML. Leave a value blank if it is not necessary or unspecified, like "return_date" for one-way flights. 

<Guidelines>
- The <Client_Context> is general historic information and should be used to populate fields not specified in the <User_Query>. 
     - For example, if the user does not specify an origin airport or a fare class, we may use context from <Client_Context> to fill this in. 
- The <User_Query> overrides on any conflict, since it is a current request from the user. 
     - For example, if the context says "the client typically travels alone" and "never allows layovers" but the <User_Query> requests a flight with 4 seats and "maximum one layover", the JSON you output should conform to the <User_Query>. The <Current_DateTime> should be used for interpreting queries like "next month" or "next week".
- Use common sense on layovers. 
     - If a client normally avoids layovers but their itinerary is from Bozeman to Denpasar, obviously a search with max layovers zero will fail. Fill in a reasonable number based on the itinerary. 
- Assume 1 carry-on unless stated otherwise in the context or query.
- Output according to the examples below. Use the right format depending on the type of flight (round-trip, one-way, or multi-city). 
- DO NOT include the comments like "# 1 - Round trip" or "# 1h - 5h layovers" in your final output, or the entire thing will fail. This is very important.
- Don't fence it in triple backticks like "\`\`\`yaml\`\`\`" or a code-block. The receiving app already knows how to interpret the language or I WILL BE KILLED. 
</Guidelines>

<api_parameter_guidelines>
**departure_id (optional):** Airport code (3-letter IATA uppercase) or Freebase ID (/m/); comma-separated for multiple  
**arrival_id (optional):** Same as departure_id  
**gl (optional):** Country code (2-letter)  
**hl (optional):** Language code (2-letter)  
**currency (optional):** Currency code (ISO)  
**type (optional):** 1=Round trip, 2=One way, 3=Multi-city  
**outbound_date (optional):** YYYY-MM-DD  
**return_date (optional, required if type=1):** YYYY-MM-DD  
**travel_class (optional):** 1=Economy, 2=Premium economy, 3=Business, 4=First  
**multi_city_json (optional):** JSON array of segments with departure_id, arrival_id, date, times  
**show_hidden (optional):** true/false  
**deep_search (optional):** true/false  
**adults (optional):** integer  
**children (optional):** integer  
**infants_in_seat (optional):** integer  
**infants_on_lap (optional):** integer  
**sort_by (optional):** 1=Top flights, 2=Price, 3=Departure time, 4=Arrival time, 5=Duration, 6=Emissions  
**stops (optional):** 0=Any, 1=Nonstop, 2=≤1 stop, 3=≤2 stops  
**exclude_airlines/include_airlines (optional):** comma-separated 2-char IATA codes or alliances; mutually exclusive (alliances: \`STAR_ALLIANCE\`, \`SKYTEAM\`, \`ONEWORLD\`)  
**bags (optional):** integer carry-ons  
**max_price (optional):** numeric  
**outbound_times (optional):** hours range as comma-separated numbers (start,end or start,end,start,end)  
**return_times (optional, type=1):** same format as outbound_times  
**emissions (optional):** 1=Low emissions  
**layover_duration (optional):** minutes range, e.g., 90,330  
**exclude_conns (optional):** comma-separated 3-letter airport codes  
**max_duration (optional):** minutes  
</api_parameter_guidelines>

<examples>
<example_1>
deep_search: true                     
departure_id: "JFK"                   
arrival_id: "LHR"                     
type: 1                               
outbound_date: "2025-12-10"
return_date:  "2025-12-20"            
travel_class: 2                       
show_hidden: false
adults: 2
children: 1
infants_in_seat: 0
infants_on_lap: 1
stops: 1                               
include_airlines: "BA,AA,ONEWORLD"    
exclude_airlines: null                
bags: 1                                
max_price: 2000                        
outbound_times: "15,23"                
return_times:  "6,12"                  
layover_duration: "90,360"             
exclude_conns: "ORD"                   
max_duration: 900                      
</example_1>

<example_2>
deep_search: false                    
departure_id: "LAX"                   
arrival_id: "NRT"                     
type: 2                               
outbound_date: "2025-09-01"
travel_class: 1                       
show_hidden: true
adults: 1
children: 0
infants_in_seat: 0
infants_on_lap: 0
stops: 0                               
exclude_airlines: "UA,DL"             
include_airlines: null                
bags: 0
max_price: 1200
outbound_times: "8,18"                
layover_duration: "60,300"            
exclude_conns: "SFO"                  
</example_2>

<example_3>
deep_search: true
departure_id: "SFO"                   
arrival_id: "JFK"                     
type: 3                               
multi_city_json:
  - departure_id: "SFO"
    arrival_id:  "ORD"
    date: "2025-10-05"
    times: "6,12"
  - departure_id: "ORD"
    arrival_id:  "BOS"
    date: "2025-10-10"
    times: "14,20"
  - departure_id: "BOS"
    arrival_id:  "JFK"
    date: "2025-10-14"
    times: "8,18"

travel_class: 4                       
show_hidden: true
adults: 2
children: 0
infants_in_seat: 0
infants_on_lap: 0
stops: 2                              
include_airlines: null                
exclude_airlines: "NK"                
bags: 2
max_price: 6500
outbound_times: "4,22"                
layover_duration: "90,480"            
exclude_conns: "ATL"                  
max_duration: 1200                    
</example_3>
</examples>

<Client_Context>
${context || 'No context provided.'}
</Client_Context>

<Current_DateTime>
${currentDate}
</Current_DateTime>

<User_Query>
${query}
</User_Query>`;

  console.log(`[GoogleFlights] Parsing search query.`);

  const { text: yamlResult } = await generateText({
    model: google('gemini-2.5-pro'),
    prompt,
  });

  console.log('[GoogleFlights] AI produced YAML:', yamlResult);
  return yamlResult;
}

// Clean Flights Data function exactly matching n8n workflow
function cleanFlightsData(yamlText: string): z.infer<typeof flightSearchSchema> {
  const getValue = (field: string): string => {
    const lines = yamlText.split('\n');
    const matchedLine = lines.find(line => line.includes(field));
    if (!matchedLine) return '';
    
    return matchedLine
      .split(': ')[1]
      ?.replaceAll('"', '')
      ?.trim() || '';
  };

  // Parse multi_city_json exactly as in n8n workflow
  const parseMultiCityJson = (): string | undefined => {
    const raw = yamlText || '';
    const lines = raw.split('\n');
    const start = lines.findIndex(l => /^\s*multi_city_json\s*:/.test(l));
    if (start === -1) return undefined;

    const legs = [];
    let leg: any = null;

    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      const m = l.match(/^\s*(?:-\s*)?(departure_id|arrival_id|date|times):\s*(.*)/);
      if (!m) continue;

      const key = m[1];
      let val = m[2].split('#')[0].replace(/"/g, '').trim();

      if (key === 'departure_id') {
        if (leg) legs.push(leg);
        leg = { departure_id: val };
        continue;
      }

      if (!leg) leg = {};

      if (key === 'arrival_id') leg.arrival_id = val;
      else if (key === 'date') leg.date = val;
      else if (key === 'times' && val && val.toLowerCase() !== 'null') leg.times = val;
    }

    if (leg) legs.push(leg);
    return legs.length ? JSON.stringify(legs) : undefined;
  };

  return {
    departure_id: getValue('departure_id'),
    arrival_id: getValue('arrival_id'),
    type: getValue('type'),
    outbound_date: getValue('outbound_date'),
    return_date: getValue('return_date') || undefined,
    travel_class: getValue('travel_class'),
    show_hidden: getValue('show_hidden'),
    stops: getValue('stops'),
    multi_city_json: parseMultiCityJson(),
    adults: getValue('adults'),
    children: getValue('children'),
    infants_in_seat: getValue('infants_in_seat'),
    infants_on_lap: getValue('infants_on_lap'),
    exclude_airlines: getValue('exclude_airlines') || undefined,
    include_airlines: getValue('include_airlines') || undefined,
    bags: getValue('bags'),
    max_price: getValue('max_price') || undefined,
    outbound_times: getValue('outbound_times') || undefined,
    return_times: getValue('return_times') || undefined,
    layover_duration: getValue('layover_duration') || undefined,
    exclude_conns: getValue('exclude_conns') || undefined,
    max_duration: getValue('max_duration') || undefined,
  };
}

async function searchGoogleFlights(
  searchParams: z.infer<typeof flightSearchSchema>,
) {
  if (!process.env.SERPAPI_API_KEY) {
    throw new Error('SERPAPI_API_KEY is not set');
  }

  console.log(
    '[GoogleFlights] Constructing search from parameters:',
    searchParams,
  );

  const finalParams: { [key: string]: any } = {
    engine: 'google_flights',
    api_key: process.env.SERPAPI_API_KEY,
    departure_id: searchParams.departure_id,
    arrival_id: searchParams.arrival_id,
    type: searchParams.type,
    outbound_date: searchParams.outbound_date,
    travel_class: searchParams.travel_class,
    show_hidden: searchParams.show_hidden,
    stops: searchParams.stops,
    adults: searchParams.adults,
    children: searchParams.children,
    infants_in_seat: searchParams.infants_in_seat,
    infants_on_lap: searchParams.infants_on_lap,
    bags: searchParams.bags,
  };

  // Add optional parameters if they exist
  if (searchParams.return_date) finalParams.return_date = searchParams.return_date;
  if (searchParams.max_price) finalParams.max_price = searchParams.max_price;
  if (searchParams.outbound_times) finalParams.outbound_times = searchParams.outbound_times;
  if (searchParams.return_times) finalParams.return_times = searchParams.return_times;
  if (searchParams.layover_duration) finalParams.layover_duration = searchParams.layover_duration;
  if (searchParams.exclude_conns) finalParams.exclude_conns = searchParams.exclude_conns;
  if (searchParams.max_duration) finalParams.max_duration = searchParams.max_duration;
  if (searchParams.exclude_airlines) finalParams.exclude_airlines = searchParams.exclude_airlines;
  if (searchParams.include_airlines) finalParams.include_airlines = searchParams.include_airlines;
  if (searchParams.multi_city_json) finalParams.multi_city_json = searchParams.multi_city_json;

  // Remove undefined values
  Object.keys(finalParams).forEach(
    (key) =>
      (finalParams[key] === undefined || finalParams[key] === null || finalParams[key] === '') &&
      delete finalParams[key],
  );

  const url = new URL('https://serpapi.com/search.json');
  url.search = new URLSearchParams(finalParams).toString();

  console.log(`[GoogleFlights] Making HTTP request to SerpAPI: ${url}`);

  const response = await fetch(url.toString());
  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      `[GoogleFlights] SerpAPI request failed with status ${response.status}:`,
      errorBody,
    );
    throw new Error(
      `SerpAPI request failed with status ${response.status}: ${response.statusText}`,
    );
  }
  const result = await response.json();

  console.log(
    `[GoogleFlights] SerpAPI response metadata:`,
    JSON.stringify(result.search_metadata, null, 2),
  );

  if (result.error) {
    console.error('[GoogleFlights] SerpAPI returned an error:', result.error);
    throw new Error(result.error);
  }

  return result;
}

async function getBookingOptions(
  searchParams: z.infer<typeof flightSearchSchema>,
  bookingToken: string,
) {
  if (!process.env.SERPAPI_API_KEY) {
    throw new Error('SERPAPI_API_KEY is not set');
  }

  const finalParams: { [key: string]: any } = {
    engine: 'google_flights',
    api_key: process.env.SERPAPI_API_KEY,
    departure_id: searchParams.departure_id,
    arrival_id: searchParams.arrival_id,
    type: searchParams.type,
    outbound_date: searchParams.outbound_date,
    travel_class: searchParams.travel_class,
    show_hidden: searchParams.show_hidden,
    stops: searchParams.stops,
    booking_token: bookingToken,
  };

  if (searchParams.return_date) finalParams.return_date = searchParams.return_date;

  const url = new URL('https://serpapi.com/search.json');
  url.search = new URLSearchParams(finalParams).toString();

  console.log(`[GoogleFlights] Getting booking options: ${url}`);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(
      `Booking options request failed with status ${response.status}: ${response.statusText}`,
    );
  }
  const result = await response.json();

  if (result.error) {
    console.error('[GoogleFlights] Booking options error:', result.error);
    throw new Error(result.error);
  }

  return result;
}

async function formatFlightResults(
  flights: any[],
  searchResults: any,
  context: string | null,
  query: string,
): Promise<string> {
  // Flatten function exactly as in n8n workflow
  function flatten(obj: any, prefix = ''): any {
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

  // Process flights exactly as in n8n workflow
  const processedFlights = [].concat(...flights)
    .filter((item: any) => item != null)
    .map((flightOptionItem: any, index: number) => {
      const flattenedOption = flatten(flightOptionItem);
      const formattedProperties = Object.entries(flattenedOption)
        .map(([k, v]) => `\n\t${k}: ${v}`)
        .join('');
      return `Option ${index + 1}${formattedProperties}`;
    })
    .join('\n\n');

  // Exact prompt from n8n workflow "Review & Format1" node
  const prompt = `<instructions>
Please organize the following flight options in a proper markdown output. 

- Include all the relevant details like flight names, airlines, costs, etc into a markdown-fromatted output.
- Output markdown following the example provided. 
- Ensure to include the full booking URLs and NEVER truncate them.
- Make sure to take into account the client's flight preferences when ordering the flights, which are given below.
- The "user query" OVERRIDES any conflict it has with the flight preferences. The client preferences are historic and GENERAL preferences, whereas the query is their specific, current request for THIS ITINERARY.
</instructions>

<flight_options (${flights.length} options)>
${processedFlights}
</flight_options>

<client_preferences_context>
${context || 'No context provided.'}
</client_preferences_context>

<user_query>
${query}
</user_query>

<example_markdown_output>
# **⛩️ DPS to Tokyo**
## **Singapore Airlines • Economy • $364** 
* ⭐ *Recommended for best duration and price*  
* Thu, Jun 5 • SQ 935 • DPS - SIN • 10:05 AM–12:45 PM (2h 40m)  
* Layover: 1h 10m  
* Thu, Jun 5 • SQ 634 • SIN - HND • 1:55 PM–9:55 PM (7h)
* **Total Duration: 10h 50m**
* 🔗 https://www.google.com/travel/flights/s/arfZwufmsb9EvZDa7  

## **THAI • Economy • $375**  
* Thu, Jun 5 • TG 432 • DPS - BKK • 4:55 PM–8:05 PM (4h 10m)  
* Layover: 2h 40m  
* Thu, Jun 5 • BKK - HND • 10:45 PM–6:55 AM+1 (6h 10m, overnight)
* **Total Duration: 13h**
* 🔗 https://www.google.com/travel/flights/s/7N6V76NZwEo8ie9L9  

# **🍷 DPS to Tbilisi**
## **Turkish Airlines • Economy • $1,401** 
* ⭐*Recommended for shortest duration and equal cost*  
* Thu, Jun 5 • TK 67 • DPS - IST • 9:20 PM–5:15 AM+1 (12h 55m, overnight)  
* Layover: 1h 30m  
* Fri, Jun 6 • TK 382 • IST - TBS • 6:45 AM+1–10:05 AM+1 (2h 20m)
* **Total Duration: 16h 45m**
* 🔗 https://www.google.com/travel/flights/s/MRyzKQzrgcKNoRqx7  

## **Turkish Airlines • Economy • $1,401**  
* Thu, Jun 5 • TK 67 • DPS - IST • 9:20 PM–5:15 AM+1 (12h 55m, overnight)  
* Layover: 8h  
* Fri, Jun 6 • TK 382 • IST - TBS • 1:15 PM+1–4:40 PM+1 (2h 25m)
* **Total Duration: 23h 20m**
* 🔗 https://www.google.com/travel/flights/s/kg6qPdRd3pQ6F1H66  

# **🏞️ DPS to Geneva**
## **Etihad • Economy • $899** 
* ⭐*Recommended for schedule and price*  
* Thu, Jun 5 • EY 477 • DPS - AUH • 6:45 PM–11:30 PM (8h 45m)  
* Layover: 3h (overnight)  
* Thu, Jun 5 • EY 145 • AUH - GVA • 2:30 AM+1–7:20 AM+1 (6h 50m)
* **Total Duration: 18h 35m**
* 🔗 https://www.google.com/travel/flights/s/BPnNhPmJ7EUsPGRp9  

## **Turkish Airlines • Economy • $1,247**  
* Thu, Jun 5 • TK 67 • DPS - IST • 9:20 PM–5:15 AM+1 (12h 55m, overnight)  
* Layover: 2h  
* Fri, Jun 6 • TK 1917 • IST - GVA • 7:15 AM+1–9:30 AM+1 (3h 15m)
* **Total Duration: 18h 10m**
* 🔗 https://www.google.com/travel/flights/s/ampDaLPNQhWdK9RN8
</example_markdown_output>`;

  console.log(
    `[GoogleFlights] Starting AI formatting with ${flights.length} flights`,
  );

  const { text: formattedResults } = await generateText({
    model: google('gemini-2.5-flash'),
    prompt,
  });

  console.log('[GoogleFlights] AI formatting completed');

  return formattedResults;
}

export const googleFlights = ({ userId, dataStream }: GoogleFlightsProps) =>
  tool({
    description: `The Google Flights tool is used to search for flights. This tool contains information about the user's flight preferences, so you generally do not need to ask the user about their preferences like preferred airlines, desired travel class, pricing, etc. You will need only the trip-specific information like the date of the trip, origin/destination, required amenities, etc. Simply call the tool with a detailed query on their itinerary. Note the tool will only output links to book flights, and flights cannot be booked directly by the AI. YOU CANNOT BOOK FLIGHTS. DO NOT CLAIM YOU CAN BOOK FLIGHTS ON THE USER'S BEHALF.

This tool will return the user's preferences and best available flight options in markdown, which you can use in your subsequent message to them. Aim to output 3-8 options.

CRITICAL: The user CANNOT see the results of the tool--only you can. You must put information from the tool's output in your message to the user if you want them to see it. You must ALWAYS output the flight links with your flight options, and truncate these links.

Sometimes the tool will return extremely long links, in which case you must shorten them when you output these to the user (e.g. [Singapore Airlines](https://www.google.com/travel/flights/tons-of-parameters-and-hundreds-of-characters). Always output the Google Flights search link at the end of your recommended flights, so the user can continue the search on the website or view the full results.`,

    parameters: z.object({
      query: z
        .string()
        .describe(
          'The user\'s flight search request (e.g., "round trip from SFO to Tokyo next month", "one way flight from NYC to London in business class")',
        ),
    }),

    execute: async ({ query }) => {
      try {
        console.log(`[GoogleFlights] Starting flight search for query: ${query}`);

        // Step 1: Get user context
        emitProgress(dataStream, 'preferences', 'Getting your flight preferences...');
        const context = await getUserContext(userId);
        console.log(`[GoogleFlights] User context retrieved: ${context ? 'Yes' : 'No'}`);

        // Step 2: Parse the query using exact n8n workflow
        emitProgress(dataStream, 'parsing', 'Parsing your search request...');
        const yamlResult = await parseSearchQuery(query, context);
        const searchParams = cleanFlightsData(yamlResult);
        console.log(`[GoogleFlights] Search parameters parsed:`, searchParams);

        // Step 3: Search for flights
        const destination = `${searchParams.departure_id} to ${searchParams.arrival_id}`;
        emitProgress(dataStream, 'searching', `Searching flights in ${destination}...`);
        const searchResults = await searchGoogleFlights(searchParams);
        console.log(`[GoogleFlights] Flight search completed`);

        // Step 4: Process flights exactly as n8n workflow
        const bestFlights = searchResults.best_flights || [];
        const otherFlights = searchResults.other_flights || [];
        const allFlights = [...bestFlights, ...otherFlights].slice(0, 3); // Limit to 3 flights as in workflow

        emitProgress(dataStream, 'booking', 'Getting booking options...');
        const flightsWithBookings = [];
        for (let i = 0; i < allFlights.length; i++) {
          const flight = allFlights[i];
          if (flight.booking_token) {
            try {
              const bookingOptions = await getBookingOptions(searchParams, flight.booking_token);
              if (bookingOptions.booking_options && bookingOptions.booking_options.length > 0) {
                const bookingOption = bookingOptions.booking_options[0];
                flight.flights = bookingOption.selected_flights?.[0]?.flights || flight.flights;
                flight.booking_url = `${bookingOption.together.booking_request.url}?${bookingOption.together.booking_request.post_data}`;
                flight.book_with = bookingOption.together.book_with;
                flight.price_usd = bookingOption.together.price;
                flight.baggage = bookingOption.together.baggage_prices?.[0];
              }
            } catch (error) {
              console.error(`[GoogleFlights] Error getting booking options for flight ${i + 1}:`, error);
            }
          }
          flightsWithBookings.push(flight);
        }

        // Step 5: Format results exactly as n8n workflow
        emitProgress(dataStream, 'formatting', 'Applying flight preferences and re-ranking...');
        const formattedResults = await formatFlightResults(
          flightsWithBookings,
          searchResults,
          context,
          query,
        );

        // Final response format exactly as n8n workflow "Response1" node
        const finalResponse = `# Flights

## Flight Options
${formattedResults
  .split('\n')
  .filter(item => item.slice(0, 3) !== '```')
  .join('\n')}

## Context
${context || 'No context provided.'}

## Google Flights Search Results URL
${searchResults.search_metadata?.google_flights_url || ''}`;

        console.log(`[GoogleFlights] Flight search completed successfully`);
        return finalResponse;
      } catch (error) {
        console.error('[GoogleFlights] Error in flight search:', error);
        throw new Error(`Flight search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    },
  }); 