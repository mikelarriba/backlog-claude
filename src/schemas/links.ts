import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

const LinkTypeEnum = z.enum(['blocks', 'parallel', 'hierarchy']).openapi({
  description: 'Type of link between documents',
});

export const CreateLinkSchema = z
  .object({
    sourceType: z.string().min(1).openapi({ description: 'Source document type' }),
    sourceFilename: z.string().min(1).openapi({ description: 'Source document filename' }),
    targetType: z.string().min(1).openapi({ description: 'Target document type' }),
    targetFilename: z.string().min(1).openapi({ description: 'Target document filename' }),
    linkType: LinkTypeEnum.optional(),
  })
  .openapi('CreateLink');

export const DeleteLinkSchema = z
  .object({
    sourceFilename: z.string().min(1).openapi({ description: 'Source document filename' }),
    targetFilename: z.string().min(1).openapi({ description: 'Target document filename' }),
    linkType: z.enum(['blocks', 'parallel']).openapi({ description: 'Type of link to delete' }),
  })
  .openapi('DeleteLink');
