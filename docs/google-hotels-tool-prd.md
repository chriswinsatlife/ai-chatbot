# Google Hotels Chatbot Tool - Product Requirements Document

## 1. Objective

To integrate a Google Hotels search tool into the existing Vercel AI SDK-based chatbot. This tool will allow users to search for hotels and vacation rentals using natural language, with the chatbot providing formatted, context-aware results.

## 2. Background

The tool's functionality is designed to replicate and replace a pre-existing n8n workflow. The goal is to bring this capability directly into the chatbot's backend, leveraging the Vercel AI SDK for seamless integration, tool definition, and response streaming. This will create a more unified and efficient user experience.

## 3. Key Features

### 3.1. Natural Language Query Processing
The tool must accept a user's free-form text query (e.g., "Find me a nice hotel in Canggu for next week") and parse it into a structured JSON object suitable for an API request. This involves an LLM call to identify key entities like location, dates, number of guests, and specific user preferences.

### 3.2. User Context Integration
- The tool will fetch user-specific travel preferences from the `context_hotels` column in the `User_Profiles` table in the Supabase database.
- This context (e.g., "prefers hotels with a gym," "usually travels with a partner") will be injected into the LLM prompts to influence both the search parameters and the final ranking/formatting of results, making the recommendations personalized.

### 3.3. SerpAPI Integration
- The core hotel search functionality will be powered by the SerpAPI Google Hotels endpoint.
- The API key will be securely accessed from the `SERPAPI_API_KEY` environment variable.

### 3.4. Multi-Step Implementation Logic
The tool will execute a chain of actions to fulfill a user's request:
1.  **Parse Query:** An initial LLM call will transform the user's query and context into a structured JSON object for the SerpAPI.
2.  **Search Hotels:** The tool will make a request to the SerpAPI with the generated parameters.
3.  **Format Results:** A final LLM call will take the raw JSON response from SerpAPI and format it into a user-friendly, markdown-based summary, similar to the output of the original n8n workflow.

### 3.5. Streaming UI Feedback
To enhance user experience, the tool will use the Vercel AI SDK's streaming capabilities to provide real-time updates on its progress, such as:
- "Fetching user preferences..."
- "Figuring out what to search for..."
- "Searching for hotels..."
- "Formatting results..."

## 4. Technical Specifications

### 4.1. File Structure & Naming
- **New File:** The tool's logic will be encapsulated in a new file at `lib/ai/tools/google-hotels.ts`.
- **Modification:** The new tool will be registered in `lib/ai/tools/tool-list.ts`.
- **Branch:** All development will occur on a new, separate feature branch.

### 4.2. Database Schema
- The Drizzle schema, located in `lib/db/schema.ts`, must be updated to include `context_hotels: text('context_hotels')` in the `userProfiles` table definition. This allows the application to query the user's preferences.

### 4.3. Core Dependencies
- **`@google/generative-ai`**: To power the LLM-based query parsing and response formatting.
- **`serpapi`**: The official Node.js client for making requests to SerpAPI.
- **`ai` (Vercel AI SDK)**: For core functionalities like `tool()` definition and streaming responses.
- **`zod`**: For defining the tool's input parameter schema (i.e., the user `query`).

### 4.4. Prompt Engineering
- The prompts used for the LLM calls will be precisely replicated from the provided `hotel_tool_workflow.json`.
- Modifications will be limited to updating variable placeholders (e.g., `{{ $json.context }}`) to work within the TypeScript environment (e.g., `${userContext}`).

## 5. Exclusions (Initial Version)
- To manage complexity and API costs, the initial version of the tool will not fetch and summarize detailed reviews for each property returned by the initial search. It will focus on presenting the top-level details of the top 5 search results.
- The tool will not initially support complex amenity filtering beyond what is included in the user's natural language query. 