import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

const JiraItemSchema = z
  .object({
    filename: z.string().min(1).openapi({ description: 'Document filename' }),
    docType: z.string().min(1).openapi({ description: 'Document type' }),
  })
  .openapi('JiraItem');

export const JiraPushPreviewSchema = z
  .object({
    items: z
      .array(JiraItemSchema)
      .optional()
      .openapi({ description: 'Items to preview push (all if omitted)' }),
  })
  .openapi('JiraPushPreview');

export const JiraPushSprintsPreviewSchema = z
  .object({
    items: z.array(JiraItemSchema).min(1).openapi({ description: 'Items to push sprint data for' }),
    selectedSprints: z
      .array(z.string())
      .optional()
      .openapi({ description: 'Sprint names to include (all if omitted)' }),
  })
  .openapi('JiraPushSprintsPreview');

export const JiraPushSprintsSchema = z
  .object({
    items: z
      .array(JiraItemSchema)
      .min(1)
      .openapi({ description: 'Items to push sprint assignments for' }),
  })
  .openapi('JiraPushSprints');

export const JiraPushRankSchema = z
  .object({
    key: z.string().min(1).openapi({ description: 'Jira issue key to rank' }),
    beforeKey: z.string().optional().openapi({ description: 'Rank before this issue key' }),
    afterKey: z.string().optional().openapi({ description: 'Rank after this issue key' }),
  })
  .openapi('JiraPushRank');
