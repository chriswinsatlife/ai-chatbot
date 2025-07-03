# Gift Finder Chatbot Tool - Product Requirements Document

## 1. Objective

To integrate a Gift Finder search tool into the existing Vercel AI SDK-based chatbot. This tool will allow users to search for gift ideas using natural language, with the chatbot providing formatted, context-aware results including real-time pricing, purchase links, and personalized recommendations.

## 2. Background

The tool's functionality is designed to be a new, powerful addition to the chatbot's capabilities. It will leverage the model's own web-browsing abilities to find novel gift ideas from a curated list of sources. The goal is to bring this capability directly into the chatbot's backend, leveraging the Vercel AI SDK for seamless integration, tool definition, and response streaming. This will create a more unified and efficient user experience for gift discovery.

## 3. Key Features

### 3.1. Natural Language Query Processing
The tool must accept a user's free-form text query (e.g., "Birthday gift for Meghan", "Anniversary gift for my husband, he likes tech") and parse it to identify key entities like the recipient, occasion, and interests.

### 3.2. User Context Integration
- The tool will fetch user-specific gift preferences and history from the `context_gift_purchases` column in the `User_Profiles` table in the Supabase database.
- This context (e.g., "recipient likes handmade items," "has previously received a smart watch," "prefers sustainable brands") will be injected into the LLM prompts to influence both the search and the final ranking/formatting of results, making the recommendations personalized and avoiding duplicates.

### 3.3. Web-based Research Integration
- The core gift search functionality will be powered by a secondary LLM call that instructs the model to browse a specific list of websites.
- The websites to be used are: Thing Testing, The Strategist, Wirecutter, Kinja Deals, Business Insider Picks, Kit, Goody, and Alex Kwa.
- The tool will be responsible for extracting product names, prices, and direct purchase links from these sites.

### 3.4. Multi-Step Implementation Logic
The tool will execute a chain of actions to fulfill a user's request:
1.  **Parse Query & Get Context:** An initial step will parse the user's query and retrieve the `context_gift_purchases` for the recipient.
2.  **Research Gifts:** A secondary, parallelized LLM call will be made to search the approved websites for gift ideas based on the query and context. The prompt will explicitly ask for unique items with current pricing and purchase links.
3.  **Format Results:** A final LLM call will take the raw JSON from the research step and format it into a user-friendly, markdown-based summary with gift details, pricing, and purchase links.

### 3.5. Advanced Gift Search Capabilities
- **Recipient Profiling:** Ability to generate ideas based on general profiles (e.g., "for a teenage girl who loves music").
- **Occasion-based Suggestions:** Tailor suggestions for birthdays, anniversaries, holidays, etc.
- **Interest-based Filtering:** Filter and sort based on interests like technology, fashion, home goods, travel, etc.
- **De-duplication:** Ensure that gift suggestions are unique and not repeated from previous purchases or within the current results.

### 3.6. Streaming UI Feedback
To enhance user experience, the tool will use the Vercel AI SDK's streaming capabilities to provide real-time updates on its progress, such as:
- "Getting gift history for [Recipient]..."
- "Searching for gift ideas on The Strategist..."
- "Finding prices and links..."
- "Putting together a list of personalized gift options..."

## 4. Technical Specifications

### 4.1. File Structure & Naming
- **Tool Logic:** The tool's logic will be implemented in `lib/ai/tools/gift-finder.ts`.
- **Registration:** The tool will be registered in the main tool list.
- **UI Component:** Gift results will be displayed using a new `components/gift.tsx` component.

### 4.2. Database Schema
- The tool will access the `context_gift_purchases: text('context_gift_purchases')` column in the `User_Profiles` table to retrieve user-specific gift history and preferences.

### 4.3. Core Dependencies
- **`@ai-sdk/google` / `@ai-sdk/openai`**: Powers the LLM-based query parsing and response formatting.
- **`ai` (Vercel AI SDK)**: For core functionalities like `tool()` definition and streaming responses.
- **`zod`**: For defining the gift search parameter schemas.

### 4.4. Prompt Engineering
- Prompts will be engineered to perform research on specific websites.
- The result formatting prompt will focus on creating a clear, actionable list of gift ideas with all necessary details.

## 5. Response Format

### 5.1. Structured Output
The tool returns comprehensive gift information including:
- **Gift Options:** Detailed descriptions of each gift idea.
- **Pricing:** Real-time price for the item.
- **Purchase Links:** Direct URLs to buy the product.
- **Recommendations:** AI-powered suggestions based on user preferences and context.
- **Source:** The website where the gift idea was found.

### 5.2. Markdown Formatting
Results are formatted as structured markdown with:
- Clear headings for each gift suggestion.
- Recommended options may be highlighted.
- Clickable purchase URLs.

## 6. Exclusions (Initial Version)

- The tool provides purchase links but does not handle the actual purchase.
- Real-time stock availability is not checked.
- The tool will focus on a curated list of websites and not the entire internet. 