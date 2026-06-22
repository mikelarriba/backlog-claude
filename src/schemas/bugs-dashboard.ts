import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const BugAnalyzeSchema = z
  .object({
    bugKeys: z
      .array(z.string().min(1))
      .min(1)
      .max(20)
      .openapi({ description: 'Jira bug keys to analyze' }),
  })
  .openapi('BugAnalyze');
