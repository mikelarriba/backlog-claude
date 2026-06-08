import { z } from 'zod';

const JiraItemSchema = z.object({
  filename: z.string().min(1),
  docType: z.string().min(1),
});

export const JiraPushPreviewSchema = z.object({
  items: z.array(JiraItemSchema).optional(),
});

export const JiraPushSprintsPreviewSchema = z.object({
  items: z.array(JiraItemSchema).min(1),
  selectedSprints: z.array(z.string()).optional(),
});

export const JiraPushSprintsSchema = z.object({
  items: z.array(JiraItemSchema).min(1),
});

export const JiraPushRankSchema = z.object({
  key: z.string().min(1),
  beforeKey: z.string().optional(),
  afterKey: z.string().optional(),
});
