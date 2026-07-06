// ── OpenAPI paths: settings, skills, canvas, bugs ─────────────────────────────
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  PiSettingsSchema,
  SplitThresholdSchema,
  SprintsSchema,
  ModelSchema,
} from '../../schemas/settings.js';
import {
  SkillSaveSchema,
  SkillImproveSchema,
  ProductContextSaveSchema,
} from '../../schemas/skills.js';
import { BugAnalyzeSchema } from '../../schemas/bugs-dashboard.js';
import { ok, created, noContent, errorResponses, body } from './shared.js';

export function registerPlatformComponents(registry: OpenAPIRegistry): void {
  registry.register('PiSettings', PiSettingsSchema);
  registry.register('SplitThreshold', SplitThresholdSchema);
  registry.register('Sprints', SprintsSchema);
  registry.register('Model', ModelSchema);
  registry.register('SkillSave', SkillSaveSchema);
  registry.register('SkillImprove', SkillImproveSchema);
  registry.register('ProductContextSave', ProductContextSaveSchema);
  registry.register('BugAnalyze', BugAnalyzeSchema);
}

export function registerPlatformPaths(registry: OpenAPIRegistry): void {
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
}
