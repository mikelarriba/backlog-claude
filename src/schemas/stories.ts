import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const UpgradeStorySchema = z
  .object({
    storyIndex: z.number().int().min(0).openapi({ description: 'Index of the story to upgrade' }),
    feedback: z.string().min(1).openapi({ description: 'Feedback to apply' }),
  })
  .openapi('UpgradeStory');

export const DeleteStorySchema = z
  .object({
    storyIndex: z.number().int().min(0).openapi({ description: 'Index of the story to delete' }),
  })
  .openapi('DeleteStory');
