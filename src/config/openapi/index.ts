// ── OpenAPI spec assembly ──────────────────────────────────────────────────────
// Path/schema definitions are grouped by feature area (docs.ts, platform.ts,
// jira.ts, export.ts) — split from a single 813-line file (#341) purely for
// navigability; the generated spec is byte-for-byte identical to before.
import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { registerDocsComponents, registerDocsPaths } from './docs.js';
import { registerPlatformComponents, registerPlatformPaths } from './platform.js';
import { registerJiraComponents, registerJiraPaths } from './jira.js';
import { registerExportPaths } from './export.js';

export function buildOpenApiSpec() {
  const registry = new OpenAPIRegistry();

  // Register all request body schemas as reusable components
  registerDocsComponents(registry);
  registerPlatformComponents(registry);
  registerJiraComponents(registry);

  // Register path definitions, grouped by feature area
  registerDocsPaths(registry);
  registerPlatformPaths(registry);
  registerJiraPaths(registry);
  registerExportPaths(registry);

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
