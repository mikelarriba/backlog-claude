import { z } from 'zod';

const DocTypeEnum = z.enum(['feature', 'epic', 'story', 'spike', 'bug']);
const PriorityEnum = z.enum(['Critical', 'High', 'Medium', 'Low']);

const DocItemSchema = z.object({
  type: z.string().min(1),
  filename: z.string().min(1),
});

export const DraftDocSchema = z.object({
  type: DocTypeEnum.optional(),
  title: z.string().min(1).max(200),
  idea: z.string().max(5000).optional(),
  priority: PriorityEnum.optional(),
  parentEpic: z.string().optional(),
  parentFeature: z.string().optional(),
  fixVersion: z.string().optional(),
  team: z.string().optional(),
  workCategory: z.string().optional(),
});

export const GenerateDocSchema = z.object({
  idea: z.string().min(1).max(5000),
  title: z.string().max(200).optional(),
  type: DocTypeEnum.optional(),
  priority: PriorityEnum.optional(),
  parentFeature: z.string().optional(),
  parentEpic: z.string().optional(),
  fixVersion: z.string().optional(),
  team: z.string().optional(),
  workCategory: z.string().optional(),
  pi: z.string().optional(),
});

export const UpgradeDocSchema = z.object({
  feedback: z.string().min(1),
});

export const SplitStorySchema = z.object({
  filename: z.string().min(1),
  docType: z.string().min(1),
  targetCount: z.number().int().min(2).max(20).optional(),
  sprints: z.array(z.string()).optional(),
});

export const SplitEpicSchema = z.object({
  epicFilename: z.string().min(1),
  description: z.string().min(1).max(5000),
});

export const BatchDeleteSchema = z.object({
  docs: z.array(DocItemSchema).min(1),
});

export const BatchFixVersionSchema = z.object({
  fixVersion: z.string().min(1),
  docs: z.array(DocItemSchema).min(1),
});

export const DistributeSchema = z.object({
  piName: z.string().min(1),
});

export const RerankSchema = z.object({
  type: z.string().min(1),
  orderedFilenames: z.array(z.string()).min(1),
});

export const RerankCanvasSchema = z.object({
  items: z
    .array(
      z.object({
        filename: z.string().min(1),
        docType: z.string().min(1),
        rank: z.number(),
      })
    )
    .min(1),
});

export const ApplyDistributionSchema = z.object({
  assignments: z
    .array(
      z.object({
        docType: z.string().min(1),
        filename: z.string().min(1),
        sprint: z.string().min(1),
      })
    )
    .min(1),
});

export const BatchUpdateFieldSchema = z.object({
  field: z.enum(['sprint', 'team', 'workCategory']),
  value: z.string(),
  docs: z.array(DocItemSchema).min(1),
});
