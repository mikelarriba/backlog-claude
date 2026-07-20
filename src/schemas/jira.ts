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

const JiraSprintPreviewItemSchema = z
  .object({
    filename: z.string().min(1).openapi({ description: 'Document filename' }),
    sprint: z.string().nullable().openapi({ description: 'Local sprint name, or null' }),
    jiraId: z.string().openapi({ description: 'JIRA issue key, or empty if not yet pushed' }),
    title: z.string().openapi({ description: 'Local document title' }),
    docType: z.string().min(1).openapi({ description: 'Document type' }),
  })
  .openapi('JiraSprintPreviewItem');

export const JiraPushSprintsPreviewSchema = z
  .object({
    items: z
      .array(JiraSprintPreviewItemSchema)
      .min(1)
      .openapi({ description: 'Items to push sprint data for' }),
    selectedSprints: z
      .array(z.string())
      .optional()
      .openapi({ description: 'Sprint names to include (all if omitted)' }),
  })
  .openapi('JiraPushSprintsPreview');

const JiraSprintPushItemSchema = z
  .object({
    filename: z.string().min(1).openapi({ description: 'Document filename' }),
    sprint: z.string().nullable().openapi({ description: 'Target local sprint name, or null' }),
    changeType: z.string().min(1).openapi({ description: 'One of "push", "pull", or "remove"' }),
    jiraId: z
      .string()
      .optional()
      .openapi({ description: 'JIRA issue key (resolved from the index if omitted)' }),
    docType: z
      .string()
      .optional()
      .openapi({ description: 'Document type (resolved from the index if omitted)' }),
  })
  .openapi('JiraSprintPushItem');

export const JiraPushSprintsSchema = z
  .object({
    items: z
      .array(JiraSprintPushItemSchema)
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

export const JiraPullSchema = z
  .object({
    keys: z.array(z.string()).min(1).openapi({ description: 'JIRA issue keys to pull' }),
    overwriteKeys: z
      .array(z.string())
      .optional()
      .openapi({ description: 'Keys that should overwrite existing local files' }),
    parentLink: z
      .object({
        docType: z.enum(['epic', 'feature']).openapi({ description: 'Parent document type' }),
        filename: z.string().min(1).openapi({ description: 'Parent document filename' }),
      })
      .nullable()
      .optional()
      .openapi({ description: 'Optional parent document to link pulled issues under' }),
  })
  .openapi('JiraPull');
