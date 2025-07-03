# Google Flights Chatbot Tool - Product Requirements Document

## 1. Objective

To integrate a Google Flights search tool into the existing Vercel AI SDK-based chatbot. This tool will allow users to search for flights using natural language, with the chatbot providing formatted, context-aware results including booking options and personalized recommendations.

## 2. Background

The tool's functionality is designed to replicate and replace a pre-existing n8n workflow. The goal is to bring this capability directly into the chatbot's backend, leveraging the Vercel AI SDK for seamless integration, tool definition, and response streaming. This will create a more unified and efficient user experience for flight search and booking discovery.

## 3. Key Features

### 3.1. Natural Language Query Processing
The tool must accept a user's free-form text query (e.g., "round trip from SFO to Tokyo next month", "one way flight from NYC to London in business class") and parse it into a structured YAML object suitable for the SerpAPI Google Flights endpoint. This involves an LLM call to identify key entities like departure/arrival airports, dates, travel class, number of passengers, and specific user preferences.

### 3.2. User Context Integration
- The tool will fetch user-specific flight preferences from the `context_flights` column in the `User_Profiles` table in the Supabase database.
- This context (e.g., "prefers nonstop flights," "usually travels in business class," "avoids layovers") will be injected into the LLM prompts to influence both the search parameters and the final ranking/formatting of results, making the recommendations personalized.

### 3.3. SerpAPI Integration
- The core flight search functionality will be powered by the SerpAPI Google Flights endpoint.
- The API key will be securely accessed from the `SERPAPI_API_KEY` environment variable.
- The tool supports comprehensive flight search parameters including multi-city trips, specific airlines, layover preferences, and booking options.

### 3.4. Multi-Step Implementation Logic
The tool will execute a chain of actions to fulfill a user's request:
1. **Parse Query:** An initial LLM call will transform the user's query and context into a structured YAML object for the SerpAPI, following exact n8n workflow specifications.
2. **Search Flights:** The tool will make a request to the SerpAPI Google Flights endpoint with the generated parameters.
3. **Get Booking Options:** For each flight result, the tool will fetch detailed booking information including URLs and pricing from different providers.
4. **Format Results:** A final LLM call will take the raw JSON response from SerpAPI and format it into a user-friendly, markdown-based summary with flight details, pricing, and booking links.

### 3.5. Advanced Flight Search Capabilities
- **Trip Types:** Support for round-trip, one-way, and multi-city flights
- **Travel Classes:** Economy, Premium Economy, Business, and First class options
- **Passenger Types:** Adults, children, infants in seat, and infants on lap
- **Filtering Options:** Stops preferences, airline inclusions/exclusions, price limits, departure/arrival time ranges
- **Layover Controls:** Duration preferences and excluded connection airports
- **Baggage Options:** Carry-on bag specifications

### 3.6. Streaming UI Feedback
To enhance user experience, the tool will use the Vercel AI SDK's streaming capabilities to provide real-time updates on its progress, such as:
- "Getting your flight preferences..."
- "Parsing your search request..."
- "Searching flights in [destination]..."
- "Getting booking options..."
- "Applying flight preferences and re-ranking..."

## 4. Technical Specifications

### 4.1. File Structure & Naming
- **Existing File:** The tool's logic is implemented in `lib/ai/tools/google-flights.ts`.
- **Registration:** The tool is registered in `lib/ai/tools/tool-list.ts`.
- **UI Component:** Flight results are displayed using `components/flight.tsx`.

### 4.2. Database Schema
- The tool accesses the `context_flights: text('context_flights')` column in the `User_Profiles` table to retrieve user-specific flight preferences and historical context.

### 4.3. Core Dependencies
- **`@ai-sdk/google`**: Powers the LLM-based query parsing and response formatting using Gemini models.
- **`@ai-sdk/openai`**: Fallback LLM provider for specific operations.
- **`ai` (Vercel AI SDK)**: For core functionalities like `tool()` definition and streaming responses.
- **`zod`**: For defining comprehensive flight search parameter schemas.
- **Native `fetch`**: For making HTTP requests to SerpAPI endpoints.

### 4.4. Prompt Engineering
- The prompts used for the LLM calls are precisely replicated from the provided `Superchat___Google_Flights_Tool.json` workflow.
- Query parsing follows exact YAML structure specifications with comprehensive parameter mapping.
- Result formatting includes personalized recommendations based on user context and query specifics.

### 4.5. API Parameter Mapping
The tool supports comprehensive Google Flights API parameters:
- **Core Parameters:** departure_id, arrival_id, type, outbound_date, return_date, travel_class
- **Passenger Configuration:** adults, children, infants_in_seat, infants_on_lap
- **Filtering Options:** stops, exclude_airlines, include_airlines, max_price, bags
- **Time Preferences:** outbound_times, return_times, layover_duration, max_duration
- **Advanced Options:** exclude_conns, multi_city_json, show_hidden, deep_search

## 5. Response Format

### 5.1. Structured Output
The tool returns comprehensive flight information including:
- **Flight Options:** Detailed itineraries with airline, flight numbers, timing, and duration
- **Pricing:** Cost breakdown with different booking providers
- **Booking Links:** Direct URLs to complete purchases on airline or travel agency websites
- **Recommendations:** AI-powered suggestions based on user preferences and context
- **Search Context:** User preferences and original query context for transparency

### 5.2. Markdown Formatting
Results are formatted as structured markdown with:
- Clear headings for different destinations or trip segments
- Recommended options highlighted with star ratings and explanations
- Complete flight details including layovers and total journey time
- Clickable booking URLs for immediate purchase options

## 6. Exclusions (Initial Version)

- The tool provides booking links but does not handle actual flight purchases - users must complete bookings on external sites
- Real-time seat availability checking is not implemented beyond what SerpAPI provides
- Advanced loyalty program integration and status matching are not included in the initial version
- The tool focuses on the top flight options (typically 3-8 results) to maintain response clarity and performance 