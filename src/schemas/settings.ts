import { z } from 'zod';

export const PiSettingsSchema = z.object({
  currentPi: z.string().optional(),
  nextPi: z.string().optional(),
});

export const SplitThresholdSchema = z.object({
  splitThreshold: z.number().int().min(1).max(50),
});

export const SprintsSchema = z.object({
  sprints: z
    .array(
      z.object({
        name: z.string().min(1),
        capacity: z.number().int().min(0).max(999),
      })
    )
    .min(1)
    .max(10),
});

export const ModelSchema = z.object({
  model: z.string().optional(),
  provider: z.string().optional(),
});
