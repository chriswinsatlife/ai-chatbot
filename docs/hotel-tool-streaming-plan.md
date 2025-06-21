# Google Hotels Tool: Streaming UX Improvement Plan

## ⚠️ CRITICAL CONSTRAINTS - DO NOT VIOLATE

**ONLY 5 FILES MAY BE TOUCHED:**
1. `lib/ai/tools/google-hotels.ts` (or new version + backup)
2. `lib/ai/tools/tool-list.ts` (if necessary)
3. `components/hotel.tsx` (new component)
4. `components/message.tsx` (minimal addition)
5. `docs/hotel-tool-streaming-plan.md`

**ABSOLUTELY FORBIDDEN:**
- Reading, editing, or touching ANY other files other than the 5 explicitly listed
- Even if you see code that might "break the deployment" or literally endanger human life - IGNORE IT if not in one of the 5 whitelisted files
- No exceptions, no "just one more file", no "quick fixes", no "handling a linter error", etc

**PERMITTED FILES TO READ ONLY:**
- Other tool components (like `weather.tsx`)
- Other tools (like `get-weather.ts`)
- The n8n JSON workflow file `hotel_tool_workflow.json`
- The original `google-hotel.ts` file
- Directly related files for understanding patterns

---

## Current State Analysis (CORRECTED - ACTUAL IMPLEMENTATION)

After reading the ACTUAL `google-hotels.ts` file, I found:

### Your Actual Implementation
- **Scale**: Processes **20 hotels** via `limitedProperties = searchResults.properties.slice(0, 20)`
- **Architecture**: **Direct TypeScript implementation** - NO n8n workflow calls
- **Models**: Uses `gpt-4.1-mini` for query parsing, `flash-2.5-pro` for review summaries and final formatting
- **API Calls**: Direct SerpAPI HTTP requests in TypeScript

### Actual Google Hotels Tool Flow (TypeScript)
1. **Step 1**: Get user context from database (`getUserContext`)
2. **Step 2**: Parse query with `gpt-4.1-mini` (`parseSearchQuery`) 
3. **Step 3**: Direct SerpAPI call for hotel list (`searchGoogleHotels`)
4. **Step 4**: Limit to 20 properties (`slice(0, 20)`)
5. **Step 5**: For each of the 20 properties:
   - Direct SerpAPI call for property details (`getPropertyDetails`)
   - LLM call with `flash-2.5-pro` to summarize reviews (`summarizeReviews`)
   - Trim unnecessary fields (`trimFields`)
6. **Step 6**: Format final markdown with `flash-2.5-pro` (`formatHotelResults`)

### The Real Problem
**Current State**: User sees nothing for 5-15+ seconds while the system:
- Makes 1 SerpAPI call for hotel list
- Makes up to 20 additional SerpAPI calls for property details
- Makes up to 20 LLM calls for review summaries
- Makes 1 final LLM call for formatting
- **Total: Up to 42 API calls** (1 + 20 + 20 + 1)

**This needs progress feedback** especially for popular destinations with many properties.

## Solution: Add Streaming Progress to Your Current Tool

**Approach**: Modify ONLY the existing `googleHotels` tool to emit progress updates during the multiple API calls.

### Streaming Strategy

Add progress tracking to show:
1. "Getting your hotel preferences..." (database lookup)
2. "Parsing your search request..." (LLM call)
3. "Searching hotels in [destination]..." (initial SerpAPI call)
4. "Reviewing hotel details... (3/20)" (property details calls)
5. "Analyzing reviews... (7/20)" (review summary calls)
6. "Applying hotel preferences and re-ranking..." (final LLM call)

## DETAILED IMPLEMENTATION CHECKLIST

**⚠️ CRITICAL: This implementation will NOT touch `route.ts` or any main application files. Only tool files and UI components.**

### ✅ **STEP ZERO: Version Control & Safety (CRITICAL - DO FIRST)**
- [ ] **Commit current state to GitHub**
  - [ ] Run: `git add . && git commit -m "Pre-hotel-streaming: backup current state" && git push`
- [ ] **Create feature branch**
  - [ ] Run: `git checkout -b feature/hotel-streaming-progress`
- [ ] **Backup the file we'll modify**
  - [ ] Run: `cp lib/ai/tools/google-hotels.ts lib/ai/tools/google-hotels.ts.backup`
- [ ] **Verify backup exists**
  - [ ] Confirm `lib/ai/tools/google-hotels.ts.backup` was created successfully

### ✅ **Phase 1: Modify Existing Google Hotels Tool (ONLY)**
- [ ] **File: `lib/ai/tools/google-hotels.ts`**
  - [ ] Add progress updates during each major step:
    - [ ] After database lookup: "Getting your hotel preferences..."
    - [ ] After query parsing: "Parsing your search request..."
    - [ ] After initial search: "Searching hotels in [destination]..."
    - [ ] During property details loop: "Reviewing hotel details... (X/20)"
    - [ ] During review summary loop: "Analyzing reviews... (X/20)"
    - [ ] Before final formatting: "Applying hotel preferences and re-ranking..."
  - [ ] Test that existing functionality still works 100% with 20 hotel processing
  - [ ] Verify no breaking changes to tool return value

### ✅ **Phase 2: Create Hotel Progress Component (NEW FILE)**
- [ ] **File: `components/hotel.tsx`**
  - [ ] Create React component to display hotel search progress
  - [ ] Handle progress states: preferences, parsing, searching, details (with count), reviews (with count), formatting
  - [ ] Include progress bar for details and review phases (X/20)
  - [ ] Add realistic time estimates ("This may take 5-15 seconds...")
  - [ ] Use your existing UI patterns (shadcn/ui components)
  - [ ] Add spinning loader animation
  - [ ] Test component renders correctly

### ✅ **Phase 3: Update Message Display (MINIMAL ADDITION)**
- [ ] **File: `components/message.tsx`**
  - [ ] Add ONE case for `toolName === 'googleHotels'` following existing pattern
  - [ ] Show progress component during tool call state
  - [ ] Show final results after completion
  - [ ] Test with existing message display logic

### ✅ **Phase 4: Test & Verify (20 Hotel Scale)**
- [ ] **Functionality Test**
  - [ ] Test hotel search in major cities (NYC, Tokyo, London)
  - [ ] Verify all 20 hotels are still processed correctly
  - [ ] Confirm progress updates appear during 5-15 second execution
  - [ ] Verify final markdown results are identical to current version
- [ ] **Performance Test**
  - [ ] Test with different destination types (cities, regions, countries)
  - [ ] Verify progress updates don't slow down the SerpAPI calls
  - [ ] Test error handling if SerpAPI calls fail

### ✅ **Phase 5: Commit & Deploy**
- [ ] **Git Commit**
  - [ ] Run: `git add . && git commit -m "Add streaming progress to Google Hotels tool (10 hotel scale)" && git push`
- [ ] **Create Pull Request**
  - [ ] Test on staging with real hotel searches
  - [ ] Merge feature branch back to main after testing
- [ ] **Deploy to Vercel**
  - [ ] Verify deployment successful
  - [ ] Test live functionality with major cities

## Success Criteria
1. **20 hotel processing** remains exactly the same
2. Users see meaningful progress during the 5-15 second execution
3. Progress updates show realistic hotel processing counts (X/20)
4. No breaking changes to existing direct SerpAPI implementation
5. Final results remain identical in quality and detail

## Why This Matters
Processing 20 hotels with direct SerpAPI calls and comprehensive review analysis requires multiple API calls that can take 5-15+ seconds. The streaming progress will make this operation feel much more responsive to users.
