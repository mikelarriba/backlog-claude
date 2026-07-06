// ── OpenAPI paths: health/metadata, docs CRUD/AI/batch, stories, links ────────
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  DraftDocSchema,
  GenerateDocSchema,
  SplitStorySchema,
  SplitEpicSchema,
  BatchDeleteSchema,
  BatchFixVersionSchema,
  DistributeSchema,
  RerankSchema,
  RerankCanvasSchema,
  ApplyDistributionSchema,
  BatchUpdateFieldSchema,
} from '../../schemas/docs.js';
import { CreateLinkSchema, DeleteLinkSchema } from '../../schemas/links.js';
import { ok, created, noContent, errorResponses, body } from './shared.js';

export function registerDocsComponents(registry: OpenAPIRegistry): void {
  registry.register('DraftDoc', DraftDocSchema);
  registry.register('GenerateDoc', GenerateDocSchema);
  registry.register('SplitStory', SplitStorySchema);
  registry.register('SplitEpic', SplitEpicSchema);
  registry.register('BatchDelete', BatchDeleteSchema);
  registry.register('BatchFixVersion', BatchFixVersionSchema);
  registry.register('Distribute', DistributeSchema);
  registry.register('Rerank', RerankSchema);
  registry.register('RerankCanvas', RerankCanvasSchema);
  registry.register('ApplyDistribution', ApplyDistributionSchema);
  registry.register('BatchUpdateField', BatchUpdateFieldSchema);
  registry.register('CreateLink', CreateLinkSchema);
  registry.register('DeleteLink', DeleteLinkSchema);
}

export function registerDocsPaths(registry: OpenAPIRegistry): void {
  // ── Health & metadata ───────────────────────────────────────────────────
  registry.registerPath({
    method: 'get',
    path: '/health',
    tags: ['System'],
    summary: 'Health check',
    responses: ok('Service is healthy'),
  });

  registry.registerPath({
    method: 'get',
    path: '/config/metadata',
    tags: ['System'],
    summary: 'Get teams and work categories',
    responses: ok('Metadata object'),
  });

  registry.registerPath({
    method: 'get',
    path: '/config',
    tags: ['Settings'],
    summary: 'Get full application configuration',
    responses: ok('Application config'),
  });

  // ── Docs CRUD ───────────────────────────────────────────────────────────
  registry.registerPath({
    method: 'get',
    path: '/docs',
    tags: ['Docs'],
    summary: 'List all documents',
    responses: ok('Array of document summaries'),
  });

  registry.registerPath({
    method: 'get',
    path: '/doc/{type}/{filename}',
    tags: ['Docs'],
    summary: 'Get a single document',
    request: {
      params: z.object({
        type: z.string().openapi({ description: 'Document type' }),
        filename: z.string().openapi({ description: 'Document filename' }),
      }),
    },
    responses: { ...ok('Document content'), 404: { description: 'Not found' } },
  });

  registry.registerPath({
    method: 'patch',
    path: '/doc/{type}/{filename}',
    tags: ['Docs'],
    summary: 'Update fields of a document',
    request: {
      params: z.object({
        type: z.string().openapi({ description: 'Document type' }),
        filename: z.string().openapi({ description: 'Document filename' }),
      }),
    },
    responses: { ...ok('Updated document'), ...errorResponses },
  });

  registry.registerPath({
    method: 'delete',
    path: '/doc/{type}/{filename}',
    tags: ['Docs'],
    summary: 'Delete a document',
    request: {
      params: z.object({
        type: z.string().openapi({ description: 'Document type' }),
        filename: z.string().openapi({ description: 'Document filename' }),
      }),
    },
    responses: { ...noContent(), 404: { description: 'Not found' } },
  });

  registry.registerPath({
    method: 'post',
    path: '/docs/draft',
    tags: ['Docs'],
    summary: 'Create a new draft document',
    request: { body: body(DraftDocSchema) },
    responses: { ...created('Created document'), ...errorResponses },
  });

  registry.registerPath({
    method: 'post',
    path: '/docs/rebuild-index',
    tags: ['Docs'],
    summary: 'Rebuild the document index',
    responses: ok('Index rebuilt'),
  });

  // ── Docs AI ─────────────────────────────────────────────────────────────
  registry.registerPath({
    method: 'post',
    path: '/generate',
    tags: ['AI'],
    summary: 'Generate a document from an idea using AI',
    request: { body: body(GenerateDocSchema) },
    responses: { ...created('Generated document'), ...errorResponses },
  });

  registry.registerPath({
    method: 'post',
    path: '/doc/{type}/{filename}/upgrade',
    tags: ['AI'],
    summary: 'Upgrade a document with AI feedback',
    request: {
      params: z.object({
        type: z.string().openapi({ description: 'Document type' }),
        filename: z.string().openapi({ description: 'Document filename' }),
      }),
    },
    responses: { ...ok('Upgraded document'), ...errorResponses },
  });

  registry.registerPath({
    method: 'post',
    path: '/docs/split-story',
    tags: ['AI'],
    summary: 'Split a story into multiple smaller stories',
    request: { body: body(SplitStorySchema) },
    responses: { ...ok('Split stories'), ...errorResponses },
  });

  registry.registerPath({
    method: 'post',
    path: '/split-epic',
    tags: ['AI'],
    summary: 'Split an epic into features/stories',
    request: { body: body(SplitEpicSchema) },
    responses: { ...ok('Split results'), ...errorResponses },
  });

  // ── Docs Batch ──────────────────────────────────────────────────────────
  registry.registerPath({
    method: 'post',
    path: '/docs/batch-delete',
    tags: ['Docs'],
    summary: 'Delete multiple documents',
    request: { body: body(BatchDeleteSchema) },
    responses: { ...ok('Deletion results'), ...errorResponses },
  });

  registry.registerPath({
    method: 'post',
    path: '/docs/batch-fix-version',
    tags: ['Docs'],
    summary: 'Assign a fix version to multiple documents',
    request: { body: body(BatchFixVersionSchema) },
    responses: { ...ok('Update results'), ...errorResponses },
  });

  registry.registerPath({
    method: 'post',
    path: '/docs/distribute',
    tags: ['Docs'],
    summary: 'Propose sprint distribution for a PI',
    request: { body: body(DistributeSchema) },
    responses: { ...ok('Distribution proposal'), ...errorResponses },
  });

  registry.registerPath({
    method: 'post',
    path: '/docs/rerank',
    tags: ['Docs'],
    summary: 'Rerank documents of a given type',
    request: { body: body(RerankSchema) },
    responses: { ...ok('Rerank result'), ...errorResponses },
  });

  registry.registerPath({
    method: 'post',
    path: '/docs/rerank-canvas',
    tags: ['Docs'],
    summary: 'Rerank canvas items',
    request: { body: body(RerankCanvasSchema) },
    responses: { ...ok('Rerank result'), ...errorResponses },
  });

  registry.registerPath({
    method: 'post',
    path: '/docs/apply-distribution',
    tags: ['Docs'],
    summary: 'Apply sprint assignments from a distribution proposal',
    request: { body: body(ApplyDistributionSchema) },
    responses: { ...ok('Applied assignments'), ...errorResponses },
  });

  registry.registerPath({
    method: 'post',
    path: '/docs/batch-update-field',
    tags: ['Docs'],
    summary: 'Batch update a field on multiple documents',
    request: { body: body(BatchUpdateFieldSchema) },
    responses: { ...ok('Update results'), ...errorResponses },
  });

  // ── Stories ─────────────────────────────────────────────────────────────
  registry.registerPath({
    method: 'get',
    path: '/epics',
    tags: ['Stories'],
    summary: 'List all epics',
    responses: ok('Array of epics'),
  });

  registry.registerPath({
    method: 'get',
    path: '/epic/{filename}',
    tags: ['Stories'],
    summary: 'Get a single epic',
    request: {
      params: z.object({ filename: z.string().openapi({ description: 'Epic filename' }) }),
    },
    responses: { ...ok('Epic document'), 404: { description: 'Not found' } },
  });

  registry.registerPath({
    method: 'get',
    path: '/stories/{filename}',
    tags: ['Stories'],
    summary: 'Get stories for an epic',
    request: {
      params: z.object({ filename: z.string().openapi({ description: 'Epic filename' }) }),
    },
    responses: ok('Array of stories'),
  });

  registry.registerPath({
    method: 'post',
    path: '/stories/{filename}/upgrade-story',
    tags: ['Stories'],
    summary: 'Upgrade a story with AI',
    request: {
      params: z.object({ filename: z.string().openapi({ description: 'Story filename' }) }),
    },
    responses: { ...ok('Upgraded story'), ...errorResponses },
  });

  registry.registerPath({
    method: 'delete',
    path: '/stories/{filename}/story',
    tags: ['Stories'],
    summary: 'Delete a story',
    request: {
      params: z.object({ filename: z.string().openapi({ description: 'Story filename' }) }),
    },
    responses: { ...noContent(), 404: { description: 'Not found' } },
  });

  registry.registerPath({
    method: 'post',
    path: '/epic/{filename}/stories',
    tags: ['Stories'],
    summary: 'Generate stories for an epic',
    request: {
      params: z.object({ filename: z.string().openapi({ description: 'Epic filename' }) }),
    },
    responses: { ...ok('Generated stories'), ...errorResponses },
  });

  // ── Links ────────────────────────────────────────────────────────────────
  registry.registerPath({
    method: 'get',
    path: '/links/{type}/{filename}',
    tags: ['Links'],
    summary: 'Get links for a document',
    request: {
      params: z.object({
        type: z.string().openapi({ description: 'Document type' }),
        filename: z.string().openapi({ description: 'Document filename' }),
      }),
    },
    responses: ok('Links object'),
  });

  registry.registerPath({
    method: 'get',
    path: '/links/feature/{filename}/deep',
    tags: ['Links'],
    summary: 'Get deep link graph for a feature',
    request: {
      params: z.object({ filename: z.string().openapi({ description: 'Feature filename' }) }),
    },
    responses: ok('Deep link graph'),
  });

  registry.registerPath({
    method: 'post',
    path: '/link',
    tags: ['Links'],
    summary: 'Create a link between two documents',
    request: { body: body(CreateLinkSchema) },
    responses: { ...ok('Created link'), ...errorResponses },
  });

  registry.registerPath({
    method: 'delete',
    path: '/link',
    tags: ['Links'],
    summary: 'Delete a link between two documents',
    request: { body: body(DeleteLinkSchema) },
    responses: { ...ok('Deleted'), ...errorResponses },
  });
}
