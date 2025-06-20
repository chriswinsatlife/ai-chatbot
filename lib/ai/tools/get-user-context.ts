import { tool, generateText } from 'ai';
import { z } from 'zod';
import { db } from '@/lib/db/queries';
import * as schema from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
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

        // If contextTypes not specified, use the ORIGINAL n8n workflow logic to choose columns
        if (!contextTypes || contextTypes.length === 0) {
          console.log(
            `[getUserContext] [n8n-style] Selecting columns via GPT-4 for query: "${query}"`,
          );

          // ------------------------------------------------------------------
          // 1. Fetch table schema from information_schema so we can build the
          //    <User_Database_Columns> block exactly as the n8n workflow did.
          // ------------------------------------------------------------------
          const rawSchema = await db.execute(
            `SELECT column_name, data_type
             FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'User_Profiles';`,
          );

          // 2. Filter out metadata / low-signal columns exactly like the n8n Set node
          const columnBlacklist = [
            'id',
            'created_at',
            'modified_at',
            'clerk_id',
            'google_refresh_token',
            'job_title',
            'email',
          ];

          const schemaRows: any[] = Array.isArray(rawSchema)
            ? (rawSchema as any[])
            : (rawSchema as any).rows;

          const availableColumnsArr = schemaRows
            .filter(
              (r: any) =>
                !columnBlacklist.includes(r.column_name) &&
                !r.column_name.includes('name'),
            )
            .map((r: any) => `\t${r.column_name}: ${r.data_type}`)
            .sort();

          const availableColumnsStr = availableColumnsArr.join('\n');

          // 3. Build the ORIGINAL prompt (verbatim, trimmed for variables)
          const prompt = `<context>
You are an assistant in an AI chat application. The user has sent a message or request which may require additional context to answer or fulfill comprehensively.

For each user's client, we have several <User_Database_Columns> which are itemized below. These are often very lengthy, so we cannot include all (or even many) in every system prompt, since this would overload the context window for the LLM.

Your role is to identify which columns are most directly or indirectly relevant to the query/message. You must return a JSON array of column names, which are listed below.

Most of these columns are generated from the client's SaaS account data.
- For example, calendar, email, network, and drive context are analyses of multiple years of email threads, calendar events, and work artifacts (including collaborators or correspondents).
- Similarly, the context for flights, hotels, personal and gift purchases, and so on are detailed (50k+ characters) reports from an AI on the client's past data.
- Context_Daily includes information about all recent activity across all connected SaaS applications, typically the last 24h or 7d.
- PDL is shorthand for People Data Labs, a B2B enrichment API service. It mostly has demographic and firmographic data about businesses and individuals, and is not very detailed.
- Deep research refers to lengthy reports compiled by an AI assistant with complete web access, such as OpenAI's ChatGPT or Google Gemini using their latest research features.
- "Person" refers to ${userProfile.full_name ?? 'the client'}, whose title is ${userProfile.job_title ?? 'unknown title'} at ${userProfile.company_name ?? 'unknown company'}.
- "Company" refers to ${userProfile.company_name ?? 'the client company'}, the client's primary company.
</context>

<Guidelines>
- Based on the below <User_Message> and <Search_Query>, please output the names of the columns from the <User_Database_Columns> which may include relevant information.
- Err on the side of more rather than fewer columns.
- You must always output at least one column name.
- Output JSON according to the schema.
</Guidelines>

<Current_DateTime>
${new Date().toString()}
</Current_DateTime>

<User_Database_Columns>
${availableColumnsStr}
</User_Database_Columns>

<User_Message>
${query}
</User_Message>

<Search_Query>
${query}
</Search_Query>`;

          const columnSelectionResult = await generateText({
            model: myProvider.languageModel('gpt-4.1'), // exact model from legacy n8n workflow
            system: prompt,
            prompt:
              'Return a JSON object that matches the schema {"columns": ["column_a", "column_b", ...]}',
          });

          const attemptParse = (txt: string): string[] | null => {
            try {
              const parsed = JSON.parse(txt);
              return Array.isArray(parsed) ? parsed : parsed.columns;
            } catch {
              return null;
            }
          };

          selectedColumns = attemptParse(columnSelectionResult.text) || [];

          // 4. If parse failed, run an auto-fix pass (mirrors Output Parser Autofixing)
          if (selectedColumns.length === 0) {
            console.warn(
              '[getUserContext] Initial parse failed – running auto-fix pass',
            );
            const fixResult = await generateText({
              model: myProvider.languageModel('gpt-4.1-mini'),
              system: `Fix the following text so that it is *exactly* valid JSON matching the schema {"columns": ["..."]}. Only output JSON.`,
              prompt: columnSelectionResult.text,
            });
            selectedColumns = attemptParse(fixResult.text) || [];
          }

          if (selectedColumns.length === 0) {
            console.error(
              '[getUserContext] Failed to obtain column list even after auto-fix',
            );
            return { error: 'Column selection failed' };
          }

          console.log(
            '[getUserContext] GPT-4 selected columns:',
            selectedColumns,
          );
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
