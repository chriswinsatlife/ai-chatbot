import { test, expect } from '@playwright/test';
import { getUserContext } from '@/lib/ai/tools/get-user-context';

test.describe('getUserContext tool', () => {
  test('should create tool without errors', async () => {
    // Test that the tool can be created with a valid userId
    const mockUserId = 'test-user-id';
    const tool = getUserContext({ userId: mockUserId });

    expect(tool).toBeDefined();
    expect(tool.description).toContain('User Context Tool');
    expect(tool.parameters).toBeDefined();
  });

  test('should have correct tool structure', async () => {
    const mockUserId = 'test-user-id';
    const tool = getUserContext({ userId: mockUserId });

    // Check that the tool has the expected properties
    expect(tool.description).toContain('retrieve comprehensive information');
    expect(tool.description).toContain('intelligently selects');
    expect(tool.parameters).toBeDefined();
    expect(tool.execute).toBeDefined();
    expect(typeof tool.execute).toBe('function');
  });

  test('should validate parameters correctly', async () => {
    const mockUserId = 'test-user-id';
    const tool = getUserContext({ userId: mockUserId });

    // Test that the tool accepts valid context types
    const validContextTypes = [
      'personal',
      'professional',
      'preferences',
      'intelligence',
      'network',
      'purchases',
      'communication',
      'all',
    ];

    for (const contextType of validContextTypes) {
      expect(() => {
        tool.parameters.parse({
          query: 'test query',
          contextTypes: [contextType],
        });
      }).not.toThrow();
    }
  });

  test('should require query parameter', async () => {
    const mockUserId = 'test-user-id';
    const tool = getUserContext({ userId: mockUserId });

    // Test that query is required
    expect(() => {
      tool.parameters.parse({
        contextTypes: ['personal'],
      });
    }).toThrow();
  });

  test('should accept optional contextTypes parameter', async () => {
    const mockUserId = 'test-user-id';
    const tool = getUserContext({ userId: mockUserId });

    // Test that contextTypes is optional
    expect(() => {
      tool.parameters.parse({
        query: 'test query',
      });
    }).not.toThrow();
  });

  test('should have comprehensive description for AI', async () => {
    const mockUserId = 'test-user-id';
    const tool = getUserContext({ userId: mockUserId });

    // Check that the description includes key information for the AI
    const description = tool.description;
    expect(description).toContain('Personal Information');
    expect(description).toContain('Professional Context');
    expect(description).toContain('Communication Intelligence');
    expect(description).toContain('Travel & Lifestyle Preferences');
    expect(description).toContain('Purchase Intelligence');
    expect(description).toContain('Network Analysis');
    expect(description).toContain('Deep Research Reports');
    expect(description).toContain('Job Market Intelligence');
  });
});

// Note: Integration tests with real database calls would require
// proper test setup with authentication and test data
