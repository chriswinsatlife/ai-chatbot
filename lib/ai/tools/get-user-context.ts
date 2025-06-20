import { tool } from 'ai';
import { z } from 'zod';
import { db } from '@/lib/db/queries';
import * as schema from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { generateText } from 'ai';
import { myProvider } from '@/lib/ai/providers';

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

The tool intelligently selects only the most relevant context fields based on your query to avoid overwhelming the response.`,
    parameters: z.object({
      query: z
        .string()
        .describe(
          "Your specific query or the user's request that requires context. This helps the tool select the most relevant information.",
        ),
      contextTypes: z
        .array(
          z.enum([
            'personal',
            'professional',
            'preferences',
            'intelligence',
            'network',
            'purchases',
            'communication',
            'all',
          ]),
        )
        .optional()
        .describe(
          'Optional: Specific types of context to retrieve. If not specified, the tool will intelligently select based on the query.',
        ),
    }),
    execute: async ({ query, contextTypes }) => {
      try {
        console.log(
          `[getUserContext] Executing for userId: ${userId}, query: "${query}"`,
        );

        // First, get the user profile to check what data exists
        const userProfile = await db.query.userProfiles.findFirst({
          where: eq(schema.userProfiles.id, userId),
        });

        if (!userProfile) {
          console.error(
            `[getUserContext] User profile not found for userId: ${userId}`,
          );
          return { error: 'User profile not found' };
        }

        console.log(
          `[getUserContext] Found user profile for: ${userProfile.full_name || 'Unknown'}`,
        );

        let selectedColumns: string[] = [];

        // If contextTypes not specified, use AI to intelligently select columns
        if (!contextTypes || contextTypes.length === 0) {
          console.log(
            `[getUserContext] Using AI to select relevant columns for query: "${query}"`,
          );

          const availableColumns = [
            'context_email_analysis',
            'context_email_writing_style',
            'context_calendar',
            'context_flights',
            'context_hotels',
            'context_vacation_rentals',
            'context_personal_purchases',
            'context_professional_purchases',
            'context_gift_purchases',
            'context_network',
            'context_books',
            'context_daily',
            'context_google_drive_files',
            'pdl_person_data',
            'pdl_org_data',
            'person_deep_research_data',
            'org_deep_research_data',
            'org_website_scrape',
            'context_job_listings_intelligence',
            'context_eng_listings_intelligence',
            'context_marketing_listings_intelligence',
            'context_sales_listings_intelligence',
            'context_product_listings_intelligence',
            'context_company_job_listings',
            'full_name',
            'company_name',
            'job_title',
            'context_location',
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
- context_eng_listings_intelligence: Engineering job market data
- context_marketing_listings_intelligence: Marketing job market data
- context_sales_listings_intelligence: Sales job market data
- context_product_listings_intelligence: Product job market data
- context_company_job_listings: Company's job postings
- full_name, company_name, job_title: Basic identity info
- context_location: Location and geographic context

Return a JSON array of column names that are most relevant to the query. Always include at least one column. Err on the side of including more rather than fewer relevant columns.`,
            prompt: `User Query: "${query}"

Select the most relevant database columns for this query.`,
          });

          try {
            const parsed = JSON.parse(columnSelectionResult.text);
            selectedColumns = Array.isArray(parsed)
              ? parsed
              : parsed.columns || [];
            console.log(
              `[getUserContext] AI selected columns:`,
              selectedColumns,
            );
          } catch (parseError) {
            console.warn(
              `[getUserContext] Failed to parse AI column selection, using fallback:`,
              parseError,
            );
            // Fallback to basic columns if parsing fails
            selectedColumns = [
              'full_name',
              'company_name',
              'job_title',
              'context_daily',
            ];
          }
        } else {
          console.log(
            `[getUserContext] Using specified contextTypes:`,
            contextTypes,
          );

          // Map contextTypes to specific columns
          const typeToColumns: Record<string, string[]> = {
            personal: [
              'full_name',
              'first_name',
              'last_name',
              'email',
              'context_location',
            ],
            professional: [
              'company_name',
              'job_title',
              'pdl_org_data',
              'org_deep_research_data',
              'org_website_scrape',
            ],
            preferences: [
              'context_flights',
              'context_hotels',
              'context_vacation_rentals',
              'context_books',
              'context_daily',
            ],
            intelligence: [
              'person_deep_research_data',
              'org_deep_research_data',
              'context_email_analysis',
              'context_job_listings_intelligence',
            ],
            network: ['context_network', 'context_company_job_listings'],
            purchases: [
              'context_personal_purchases',
              'context_professional_purchases',
              'context_gift_purchases',
            ],
            communication: [
              'context_email_writing_style',
              'context_email_analysis',
            ],
          };

          selectedColumns = contextTypes.flatMap((type) =>
            type === 'all'
              ? Object.values(typeToColumns).flat()
              : typeToColumns[type] || [],
          );
        }

        // Build response with selected data
        const contextData: Record<string, any> = {};
        let totalDataSize = 0;

        for (const column of selectedColumns) {
          const value = userProfile[column as keyof typeof userProfile];
          if (value !== null && value !== undefined && value !== '') {
            // Format the data nicely
            let formattedValue: string;
            if (typeof value === 'object') {
              formattedValue = JSON.stringify(value, null, 2);
            } else {
              formattedValue = String(value);
            }

            contextData[column] = formattedValue;
            totalDataSize += formattedValue.length;
          }
        }

        console.log(
          `[getUserContext] Retrieved ${Object.keys(contextData).length} context fields, total size: ${totalDataSize} characters`,
        );

        // Format response similar to n8n workflow
        const formattedResponse = Object.entries(contextData)
          .map(([key, value]) => `# ${key}:\n\n${value}`)
          .join('\n\n---\n\n')
          .slice(0, 1000000); // Limit to 1M characters

        const tokenEstimate = Math.round(formattedResponse.length / 4.2);

        console.log(
          `[getUserContext] Returning formatted response, estimated tokens: ${tokenEstimate}`,
        );

        return {
          success: true,
          context: formattedResponse,
          selectedColumns,
          message: `Retrieved context for query: "${query}"`,
          tokenEstimate,
        };
      } catch (error) {
        console.error('[getUserContext] Error fetching user context:', error);
        return {
          error: 'Failed to retrieve user context',
          details: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  });
