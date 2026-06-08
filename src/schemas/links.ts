import { z } from 'zod';

const LinkTypeEnum = z.enum(['blocks', 'parallel', 'hierarchy']);

export const CreateLinkSchema = z.object({
  sourceType: z.string().min(1),
  sourceFilename: z.string().min(1),
  targetType: z.string().min(1),
  targetFilename: z.string().min(1),
  linkType: LinkTypeEnum,
});

export const DeleteLinkSchema = z.object({
  sourceFilename: z.string().min(1),
  targetFilename: z.string().min(1),
  linkType: z.enum(['blocks', 'parallel']),
});
