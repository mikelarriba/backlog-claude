// ── OpenAPI registration helpers shared across feature-area path files ────────
import type { z } from 'zod';

export const ok = (description: string) => ({
  200: { description },
});

export const created = (description: string) => ({
  201: { description },
});

export const noContent = () => ({
  204: { description: 'No content' },
});

export const errorResponses = {
  400: { description: 'Validation error' },
  500: { description: 'Internal server error' },
};

export function body(schema: z.ZodTypeAny) {
  return {
    required: true as const,
    content: { 'application/json': { schema } },
  };
}
