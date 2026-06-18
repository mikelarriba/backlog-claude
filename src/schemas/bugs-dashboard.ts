import { z } from 'zod';

export const BugAnalyzeSchema = z.object({
  bugKeys: z.array(z.string().min(1)).min(1).max(20),
});
