# Plan Status: Enhance Artifact Generation to Respect User Instructions

## Checklist

*   🟢 **Tool Definitions (`create-document.ts`, `update-document.ts`):** Add `instructions` parameter and pass down.
*   🟢 **Generic Handler (`lib/artifacts/server.ts`):** Update interfaces and handler logic to propagate `instructions`.
*   🟢 **Specific Handlers (`text`, `textv2`, `sheet`, `image`, `code`):** Update signatures and incorporate `instructions` into secondary prompts.
*   🟢 **Tool Descriptions:** Update descriptions in tool definition files to instruct primary LLM to extract instructions (Handled within Tool Definitions task).

*(**Legend:** 🔴 = Not Started, 🟡 = In Progress, 🟢 = Done)*

---

## Instructions for Updating This File

Whenever a code change related to this plan is implemented and **successfully tested**:

1.  Locate the corresponding checklist item above.
2.  Update the emoji status marker:
    *   Change 🔴 to 🟡 when work begins on a section.
    *   Change 🟡 to 🟢 when a section is fully implemented and tested.
3.  Add brief notes below the checklist item if necessary (e.g., mentioning specific PRs or partial completion details).

---

## 1. Goal

Modify the artifact creation and update process so that specific instructions mentioned by the user in their chat message (e.g., "write a one-line document", "create a sheet with 3 columns", "generate a black and white image") are considered by the AI model generating the actual artifact content.

## 2. Problem Summary

The current system loses context between the user's initial request and the final content generation step for artifacts:

1.  The main chat LLM receives the user's full request, including instructions.
2.  It calls a tool (`createDocument` or `updateDocument`) and passes only high-level information derived from the request (like `title`, `kind`, or `description`).
3.  The tool then delegates the actual content generation to a specific *artifact handler* (`text`, `textv2`, `sheet`, `image`, `code`).
4.  This handler makes a *secondary, independent call* to an AI model (`streamText`, `streamObject`, `experimental_generateImage`) using *only* the limited information (`title` or `description`) it received from the tool.
5.  Crucially, this secondary AI call lacks the context of the original user's instructions (e.g., length, style, column count), leading to generated content that doesn't meet those requirements.

## 3. Solution Strategy

Introduce a mechanism to pass relevant instruction information from the user's message through the entire tool-calling chain:

1.  Modify the tool definitions (`createDocument`, `updateDocument`) to accept an optional `instructions` parameter.
2.  Update the main API route logic to instruct the primary LLM to extract these instructions from the user message and pass them when calling the tools.
3.  Propagate this `instructions` parameter through the generic document handler wrapper (`createDocumentHandler`) down to the specific artifact handlers.
4.  Modify each specific artifact handler (`text`, `textv2`, `sheet`, `image`, `code`) to use the received `instructions` when constructing the prompt for its secondary AI call, guiding the final content generation.

## 4. Detailed File Modifications (Plan Only - No Execution)

The following files need modification. **No changes will be made automatically based on this plan.** Implementation requires careful coding and testing.

---

**File 1: `lib/ai/tools/create-document.ts`**

*   **Purpose:** Define the `createDocument` tool available to the main LLM.
*   **Required Changes:**
    *   **Add `instructions` parameter:** Modify the `zod` schema within `tool({...})` to include an optional `instructions` string field.
      ```typescript
      // Inside tool({ parameters: z.object({ ... }) })
      title: z.string(),
      kind: z.enum(artifactKinds),
      instructions: z.string().optional().describe('Specific user instructions like length, style, format, etc., extracted from the user query.') // <-- ADD THIS
      ```
    *   **Update `execute`:** Modify the `execute` function signature to accept `instructions`.
      ```typescript
      execute: async ({ title, kind, instructions }) => { // <-- ADD instructions HERE
        // ... existing code ...
      }
      ```
    *   **Pass `instructions` down:** When calling `documentHandler.onCreateDocument`, pass the `instructions` value.
      ```typescript
      // Inside execute:
      await documentHandler.onCreateDocument({
        id,
        title,
        chatId,
        dataStream,
        userId: userId,
        instructions, // <-- ADD THIS
      });
      ```
    *   **Update Tool Description:** Modify the `description` string within `tool({...})` to instruct the LLM to populate the new `instructions` field.
        *   *Example Wording:* `Create a document... If the user specifies instructions (e.g., length, style, format), extract them and pass them in the 'instructions' parameter.`

---

**File 2: `lib/ai/tools/update-document.ts`**

*   **Purpose:** Define the `updateDocument` tool available to the main LLM.
*   **Required Changes:**
    *   **Add `instructions` parameter:** Modify the `zod` schema within `tool({...})` to include an optional `instructions` string field.
      ```typescript
      // Inside tool({ parameters: z.object({ ... }) })
      id: z.string().describe('The ID of the document to update'),
      description: z.string().describe('The description of changes that need to be made'),
      instructions: z.string().optional().describe('Specific user instructions like length, style, format, etc., extracted from the user query relevant to the update.') // <-- ADD THIS
      ```
    *   **Update `execute`:** Modify the `execute` function signature to accept `instructions`.
      ```typescript
      execute: async ({ id, description, instructions }) => { // <-- ADD instructions HERE
         // ... existing code ...
      }
      ```
    *   **Pass `instructions` down:** When calling `documentHandler.onUpdateDocument`, pass the `instructions` value.
      ```typescript
      // Inside execute:
      await documentHandler.onUpdateDocument({
        document,
        description,
        dataStream,
        userId: userId,
        instructions, // <-- ADD THIS
      });
      ```
    *   **Update Tool Description:** Modify the `description` string within `tool({...})` to instruct the LLM to populate the new `instructions` field.
        *   *Example Wording:* `Update a document... If the user specifies instructions relevant to the update (e.g., length, style, format), extract them and pass them in the 'instructions' parameter.`

---

**File 3: `lib/artifacts/server.ts`**

*   **Purpose:** Defines the generic handler wrapper and interfaces.
*   **Required Changes:**
    *   **Update Interfaces:** Add `instructions?: string` to `CreateDocumentCallbackProps` and `UpdateDocumentCallbackProps`.
      ```typescript
      export interface CreateDocumentCallbackProps {
        // ... existing fields ...
        userId: string;
        instructions?: string; // <-- ADD THIS
      }

      export interface UpdateDocumentCallbackProps {
        // ... existing fields ...
        userId: string;
        instructions?: string; // <-- ADD THIS
      }
      ```
    *   **Update `createDocumentHandler`:**
        *   Modify the signatures of the expected `onCreateDocument` and `onUpdateDocument` functions within the config passed to `createDocumentHandler` to include the optional `instructions` parameter.
          ```typescript
          // Inside createDocumentHandler function definition
          onCreateDocument: (params: { /* ..., */ userId: string; instructions?: string }) => Promise<string | object>;
          onUpdateDocument: (params: { /* ..., */ userId: string; instructions?: string }) => Promise<string | object>;
          ```
        *   Pass the `instructions` received in `args` down to the specific handler calls (`config.onCreateDocument` and `config.onUpdateDocument`).
          ```typescript
          // Inside the wrapped onCreateDocument:
          const draftResult = await config.onCreateDocument({
            // ... existing args ...
            instructions: args.instructions, // <-- ADD THIS
          });

          // Inside the wrapped onUpdateDocument:
          const draftResult = await config.onUpdateDocument({
            // ... existing args ...
            instructions: args.instructions, // <-- ADD THIS
          });
          ```

---

**Files 4-8: Specific Handlers (`artifacts/text/server.ts`, `artifacts/textv2/server.ts`, `artifacts/sheet/server.ts`, `artifacts/code/server.ts`, `artifacts/image/server.ts`)**

*   **Purpose:** Implement the actual content generation logic for each artifact type.
*   **Required Changes (for each file):**
    *   **Update Function Signatures:** Modify the `onCreateDocument` and `onUpdateDocument` function signatures within each handler (e.g., `textDocumentHandler`, `sheetDocumentHandler`, etc.) to accept the new optional `instructions?: string` parameter passed down from the generic handler.
      ```typescript
      // Example for artifacts/text/server.ts
      onCreateDocument: async ({ title, dataStream, userId, instructions }) => { // <-- ADD instructions HERE
        // ...
      },
      onUpdateDocument: async ({ document, description, dataStream, userId, instructions }) => { // <-- ADD instructions HERE
        // ...
      },
      ```
    *   **Incorporate Instructions into Secondary Prompts:** This is the most critical part and requires careful prompt engineering for each handler. Modify the logic where the secondary AI call (`streamText`, `streamObject`, `experimental_generateImage`) is made. Inject the `instructions` text into the `system` prompt or the main `prompt` appropriately.
        *   **Conceptual Example (text handler `onCreateDocument`):**
          ```typescript
          // Inside onCreateDocument:
          const systemPrompt = `Write about the given topic. Markdown is supported. Use headings wherever appropriate. ${instructions ? `IMPORTANT: Adhere to the following user instructions: ${instructions}` : ''}`;
          const prompt = title;
          // ... call streamText using the modified systemPrompt ...
          ```
        *   **Conceptual Example (image handler `onCreateDocument`):**
          ```typescript
          // Inside onCreateDocument:
          const finalPrompt = `${title}${instructions ? `. Style/Instructions: ${instructions}` : ''}`;
          const { image } = await experimental_generateImage({
            model: /*...*/,
            prompt: finalPrompt, // <-- Use combined prompt
            n: 1,
          });
          ```
        *   The exact phrasing and placement will need refinement for each artifact type to ensure the secondary model understands and prioritizes the instructions.

---

**File 9: `app/(chat)/api/chat/route.ts`**

*   **Purpose:** Handles the main chat interaction and calls the tools.
*   **Required Changes:**
    *   **None directly:** As noted in the plan, the necessary changes to instruct the primary LLM happen within the tool descriptions themselves (Files 1 & 2), not within this file's direct logic.

---

## 5. Important Considerations

*   **No Execution:** This document is purely a plan. No code changes are being made.
*   **Prompt Engineering:** The effectiveness of this solution heavily relies on crafting good prompts for *both* the primary LLM (via tool descriptions) and the secondary LLM (via updated handler prompts) to correctly extract and apply the instructions. This may require iteration and testing.
*   **LLM Capability:** The success depends on the primary LLM's ability to consistently identify and extract relevant instructions from varied user phrasing and pass them correctly.
*   **Complexity:** This change touches multiple layers of the application (tool definitions, generic handler, specific handlers). Careful implementation and testing are crucial to avoid breaking existing functionality. 