// ── OpenAPI paths: server-side export ──────────────────────────────────────────
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { ok } from './shared.js';

export function registerExportPaths(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/export/doc/{type}/{filename}',
    tags: ['Export'],
    summary: 'Export a document',
    request: {
      params: z.object({
        type: z.string().openapi({ description: 'Document type' }),
        filename: z.string().openapi({ description: 'Document filename' }),
      }),
    },
    responses: { ...ok('Exported document'), 404: { description: 'Not found' } },
  });

  registry.registerPath({
    method: 'get',
    path: '/export/roadmap',
    tags: ['Export'],
    summary: 'Export roadmap view',
    responses: ok('Roadmap export'),
  });
}
