declare module 'ai' {
  // Basic utility types used across the codebase. Replace `any` with more
  // specific shapes if/when the upstream SDK ships official type defs.
  export type DataStreamWriter = any;
  export type CoreMessage = any;
  export type Message = any;
  export type UIMessage = any;
  export type LanguageModelV1StreamPart = any;

  // Functions
  export const tool: any;
  export const streamText: any;
  export const streamObject: any;
  export const smoothStream: any;
  export const generateText: any;
  export const experimental_createMCPClient: any;
  export const experimental_generateImage: any;
  export const generateId: any;
  export const simulateReadableStream: any;
  export const appendResponseMessages: any;
  export const createDataStreamResponse: any;
  export const appendClientMessage: any;
  export const convertToCoreMessages: any;
  export const Attachment: any;
  export const LanguageModelV1: any;
  export const LanguageModelV1CallOptions: any;
  export const LanguageModelV1Prompt: any;
  export const UnsupportedFunctionalityError: any;
  export const customProvider: any;
  export type CoreAssistantMessage = any;
  export type CoreToolMessage = any;

  // Catch-all default export for any default-import patterns
  const _default: any;
  export default _default;
}