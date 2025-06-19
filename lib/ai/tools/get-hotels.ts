import { tool } from 'ai';
import { z } from 'zod';

/**
 * Helper to call SerpAPI with the provided query parameters.
 * You can replace this implementation with a shared util once one exists,
 * but for now we define it locally to keep the change self-contained.
 */
async function serpApiGet<T = unknown>(path: string, query: Record<string, string | number | boolean | null | undefined>): Promise<T> {
  const baseUrl = 'https://serpapi.com';
  const url = new URL(path, baseUrl);

  // Append all non-null/undefined parameters
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.append(key, String(value));
    }
  });

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`SerpAPI request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export const getHotels = tool({
  description:
    'Retrieve hotel or vacation rental information from Google Hotels via SerpAPI',
  // Required and optional parameters
  parameters: z.object({
    q: z
      .string()
      .describe(
        'The search query (location, property name, etc.). Commas followed by a space will be normalised to a single space.'
      ),
    check_in_date: z
      .string()
      .describe('Check-in date in YYYY-MM-DD format.'),
    check_out_date: z
      .string()
      .describe('Check-out date in YYYY-MM-DD format.'),
    vacation_rentals: z
      .boolean()
      .optional()
      .describe('If true, search for vacation rentals instead of hotels.'),
    adults: z.number().int().positive().optional().describe('Number of adults. Default is 1.'),
    children: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Number of children.'),
  }),
  execute: async ({
    q,
    check_in_date,
    check_out_date,
    vacation_rentals,
    adults,
    children,
  }: {
    q: string;
    check_in_date: string;
    check_out_date: string;
    vacation_rentals?: boolean;
    adults?: number;
    children?: number;
  }) => {
    // Normalise the query as per n8n workflow (replace ', ' with ' ')
    const normalisedQuery = q.replace(/,\s+/g, ' ');

    // Determine query parameters according to the workflow logic
    const dynamicParamName = vacation_rentals ? 'vacation_rentals' : 'hotel_class';
    const dynamicParamValue = vacation_rentals ? vacation_rentals : '3,4,5';

    const propertyTypes = vacation_rentals
      ? '1,2,3,4,5,6,7,8,10,11,21'
      : '12,13,15,17,18,19,20,21,22,23,24';

    // Assemble final query object (null/undefined values will be filtered out by serpApiGet)
    const query: Record<string, string | number | boolean | null | undefined> = {
      engine: 'google_hotels',
      q: normalisedQuery,
      check_in_date,
      check_out_date,
      [dynamicParamName]: dynamicParamValue,
      property_types: propertyTypes,
      rating: 8,
      adults: adults ?? 1,
      children,
    };

    // Perform the request
    const result = await serpApiGet('/search', query);

    return result;
  },
});