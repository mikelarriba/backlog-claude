import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const ConfluenceAnalyzeSchema = z
  .object({
    jiraIds: z
      .array(z.string().min(1))
      .min(1)
      .openapi({ description: 'JIRA issue keys to analyze' }),
  })
  .openapi('ConfluenceAnalyze');

const ConfluenceSuggestionSchema = z
  .object({
    pageTitle: z.string().min(1).openapi({ description: 'Confluence page title' }),
    hierarchyPath: z.string().optional().openapi({ description: 'Page hierarchy path' }),
    action: z.enum(['Create', 'Update', 'Delete']).openapi({ description: 'Action to apply' }),
    currentContent: z.string().optional().openapi({ description: 'Current page content' }),
    proposedContent: z.string().optional().openapi({ description: 'Proposed page content' }),
  })
  .openapi('ConfluenceSuggestion');

export const ConfluenceExecuteSchema = z
  .object({
    suggestions: z
      .array(ConfluenceSuggestionSchema)
      .min(1)
      .openapi({ description: 'Suggestions to apply' }),
  })
  .openapi('ConfluenceExecute');
