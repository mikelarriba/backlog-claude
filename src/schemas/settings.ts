import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const PiSettingsSchema = z
  .object({
    currentPi: z.string().optional().openapi({ description: 'Current program increment name' }),
    nextPi: z.string().optional().openapi({ description: 'Next program increment name' }),
  })
  .openapi('PiSettings');

export const SplitThresholdSchema = z
  .object({
    splitThreshold: z.number().int().min(1).max(50).openapi({
      description: 'Story point threshold above which a story is suggested for splitting',
    }),
  })
  .openapi('SplitThreshold');

export const SprintsSchema = z
  .object({
    sprints: z
      .array(
        z.object({
          name: z.string().min(1).openapi({ description: 'Sprint name' }),
          capacity: z
            .number()
            .int()
            .min(0)
            .max(999)
            .openapi({ description: 'Sprint capacity in story points' }),
        })
      )
      .min(1)
      .max(10)
      .openapi({ description: 'Sprint definitions for the PI' }),
  })
  .openapi('Sprints');

export const ModelSchema = z
  .object({
    model: z.string().nullable().optional().openapi({ description: 'AI model identifier' }),
    provider: z.string().nullable().optional().openapi({ description: 'AI provider name' }),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).nullable().optional().openapi({
      description: 'Reasoning-effort level for the claude-cli provider (low/medium/high/xhigh/max)',
    }),
  })
  .openapi('Model');
