# Gift Finder Tool: Streaming UX Improvement Plan

## 1. Overview

This document outlines the plan to implement a streaming user experience for the new Gift Finder tool. The primary objective is to provide real-time feedback to the user while the tool performs multi-step web research to find personalized gift ideas. This approach will make the process feel more responsive and transparent.

## 2. Implementation Plan

### Phase 1: Create Gift Finder Tool (`lib/ai/tools/gift-finder.ts`)
- A new tool file will be created to house the core logic.
- It will accept a user's natural language query (e.g., "birthday gift for dad").
- It will define a `tool` using the Vercel AI SDK, with a Zod schema for parameters like `recipient`, `occasion`, and `interests`.
- The tool will use a `dataStream` to send progress updates back to the UI.

### Phase 2: Implement Multi-Step Gift Research
The tool's `run` function will execute the following steps, emitting a progress event at each stage:
1.  **Get User Context**: Fetch the recipient's gift history and preferences from `context_gift_purchases` in the `User_Profiles` table.
    -   *Stream Event*: `{ stage: 'context', message: 'Analyzing gift history for [Recipient]...' }`
2.  **Parse Query**: Use an LLM call to parse the user's query and context into a structured search plan.
    -   *Stream Event*: `{ stage: 'parsing', message: 'Figuring out the best gifts...' }`
3.  **Web Research**: Make parallel calls to a web-browsing LLM function. Each call will target one of the specified websites (The Strategist, Wirecutter, etc.) to find gift ideas, prices, and links.
    -   *Stream Event*: `{ stage: 'searching', message: 'Searching for gifts on [Website]...', current: X, total: Y }`
4.  **Format Results**: Use a final LLM call to synthesize the findings from all sources, remove duplicates, and format the output as a clean, user-friendly markdown list.
    -   *Stream Event*: `{ stage: 'formatting', message: 'Putting together your personalized gift list...' }`

### Phase 3: Create Gift Progress UI Component (`components/gift.tsx`)
- A new React component will be created to display the streaming progress.
- It will be modeled after the existing `flight.tsx` and `hotel.tsx` components.
- It will receive the `gift-progress` events from the data stream.
- It will display a series of messages, icons, and potentially a progress bar to reflect the current stage of the research process.

### Phase 4: Integrate into Message Display (`components/message.tsx` or similar)
- The main component responsible for rendering chatbot messages will be updated.
- It will need a new case to handle the `'gift-finder'` tool call and render the `GiftProgress` component when the tool is active.

### Phase 5: Documentation
- **PRD**: Create `docs/gift-finder-tool-prd.md` to document the tool's features, technical specifications, and goals.
- **Streaming Plan**: This document, `docs/gift-tool-streaming-plan.md`, will serve as the implementation guide for the streaming UX.

## 3. Technical Details

### Progress Event Structure
The tool will emit progress events with the following structure:
```typescript
{
  type: 'gift-progress',
  content: {
    stage: 'context' | 'parsing' | 'searching' | 'formatting',
    message: string,
    current?: number, // For progress tracking (e.g., websites searched)
    total?: number,   // Total number of websites to search
    website?: string  // The current website being searched
  }
}
```

### UI/UX
- The `GiftProgress` component will show a user-friendly message for each stage.
- When searching websites, it will show "Searching 1 of 8: The Strategist", "Searching 2 of 8: Wirecutter", etc. to give a clear indication of progress.
- The final formatted list of gifts will replace the progress indicator once the tool execution is complete.

## 4. Summary

By implementing a streaming UX for the Gift Finder tool, we can provide a much better user experience for a potentially long-running operation. The user will be kept informed of the progress, making the wait feel shorter and the tool more interactive. 