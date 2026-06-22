import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const KNOWN_SKILLS = [
  'create-features',
  'create-epics',
  'create-stories',
  'create-spikes',
  'create-bugs',
  'refine-epics',
  'backlog-analysis-agent',
] as const;

export const SkillNameSchema = z.enum(KNOWN_SKILLS).openapi({
  description: 'Known skill name',
});

export const SkillSaveSchema = z
  .object({
    content: z
      .string()
      .min(1, 'Content cannot be empty')
      .openapi({ description: 'Skill prompt content' }),
  })
  .openapi('SkillSave');

export const SkillImproveSchema = z
  .object({
    content: z
      .string()
      .min(1, 'Content cannot be empty')
      .openapi({ description: 'Current skill content to improve' }),
  })
  .openapi('SkillImprove');

export const ProductContextSaveSchema = z
  .object({
    content: z
      .string()
      .min(1, 'Content cannot be empty')
      .openapi({ description: 'Product context content' }),
  })
  .openapi('ProductContextSave');
