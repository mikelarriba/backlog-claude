import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
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
} from '../schemas/docs.js';
import {
  PiSettingsSchema,
  SplitThresholdSchema,
  SprintsSchema,
  ModelSchema,
} from '../schemas/settings.js';
import {
  JiraPushPreviewSchema,
  JiraPushSprintsPreviewSchema,
  JiraPushSprintsSchema,
  JiraPushRankSchema,
} from '../schemas/jira.js';
import { CreateLinkSchema, DeleteLinkSchema } from '../schemas/links.js';
import {
  SkillSaveSchema,
  SkillImproveSchema,
  ProductContextSaveSchema,
} from '../schemas/skills.js';
import { BugAnalyzeSchema } from '../schemas/bugs-dashboard.js';

const ok = (description: string) => ({
  200: { description },
});

const created = (description: string) => ({
  201: { description },
});

const noContent = () => ({
  204: { description: 'No content' },
});

const errorResponses = {
  400: { description: 'Validation error' },
  500: { description: 'Internal server error' },
};

function body(schema: z.ZodTypeAny) {
  return {
    required: true as const,
    content: { 'application/json': { schema } },
  };
}

export function buildOpenApiSpec() {
  const registry = new OpenAPIRegistry();

  // Register all request body schemas as reusable components
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
  registry.register('PiSettings', PiSettingsSchema);
  registry.register('SplitThreshold', SplitThresholdSchema);
  registry.register('Sprints', SprintsSchema);
  registry.register('Model', ModelSchema);
  registry.register('JiraPushPreview', JiraPushPreviewSchema);
  registry.register('JiraPushSprintsPreview', JiraPushSprintsPreviewSchema);
  registry.register('JiraPushSprints', JiraPushSprintsSchema);
  registry.register('JiraPushRank', JiraPushRankSchema);
  registry.register('CreateLink', CreateLinkSchema);
  registry.register('DeleteLink', DeleteLinkSchema);
  registry.register('SkillSave', SkillSaveSchema);
  registry.register('SkillImprove', SkillImproveSchema);
  registry.register('ProductContextSave', ProductContextSaveSchema);
  registry.register('BugAnalyze', BugAnalyzeSchema);

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

  // ── Settings ─────────────────────────────────────────────────────────────
  registry.registerPath({
    method: 'get',
    path: '/settings/pi',
    tags: ['Settings'],
    summary: 'Get current and next PI',
    responses: ok('PI settings'),
  });

  registry.registerPath({
    method: 'put',
    path: '/settings/pi',
    tags: ['Settings'],
    summary: 'Update current and next PI',
    request: { body: body(PiSettingsSchema) },
    responses: { ...ok('Updated PI settings'), ...errorResponses },
  });

  registry.registerPath({
    method: 'get',
    path: '/settings/pi/split-threshold',
    tags: ['Settings'],
    summary: 'Get story split threshold',
    responses: ok('Split threshold value'),
  });

  registry.registerPath({
    method: 'put',
    path: '/settings/pi/split-threshold',
    tags: ['Settings'],
    summary: 'Update story split threshold',
    request: { body: body(SplitThresholdSchema) },
    responses: { ...ok('Updated threshold'), ...errorResponses },
  });

  registry.registerPath({
    method: 'get',
    path: '/settings/pi/sprints/{piName}',
    tags: ['Settings'],
    summary: 'Get sprint configuration for a PI',
    request: {
      params: z.object({ piName: z.string().openapi({ description: 'PI name' }) }),
    },
    responses: ok('Sprint configuration'),
  });

  registry.registerPath({
    method: 'put',
    path: '/settings/pi/sprints/{piName}',
    tags: ['Settings'],
    summary: 'Update sprint configuration for a PI',
    request: {
      params: z.object({ piName: z.string().openapi({ description: 'PI name' }) }),
      body: body(SprintsSchema),
    },
    responses: { ...ok('Updated sprints'), ...errorResponses },
  });

  registry.registerPath({
    method: 'get',
    path: '/settings/providers',
    tags: ['Settings'],
    summary: 'List available AI providers',
    responses: ok('Providers list'),
  });

  registry.registerPath({
    method: 'get',
    path: '/settings/model',
    tags: ['Settings'],
    summary: 'Get current AI model setting',
    responses: ok('Model setting'),
  });

  registry.registerPath({
    method: 'put',
    path: '/settings/model',
    tags: ['Settings'],
    summary: 'Update AI model setting',
    request: { body: body(ModelSchema) },
    responses: { ...ok('Updated model setting'), ...errorResponses },
  });

  // ── Skills ───────────────────────────────────────────────────────────────
  registry.registerPath({
    method: 'get',
    path: '/skills',
    tags: ['Skills'],
    summary: 'List all available skills',
    responses: ok('Array of skill names'),
  });

  registry.registerPath({
    method: 'get',
    path: '/skills/{name}',
    tags: ['Skills'],
    summary: 'Get a skill prompt',
    request: {
      params: z.object({ name: z.string().openapi({ description: 'Skill name' }) }),
    },
    responses: { ...ok('Skill content'), 404: { description: 'Not found' } },
  });

  registry.registerPath({
    method: 'put',
    path: '/skills/{name}',
    tags: ['Skills'],
    summary: 'Save a skill prompt',
    request: {
      params: z.object({ name: z.string().openapi({ description: 'Skill name' }) }),
      body: body(SkillSaveSchema),
    },
    responses: { ...ok('Saved'), ...errorResponses },
  });

  registry.registerPath({
    method: 'delete',
    path: '/skills/{name}',
    tags: ['Skills'],
    summary: 'Delete a skill prompt',
    request: {
      params: z.object({ name: z.string().openapi({ description: 'Skill name' }) }),
    },
    responses: noContent(),
  });

  registry.registerPath({
    method: 'put',
    path: '/skills/{name}/improve',
    tags: ['Skills'],
    summary: 'Improve a skill prompt using AI',
    request: {
      params: z.object({ name: z.string().openapi({ description: 'Skill name' }) }),
      body: body(SkillImproveSchema),
    },
    responses: { ...ok('Improved skill content'), ...errorResponses },
  });

  registry.registerPath({
    method: 'get',
    path: '/settings/product-context',
    tags: ['Skills'],
    summary: 'Get product context',
    responses: ok('Product context content'),
  });

  registry.registerPath({
    method: 'put',
    path: '/settings/product-context',
    tags: ['Skills'],
    summary: 'Save product context',
    request: { body: body(ProductContextSaveSchema) },
    responses: { ...ok('Saved'), ...errorResponses },
  });

  registry.registerPath({
    method: 'delete',
    path: '/settings/product-context',
    tags: ['Skills'],
    summary: 'Delete product context',
    responses: noContent(),
  });

  // ── Canvas ───────────────────────────────────────────────────────────────
  registry.registerPath({
    method: 'get',
    path: '/canvas/layout/{epicFilename}',
    tags: ['Canvas'],
    summary: 'Get canvas layout for an epic',
    request: {
      params: z.object({ epicFilename: z.string().openapi({ description: 'Epic filename' }) }),
    },
    responses: ok('Canvas layout'),
  });

  registry.registerPath({
    method: 'put',
    path: '/canvas/layout/{epicFilename}',
    tags: ['Canvas'],
    summary: 'Save canvas layout for an epic',
    request: {
      params: z.object({ epicFilename: z.string().openapi({ description: 'Epic filename' }) }),
    },
    responses: { ...ok('Saved layout'), ...errorResponses },
  });

  registry.registerPath({
    method: 'delete',
    path: '/canvas/layout/{epicFilename}',
    tags: ['Canvas'],
    summary: 'Delete canvas layout for an epic',
    request: {
      params: z.object({ epicFilename: z.string().openapi({ description: 'Epic filename' }) }),
    },
    responses: noContent(),
  });

  // ── Bugs ─────────────────────────────────────────────────────────────────
  registry.registerPath({
    method: 'post',
    path: '/bugs/create',
    tags: ['Bugs'],
    summary: 'Create a bug report (multipart/form-data)',
    responses: { ...created('Created bug'), ...errorResponses },
  });

  registry.registerPath({
    method: 'get',
    path: '/bugs/attachments/{slug}/{file}',
    tags: ['Bugs'],
    summary: 'Download a bug attachment',
    request: {
      params: z.object({
        slug: z.string().openapi({ description: 'Bug slug' }),
        file: z.string().openapi({ description: 'Attachment filename' }),
      }),
    },
    responses: { 200: { description: 'File content' }, 404: { description: 'Not found' } },
  });

  registry.registerPath({
    method: 'get',
    path: '/bugs/dashboard',
    tags: ['Bugs'],
    summary: 'Get bugs dashboard summary',
    responses: ok('Dashboard data'),
  });

  registry.registerPath({
    method: 'post',
    path: '/bugs/dashboard/analyze',
    tags: ['Bugs'],
    summary: 'Analyze bugs with AI',
    request: { body: body(BugAnalyzeSchema) },
    responses: { ...ok('Analysis results'), ...errorResponses },
  });

  // ── Jira ──────────────────────────────────────────────────────────────────
  registry.registerPath({
    method: 'get',
    path: '/jira/search',
    tags: ['Jira'],
    summary: 'Search Jira issues',
    responses: ok('Search results'),
  });

  registry.registerPath({
    method: 'get',
    path: '/jira/versions',
    tags: ['Jira'],
    summary: 'List Jira fix versions',
    responses: ok('Array of versions'),
  });

  registry.registerPath({
    method: 'get',
    path: '/jira/children/{key}',
    tags: ['Jira'],
    summary: 'Get child issues of a Jira issue',
    request: {
      params: z.object({ key: z.string().openapi({ description: 'Parent Jira issue key' }) }),
    },
    responses: ok('Child issues'),
  });

  registry.registerPath({
    method: 'post',
    path: '/jira/pull',
    tags: ['Jira'],
    summary: 'Pull a Jira issue and create a local doc',
    responses: { ...ok('Created doc'), ...errorResponses },
  });

  registry.registerPath({
    method: 'post',
    path: '/jira/push-preview',
    tags: ['Jira'],
    summary: 'Preview push of local docs to Jira',
    request: { body: body(JiraPushPreviewSchema) },
    responses: { ...ok('Preview results'), ...errorResponses },
  });

  registry.registerPath({
    method: 'post',
    path: '/jira/push/{type}/{filename}',
    tags: ['Jira'],
    summary: 'Push a single doc to Jira',
    request: {
      params: z.object({
        type: z.string().openapi({ description: 'Document type' }),
        filename: z.string().openapi({ description: 'Document filename' }),
      }),
    },
    responses: { ...ok('Pushed'), ...errorResponses },
  });

  registry.registerPath({
    method: 'post',
    path: '/jira/sync-status/{type}/{filename}',
    tags: ['Jira'],
    summary: 'Sync Jira status to a local doc',
    request: {
      params: z.object({
        type: z.string().openapi({ description: 'Document type' }),
        filename: z.string().openapi({ description: 'Document filename' }),
      }),
    },
    responses: { ...ok('Synced'), ...errorResponses },
  });

  registry.registerPath({
    method: 'post',
    path: '/jira/update-from-jira/{docType}/{filename}',
    tags: ['Jira'],
    summary: 'Update local doc from Jira',
    request: {
      params: z.object({
        docType: z.string().openapi({ description: 'Document type' }),
        filename: z.string().openapi({ description: 'Document filename' }),
      }),
    },
    responses: { ...ok('Updated'), ...errorResponses },
  });

  registry.registerPath({
    method: 'post',
    path: '/jira/pull-preview',
    tags: ['Jira'],
    summary: 'Preview pull of Jira issues',
    responses: { ...ok('Preview results'), ...errorResponses },
  });

  registry.registerPath({
    method: 'post',
    path: '/jira/check-all',
    tags: ['Jira'],
    summary: 'Check sync status of all local docs',
    responses: { ...ok('Check results'), ...errorResponses },
  });

  registry.registerPath({
    method: 'post',
    path: '/jira/push-sprints-preview',
    tags: ['Jira'],
    summary: 'Preview push of sprint assignments to Jira',
    request: { body: body(JiraPushSprintsPreviewSchema) },
    responses: { ...ok('Preview results'), ...errorResponses },
  });

  registry.registerPath({
    method: 'post',
    path: '/jira/push-sprints',
    tags: ['Jira'],
    summary: 'Push sprint assignments to Jira',
    request: { body: body(JiraPushSprintsSchema) },
    responses: { ...ok('Push results'), ...errorResponses },
  });

  registry.registerPath({
    method: 'post',
    path: '/jira/pull-sprint-preview',
    tags: ['Jira'],
    summary: 'Preview pull of Jira sprint data',
    responses: { ...ok('Preview results'), ...errorResponses },
  });

  registry.registerPath({
    method: 'post',
    path: '/jira/pull-sprint',
    tags: ['Jira'],
    summary: 'Pull Jira sprint data to local docs',
    responses: { ...ok('Pull results'), ...errorResponses },
  });

  registry.registerPath({
    method: 'post',
    path: '/jira/push-rank',
    tags: ['Jira'],
    summary: 'Update Jira issue rank',
    request: { body: body(JiraPushRankSchema) },
    responses: { ...ok('Ranked'), ...errorResponses },
  });

  // ── Export ────────────────────────────────────────────────────────────────
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

  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Backlog Claude API',
      version: '1.0.0',
      description: 'REST API for the Backlog Claude backlog management tool.',
    },
    servers: [{ url: '/api', description: 'API base' }],
  });
}
