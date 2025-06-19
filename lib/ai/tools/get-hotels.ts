import { tool } from 'ai';
import { z } from 'zod';

// Simple demo implementation – replace with real hotel API if credentials become available.
export const getHotels = tool({
  description: 'Get a list of sample hotels for a given location',
  parameters: z.object({
    location: z.string().describe('City name, airport code, or general location'),
    limit: z.number().int().min(1).max(10).default(5).optional(),
  }),
  // For demo purposes we generate deterministic mock data so automated tests see consistent results.
  execute: async ({ location, limit = 5 }: { location: string; limit?: number }) => {
    const sampleHotels = Array.from({ length: limit }).map((_, idx) => ({
      name: `${location} Hotel ${idx + 1}`,
      address: `${idx + 1} ${location} Main Street`,
      rating: 4 + ((idx % 2) ? 0.5 : 0), // 4 or 4.5
    }));

    return {
      location,
      count: sampleHotels.length,
      hotels: sampleHotels,
    };
  },
});