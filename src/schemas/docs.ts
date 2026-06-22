import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

const DocTypeEnum = z.enum(['feature', 'epic', 'story', 'spike', 'bug']).openapi({
  description: 'Document type',
});
const PriorityEnum = z.enum(['Critical', 'High', 'Medium', 'Low']).openapi({
  description: 'Priority level',
});

const DocItemSchema = z
  .object({
    type: z.string().min(1).openapi({ description: 'Document type' }),
    filename: z.string().min(1).openapi({ description: 'Document filename' }),
  })
  .openapi('DocItem');

export const DraftDocSchema = z
  .object({
    type: DocTypeEnum.optional(),
    title: z.string().min(1).max(200).openapi({ description: 'Document title' }),
    idea: z.string().max(5000).optional().openapi({ description: 'Idea description' }),
    priority: PriorityEnum.optional(),
    parentEpic: z.string().optional().openapi({ description: 'Parent epic filename' }),
    parentFeature: z.string().optional().openapi({ description: 'Parent feature filename' }),
    fixVersion: z.string().optional().openapi({ description: 'Fix version' }),
    team: z.string().optional().openapi({ description: 'Team name' }),
    workCategory: z.string().optional().openapi({ description: 'Work category' }),
  })
  .openapi('DraftDoc');

export const GenerateDocSchema = z
  .object({
    idea: z.string().min(1).max(5000).openapi({ description: 'Idea to generate doc from' }),
    title: z.string().max(200).optional().openapi({ description: 'Optional title' }),
    type: z.string().optional().openapi({ description: 'Document type' }),
    priority: PriorityEnum.optional(),
    parentFeature: z.string().optional().openapi({ description: 'Parent feature filename' }),
    parentEpic: z.string().optional().openapi({ description: 'Parent epic filename' }),
    fixVersion: z.string().optional().openapi({ description: 'Fix version' }),
    team: z.string().optional().openapi({ description: 'Team name' }),
    workCategory: z.string().optional().openapi({ description: 'Work category' }),
    pi: z.string().optional().openapi({ description: 'Program increment name' }),
  })
  .openapi('GenerateDoc');

export const UpgradeDocSchema = z
  .object({
    feedback: z.string().min(1).openapi({ description: 'Feedback for the upgrade' }),
  })
  .openapi('UpgradeDoc');

export const SplitStorySchema = z
  .object({
    filename: z.string().min(1).openapi({ description: 'Story filename to split' }),
    docType: z.string().min(1).openapi({ description: 'Document type' }),
    targetCount: z
      .number()
      .int()
      .min(2)
      .max(20)
      .optional()
      .openapi({ description: 'Number of stories to split into' }),
    sprints: z
      .array(z.string())
      .optional()
      .openapi({ description: 'Sprint names for distribution' }),
  })
  .openapi('SplitStory');

export const SplitEpicSchema = z
  .object({
    epicFilename: z.string().min(1).openapi({ description: 'Epic filename to split' }),
    description: z.string().min(1).max(5000).openapi({ description: 'Description for the split' }),
  })
  .openapi('SplitEpic');

export const BatchDeleteSchema = z
  .object({
    docs: z.array(DocItemSchema).min(1).openapi({ description: 'Documents to delete' }),
  })
  .openapi('BatchDelete');

export const BatchFixVersionSchema = z
  .object({
    fixVersion: z
      .string()
      .nullable()
      .openapi({ description: 'Fix version to assign (null to clear)' }),
    docs: z.array(DocItemSchema).min(1).openapi({ description: 'Documents to update' }),
  })
  .openapi('BatchFixVersion');

export const DistributeSchema = z
  .object({
    piName: z.string().min(1).openapi({ description: 'Program increment name' }),
  })
  .openapi('Distribute');

export const RerankSchema = z
  .object({
    type: z.string().min(1).openapi({ description: 'Document type to rerank' }),
    orderedFilenames: z
      .array(z.string())
      .min(1)
      .openapi({ description: 'Filenames in desired order' }),
  })
  .openapi('Rerank');

export const RerankCanvasSchema = z
  .object({
    items: z
      .array(
        z.object({
          filename: z.string().min(1).openapi({ description: 'Document filename' }),
          docType: z.string().min(1).openapi({ description: 'Document type' }),
          rank: z.number().openapi({ description: 'Rank value' }),
        })
      )
      .min(1)
      .openapi({ description: 'Canvas items with new ranks' }),
  })
  .openapi('RerankCanvas');

export const ApplyDistributionSchema = z
  .object({
    assignments: z
      .array(
        z.object({
          docType: z.string().min(1).openapi({ description: 'Document type' }),
          filename: z.string().min(1).openapi({ description: 'Document filename' }),
          sprint: z.string().min(1).openapi({ description: 'Sprint name' }),
        })
      )
      .min(1)
      .openapi({ description: 'Sprint assignments to apply' }),
  })
  .openapi('ApplyDistribution');

export const BatchUpdateFieldSchema = z
  .object({
    field: z.enum(['sprint', 'team', 'workCategory']).openapi({ description: 'Field to update' }),
    value: z.string().openapi({ description: 'New value' }),
    docs: z.array(DocItemSchema).min(1).openapi({ description: 'Documents to update' }),
  })
  .openapi('BatchUpdateField');
