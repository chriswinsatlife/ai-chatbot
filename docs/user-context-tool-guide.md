# User Context Lookup Tool - Implementation Guide

## Overview

This guide explains how to create an AI tool that can look up user context information from the `User_Profiles` table in our Supabase database. The tool will allow the AI assistant to access rich user context data to provide more personalized responses.

## Database Schema Context

### User_Profiles Table Structure

The `User_Profiles` table contains extensive user context information:

**Core Identity Fields:**
- `id` (uuid) - Primary key, used for relationships with Chat, Message_v2, etc.
- `clerk_id` (text) - Unique identifier from Clerk authentication
- `email` (varchar) - User's email address
- `created_at`, `modified_at` - Timestamps

**Personal Information:**
- `full_name`, `first_name`, `last_name` - User's name information
- `xp_full_name`, `xp_first_name`, `xp_last_name` - User's executive assistant (XP - "Executive Partner") name
- `company_name`, `job_title` - Professional information

**Rich Context Data (JSONB/Text fields):**
- `pdl_person_data` (jsonb) - People Data Labs person information
- `pdl_org_data` (jsonb) - People Data Labs organization information
- `person_deep_research_data` (text) - Deep research on the person
- `org_deep_research_data` (text) - Deep research on their organization
- `org_website_scrape` (text) - Scraped website content for client company

**Contextual Intelligence Fields:**
- `context_flights` - Flight preferences/history
- `context_location` - Location information
- `context_calendar` - Calendar context
- `context_hotels` - Hotel preferences
- `context_vacation_rentals` - Vacation rental preferences
- `context_email_analysis` - Email analysis insights
- `context_email_writing_style` - User's writing style
- `context_google_drive_files` - Google Drive file context
- `context_network` - Professional network information
- `context_books` - Reading preferences
- `context_personal_purchases` - Personal purchase history
- `context_professional_purchases` - Professional purchase history
- `context_daily` - Daily routine/habits
- `context_gift_purchases` - Gift giving patterns
- `context_company_job_listings` - Company job postings
- `context_job_listings_intelligence` - Job market intelligence
- `context_eng_listings_intelligence` - Engineering job intelligence
- `context_marketing_listings_intelligence` - Marketing job intelligence
- `context_sales_listings_intelligence` - Sales job intelligence
- `context_product_listings_intelligence` - Product job intelligence

**Integration Tokens:**
- `google_refresh_token` - For Google API access

## Current Authentication Flow

The application uses Clerk for authentication with the following flow:

1. **Clerk Authentication**: User authenticates via Clerk
2. **Profile Lookup**: Internal UUID is retrieved from `User_Profiles` table using `clerk_id`
3. **Database Operations**: All database operations use the internal UUID (`User_Profiles.id`)

### Example Auth Pattern (from existing code):
```typescript
// Get Clerk user ID
const { userId: clerkUserId } = await auth();
if (!clerkUserId) {
  return new Response('Unauthorized', { status: 401 });
}

// Look up internal profile UUID
const profile = await db.query.userProfiles.findFirst({
  columns: { id: true },
  where: eq(schema.userProfiles.clerkId, clerkUserId),
});
if (!profile) {
  return new Response('User profile not found', { status: 404 });
}

const userId = profile.id; // This is the UUID used for database operations
```

## Implementation Plan

### 1. Create the User Context Tool

Create a new file: `lib/ai/tools/get-user-context.ts`

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import { db } from '@/lib/db/queries';
import * as schema from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

interface GetUserContextProps {
  userId: string; // This is the internal UUID from User_Profiles.id
}

export const getUserContext = ({ userId }: GetUserContextProps) =>
  tool({
    description: `Use the "User Context Tool" to retrieve comprehensive information about the current user from their profile, past conversations, AI research, and connected SaaS applications.

This tool provides access to rich, personalized context that enables highly tailored responses. The tool has built-in intelligence to return relevant user information based on your query.

Available context includes:
- **Personal Information**: Full name, contact details, location, and basic demographics
- **Professional Context**: Company name, job title, organizational data, and career information  
- **Communication Intelligence**: Email writing style analysis, communication patterns, and preferences derived from years of email threads and interactions
- **Travel & Lifestyle Preferences**: Detailed reports (50k+ characters) on flight preferences, hotel choices, vacation rental patterns, and travel history
- **Purchase Intelligence**: Comprehensive analysis of personal purchases, professional purchases, and gift-giving patterns
- **Calendar & Schedule Context**: Analysis of calendar events, meeting patterns, and scheduling preferences
- **Network Analysis**: Professional network mapping, collaborators, and relationship context from email threads and work artifacts
- **Daily Activity Context**: Recent activity across all connected SaaS applications, typically covering the last 24-72 hours
- **Deep Research Reports**: Lengthy AI-compiled reports on the user, their company, related organizations, and industry context using web research
- **Content & File Context**: Analysis of Google Drive files, documents, and work artifacts
- **Reading & Learning Preferences**: Book preferences, learning patterns, and intellectual interests
- **Job Market Intelligence**: Analysis of job listings, career opportunities, and industry trends relevant to the user

Most context fields contain lengthy AI summaries (often 10k-50k+ characters) generated from the user's connected SaaS account data, historical records, and research. These provide deep insights into preferences, patterns, and context that span multiple years of data.

Use this tool when you need to:
- Personalize recommendations or advice
- Understand user preferences for travel, purchases, or professional decisions  
- Access communication style for writing assistance
- Leverage professional context for business-related queries
- Provide contextually relevant suggestions based on past behavior
- Reference the user's network, company, or industry knowledge

The user's identity and professional context are key anchors for providing relevant, personalized assistance.`,
    parameters: z.object({
      contextTypes: z.array(z.enum([
        'personal', // name, basic info
        'professional', // company, job title
        'preferences', // hotels, flights, books, etc.
        'intelligence', // deep research, analysis
        'network', // professional network
        'purchases', // purchase history
        'communication', // email style, writing patterns
        'all' // return all available context
      ])).optional().describe('Specific types of context to retrieve. If not specified, returns basic personal and professional info.'),
    }),
    execute: async ({ contextTypes = ['personal', 'professional'] }) => {
      try {
        // Query user profile with selected fields based on context types
        const userProfile = await db.query.userProfiles.findFirst({
          where: eq(schema.userProfiles.id, userId),
        });

        if (!userProfile) {
          return {
            error: 'User profile not found',
          };
        }

        // Build response based on requested context types
        const context: any = {};

        if (contextTypes.includes('all') || contextTypes.includes('personal')) {
          context.personal = {
            fullName: userProfile.full_name,
            firstName: userProfile.first_name,
            lastName: userProfile.last_name,
            email: userProfile.email,
            location: userProfile.context_location,
          };
        }

        if (contextTypes.includes('all') || contextTypes.includes('professional')) {
          context.professional = {
            companyName: userProfile.company_name,
            jobTitle: userProfile.job_title,
            orgData: userProfile.pdl_org_data,
            orgResearch: userProfile.org_deep_research_data,
            orgWebsiteScrape: userProfile.org_website_scrape,
          };
        }

        if (contextTypes.includes('all') || contextTypes.includes('preferences')) {
          context.preferences = {
            flights: userProfile.context_flights,
            hotels: userProfile.context_hotels,
            vacationRentals: userProfile.context_vacation_rentals,
            books: userProfile.context_books,
            daily: userProfile.context_daily,
          };
        }

        if (contextTypes.includes('all') || contextTypes.includes('intelligence')) {
          context.intelligence = {
            personResearch: userProfile.person_deep_research_data,
            orgResearch: userProfile.org_deep_research_data,
            emailAnalysis: userProfile.context_email_analysis,
            jobListingsIntelligence: userProfile.context_job_listings_intelligence,
          };
        }

        if (contextTypes.includes('all') || contextTypes.includes('network')) {
          context.network = {
            professionalNetwork: userProfile.context_network,
            companyJobListings: userProfile.context_company_job_listings,
          };
        }

        if (contextTypes.includes('all') || contextTypes.includes('purchases')) {
          context.purchases = {
            personal: userProfile.context_personal_purchases,
            professional: userProfile.context_professional_purchases,
            gifts: userProfile.context_gift_purchases,
          };
        }

        if (contextTypes.includes('all') || contextTypes.includes('communication')) {
          context.communication = {
            emailWritingStyle: userProfile.context_email_writing_style,
            emailAnalysis: userProfile.context_email_analysis,
          };
        }

        return {
          success: true,
          context,
          message: `Retrieved ${contextTypes.join(', ')} context for user`,
        };

      } catch (error) {
        console.error('Error fetching user context:', error);
        return {
          error: 'Failed to retrieve user context',
        };
      }
    },
  });
```

### 2. Add Tool to Tool List

Update `lib/ai/tools/tool-list.ts`:

```typescript
import { getUserContext } from './get-user-context';

export async function assembleTools({
  userId,
  dataStream,
  chatId,
}: ToolArguments) {
  // ... existing code ...

  const standardTools = {
    getWeather,
    createDocument: createDocument({ userId, dataStream, chatId }),
    updateDocument: updateDocument({ userId, dataStream }),
    requestSuggestions: requestSuggestions({ userId, dataStream }),
    googleHotels: googleHotels({ userId }),
    getUserContext: getUserContext({ userId }), // Add the new tool
  };

  // ... rest of function
}
```

### 3. Update Chat Route to Include Tool

The tool will automatically be available in the chat route since it's added to the tool list. The `userId` parameter is already available in the chat route from the authentication flow.

### 4. Handle Tool Response in UI (Optional)

If you want special UI handling for user context responses, update `components/message.tsx`:

```typescript
// In the tool call handling section
{toolName === 'getUserContext' ? (
  <div className="text-sm text-muted-foreground">
    Retrieving user context...
  </div>
) : (
  // ... existing tool handling
)}

// In the tool result handling section
{toolName === 'getUserContext' ? (
  <div className="text-sm">
    <div className="font-medium">User context retrieved</div>
    <div className="text-muted-foreground">
      The assistant now has access to your personalized context.
    </div>
  </div>
) : (
  // ... existing result handling
)}
```

## Usage Examples

### Basic Usage
The AI can call this tool automatically when it needs user context:

```
User: "Book me a hotel in San Francisco"
AI: *calls getUserContext with ['preferences', 'professional']*
AI: "Based on your preference for business hotels and your work at [Company], I'll help you find a suitable hotel in San Francisco..."
```

### Specific Context Types
```
User: "Help me write an email to my team"
AI: *calls getUserContext with ['communication', 'professional']*
AI: "Based on your writing style and role as [Job Title] at [Company], here's a draft email..."
```

## Key Features of the Proposed Tool:

- **Selective Context Retrieval**: Uses `contextTypes` parameter to only fetch needed data
- **Rich Context Categories**: Personal, professional, preferences, intelligence, network, purchases, communication
- **Security-First**: Only accesses data for the authenticated user
- **Flexible**: Can retrieve specific context types or all available context
- **Error Handling**: Graceful handling of missing data or errors
- **Integration Ready**: Designed to work with existing authentication and tool systems

## Analysis of Previous n8n Implementation

The old n8n Client Context Tool workflow provides valuable insights for enhancing our implementation:

### Intelligent Column Selection
The n8n workflow used a two-stage AI approach:
1. **Column Selection AI**: First AI call analyzes the user query and selects only relevant database columns
2. **Context Retrieval**: Second stage retrieves only the selected columns, avoiding context window overload

### Key Insights from n8n Workflow:

**Smart Filtering Logic:**
```javascript
// The n8n workflow filtered out basic columns to focus on rich context:
.filter(item => item.json.column_name !== "id")
.filter(item => item.json.column_name !== "created_at") 
.filter(item => item.json.column_name !== "modified_at")
.filter(item => item.json.column_name !== "clerk_id")
.filter(item => item.json.column_name !== "google_refresh_token")
.filter(item => item.json.column_name !== "job_title")
.filter(item => item.json.column_name !== "email")
.filter(item => !item.json.column_name.includes("name"))
```

**Intelligent Query Analysis:**
The workflow used a sophisticated prompt to determine relevant columns:
- Analyzed both user message and search query
- Considered context about data types and sources
- Applied business logic about what data is most relevant
- Always returned at least one column to ensure useful results

**Response Formatting:**
```javascript
// Formatted response with clear section headers and proper JSON handling
return `# ${k}:\n\n${valueString}`;
// Joined with separators: .join('\n\n---\n\n')
// Limited to 1M characters to prevent overload
```

### Enhanced Tool Implementation

Based on the n8n analysis, here's an improved version of our tool:

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import { db } from '@/lib/db/queries';
import * as schema from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { generateText } from 'ai';
import { myProvider } from '@/lib/ai/providers';

interface GetUserContextProps {
  userId: string;
}

export const getUserContext = ({ userId }: GetUserContextProps) =>
  tool({
    description: `Use the "User Context Tool" to retrieve comprehensive information about the current user from their profile, past conversations, AI research, and connected SaaS applications.

This tool provides access to rich, personalized context that enables highly tailored responses. The tool has built-in intelligence to return relevant user information based on your query.

Available context includes:
- **Personal Information**: Full name, contact details, location, and basic demographics
- **Professional Context**: Company name, job title, organizational data, and career information  
- **Communication Intelligence**: Email writing style analysis, communication patterns, and preferences derived from years of email threads and interactions
- **Travel & Lifestyle Preferences**: Detailed reports (50k+ characters) on flight preferences, hotel choices, vacation rental patterns, and travel history
- **Purchase Intelligence**: Comprehensive analysis of personal purchases, professional purchases, and gift-giving patterns
- **Calendar & Schedule Context**: Analysis of calendar events, meeting patterns, and scheduling preferences
- **Network Analysis**: Professional network mapping, collaborators, and relationship context from email threads and work artifacts
- **Daily Activity Context**: Recent activity across all connected SaaS applications, typically covering the last 24-72 hours
- **Deep Research Reports**: Lengthy AI-compiled reports on the user, their company, related organizations, and industry context using web research
- **Content & File Context**: Analysis of Google Drive files, documents, and work artifacts
- **Reading & Learning Preferences**: Book preferences, learning patterns, and intellectual interests
- **Job Market Intelligence**: Analysis of job listings, career opportunities, and industry trends relevant to the user

Most context fields contain lengthy AI summaries (often 10k-50k+ characters) generated from the user's connected SaaS account data, historical records, and research. These provide deep insights into preferences, patterns, and context that span multiple years of data.

Use this tool when you need to:
- Personalize recommendations or advice
- Understand user preferences for travel, purchases, or professional decisions  
- Access communication style for writing assistance
- Leverage professional context for business-related queries
- Provide contextually relevant suggestions based on past behavior
- Reference the user's network, company, or industry knowledge

The tool intelligently selects only the most relevant context fields based on your query to avoid overwhelming the response.`,
    parameters: z.object({
      query: z.string().describe('Your specific query or the user\'s request that requires context. This helps the tool select the most relevant information.'),
      contextTypes: z.array(z.enum([
        'personal', 'professional', 'preferences', 'intelligence', 
        'network', 'purchases', 'communication', 'all'
      ])).optional().describe('Optional: Specific types of context to retrieve. If not specified, the tool will intelligently select based on the query.'),
    }),
    execute: async ({ query, contextTypes }) => {
      try {
        // First, get the user profile to check what data exists
        const userProfile = await db.query.userProfiles.findFirst({
          where: eq(schema.userProfiles.id, userId),
        });

        if (!userProfile) {
          return { error: 'User profile not found' };
        }

        let selectedColumns: string[] = [];

        // If contextTypes not specified, use AI to intelligently select columns
        if (!contextTypes || contextTypes.length === 0) {
          const availableColumns = [
            'context_email_analysis', 'context_email_writing_style', 'context_calendar',
            'context_flights', 'context_hotels', 'context_vacation_rentals',
            'context_personal_purchases', 'context_professional_purchases', 'context_gift_purchases',
            'context_network', 'context_books', 'context_daily', 'context_google_drive_files',
            'pdl_person_data', 'pdl_org_data', 'person_deep_research_data', 'org_deep_research_data',
            'org_website_scrape', 'context_job_listings_intelligence', 'context_eng_listings_intelligence',
            'context_marketing_listings_intelligence', 'context_sales_listings_intelligence',
            'context_product_listings_intelligence', 'context_company_job_listings',
            'full_name', 'company_name', 'job_title', 'context_location'
          ];

          // Use AI to select relevant columns based on the query
          const columnSelectionResult = await generateText({
            model: myProvider.languageModel('artifact-model'),
            system: `You are analyzing a user query to determine which database columns contain relevant context information.

Available columns and their contents:
- context_email_analysis: Analysis of email patterns and communication style
- context_email_writing_style: User's writing style and preferences  
- context_calendar: Calendar events and scheduling patterns
- context_flights: Flight preferences and travel history
- context_hotels: Hotel preferences and booking patterns
- context_vacation_rentals: Vacation rental preferences
- context_personal_purchases: Personal purchase history and preferences
- context_professional_purchases: Professional/business purchase patterns
- context_gift_purchases: Gift giving patterns and preferences
- context_network: Professional network and collaborators
- context_books: Reading preferences and book interests
- context_daily: Recent daily activity across SaaS apps
- context_google_drive_files: Analysis of files and documents
- pdl_person_data: Demographic and professional data
- pdl_org_data: Company and organizational data
- person_deep_research_data: Deep research on the person
- org_deep_research_data: Deep research on their company
- org_website_scrape: Company website content analysis
- context_job_listings_intelligence: Job market analysis
- context_*_listings_intelligence: Role-specific job market data
- context_company_job_listings: Company's job postings
- full_name, company_name, job_title: Basic identity info
- context_location: Location and geographic context

Return a JSON array of column names that are most relevant to the query. Always include at least one column. Err on the side of including more rather than fewer relevant columns.`,
            prompt: `User Query: "${query}"

Select the most relevant database columns for this query.`,
          });

          try {
            const parsed = JSON.parse(columnSelectionResult.text);
            selectedColumns = Array.isArray(parsed) ? parsed : parsed.columns || [];
          } catch {
            // Fallback to basic columns if parsing fails
            selectedColumns = ['full_name', 'company_name', 'job_title', 'context_daily'];
          }
        } else {
          // Map contextTypes to specific columns
          const typeToColumns = {
            personal: ['full_name', 'first_name', 'last_name', 'email', 'context_location'],
            professional: ['company_name', 'job_title', 'pdl_org_data', 'org_deep_research_data', 'org_website_scrape'],
            preferences: ['context_flights', 'context_hotels', 'context_vacation_rentals', 'context_books', 'context_daily'],
            intelligence: ['person_deep_research_data', 'org_deep_research_data', 'context_email_analysis', 'context_job_listings_intelligence'],
            network: ['context_network', 'context_company_job_listings'],
            purchases: ['context_personal_purchases', 'context_professional_purchases', 'context_gift_purchases'],
            communication: ['context_email_writing_style', 'context_email_analysis'],
          };

          selectedColumns = contextTypes.flatMap(type => 
            type === 'all' ? Object.values(typeToColumns).flat() : typeToColumns[type] || []
          );
        }

        // Build response with selected data
        const contextData: Record<string, any> = {};
        
        for (const column of selectedColumns) {
          const value = userProfile[column as keyof typeof userProfile];
          if (value !== null && value !== undefined && value !== '') {
            // Format the data nicely
            if (typeof value === 'object') {
              contextData[column] = JSON.stringify(value, null, 2);
            } else {
              contextData[column] = String(value);
            }
          }
        }

        // Format response similar to n8n workflow
        const formattedResponse = Object.entries(contextData)
          .map(([key, value]) => `# ${key}:\n\n${value}`)
          .join('\n\n---\n\n')
          .slice(0, 1000000); // Limit to 1M characters

        return {
          success: true,
          context: formattedResponse,
          selectedColumns,
          message: `Retrieved context for query: "${query}"`,
          tokenEstimate: Math.round(formattedResponse.length / 4.2),
        };

      } catch (error) {
        console.error('Error fetching user context:', error);
        return { error: 'Failed to retrieve user context' };
      }
    },
  });
```

### Key Improvements from n8n Analysis:

1. **Intelligent Column Selection**: Uses AI to analyze the query and select only relevant columns
2. **Query-Driven Context**: Takes a `query` parameter to understand what context is needed
3. **Formatted Response**: Returns well-formatted context with clear section headers
4. **Token Estimation**: Provides token count estimate for context management
5. **Fallback Logic**: Graceful handling when AI column selection fails
6. **Data Validation**: Checks for null/empty values before including in response
7. **Size Limiting**: Prevents context window overload with 1M character limit

This approach combines the intelligence of the n8n workflow with the simplicity of our AI SDK tool pattern.