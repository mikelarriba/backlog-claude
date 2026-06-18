import { z } from 'zod';

export const KNOWN_SKILLS = [
  'create-features',
  'create-epics',
  'create-stories',
  'create-spikes',
  'create-bugs',
  'refine-epics',
  'backlog-analysis-agent',
] as const;

export const SkillNameSchema = z.enum(KNOWN_SKILLS);

export const SkillSaveSchema = z.object({
  content: z.string().min(1, 'Content cannot be empty'),
});

export const SkillImproveSchema = z.object({
  content: z.string().min(1, 'Content cannot be empty'),
});

export const ProductContextSaveSchema = z.object({
  content: z.string().min(1, 'Content cannot be empty'),
});
