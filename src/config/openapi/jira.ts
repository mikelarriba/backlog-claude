// ── OpenAPI paths: JIRA integration ───────────────────────────────────────────
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  JiraPushPreviewSchema,
  JiraPushSprintsPreviewSchema,
  JiraPushSprintsSchema,
  JiraPushRankSchema,
} from '../../schemas/jira.js';
import { ok, errorResponses, body } from './shared.js';

export function registerJiraComponents(registry: OpenAPIRegistry): void {
  registry.register('JiraPushPreview', JiraPushPreviewSchema);
  registry.register('JiraPushSprintsPreview', JiraPushSprintsPreviewSchema);
  registry.register('JiraPushSprints', JiraPushSprintsSchema);
  registry.register('JiraPushRank', JiraPushRankSchema);
}

export function registerJiraPaths(registry: OpenAPIRegistry): void {
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
    path: '/jira/by-fix-version/{version}',
    tags: ['Jira'],
    summary: 'Find Jira issues by fix version, including ones not yet imported locally',
    request: {
      params: z.object({ version: z.string().openapi({ description: 'Jira fix version name' }) }),
    },
    responses: { ...ok('Issues for the fix version'), ...errorResponses },
  });

  registry.registerPath({
    method: 'get',
    path: '/jira/board-sprints',
    tags: ['Jira'],
    summary: 'List active/future sprints on the configured Jira board',
    responses: { ...ok('Board sprints'), ...errorResponses },
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
}
