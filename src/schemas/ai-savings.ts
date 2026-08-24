import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { ACTION_TYPES } from '../services/aiSavingsService.js';

extendZodWithOpenApi(z);

// Derived from ACTION_TYPES (aiSavingsService's BENCHMARK_MINUTES keys) so this
// schema can't silently drift out of sync with the service's supported action types.
export const AiSavingsActionTypeSchema = z.enum(ACTION_TYPES);

export const AiSavingsLogSchema = z
  .object({
    action_type: AiSavingsActionTypeSchema.openapi({ description: 'Type of AI-assisted action' }),
    item_count: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .openapi({ description: 'Number of items processed by the action' }),
    jira_keys: z
      .array(z.string())
      .optional()
      .openapi({ description: 'JIRA keys associated with the action, if any' }),
    notes: z.string().max(2000).optional().openapi({ description: 'Optional free-text note' }),
  })
  .openapi('AiSavingsLog');
