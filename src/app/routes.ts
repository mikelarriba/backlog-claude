// ── Route registration ──────────────────────────────────────────────────────────
import path from 'path';
import express, { type Express, type ErrorRequestHandler } from 'express';
import { buildOpenApiSpec } from '../config/openapi.js';
import { sendError } from '../utils/routeHelpers.js';
import { ValidationError } from '../utils/validate.js';
import { TEAMS, WORK_CATEGORIES } from '../config/metadata.js';
import docsCrudRoutes from '../routes/docs-crud.js';
import docsAiRoutes from '../routes/docs-ai.js';
import docsBatchRoutes from '../routes/docs-batch.js';
import linksRoutes from '../routes/links.js';
import storiesRoutes from '../routes/stories.js';
import jiraPushDocRoutes from '../routes/jira-push-doc.js';
import jiraPushSprintsRoutes from '../routes/jira-push-sprints.js';
import jiraPushRankRoutes from '../routes/jira-push-rank.js';
import jiraSyncRoutes from '../routes/jira-sync.js';
import jiraSearchRoutes from '../routes/jira-search.js';
import settingsRoutes from '../routes/settings.js';
import bugRoutes from '../routes/bugs.js';
import canvasRoutes from '../routes/canvas.js';
import skillsRoutes from '../routes/skills.js';
import exportRoutes from '../routes/export.js';
import bugsDashboardRoutes from '../routes/bugs-dashboard.js';
import { healthHandler } from '../routes/health.js';
import type { AppContext } from './context.js';

export function registerRoutes(app: Express, ctx: AppContext, rootDir: string): void {
  const { shared, jiraShared, handleEvents } = ctx;

  app.get('/api/events', handleEvents);

  app.get('/api/config/metadata', (_req, res) => {
    res.json({ teams: TEAMS, workCategories: WORK_CATEGORIES });
  });

  app.get('/api/health', healthHandler(ctx));

  const openApiSpec = buildOpenApiSpec();
  const swaggerUiPath = path.join(rootDir, 'node_modules', 'swagger-ui-dist');

  app.get('/api-docs/swagger-initializer.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(
      `window.onload = function() {
  window.ui = SwaggerUIBundle({
    url: '/api-docs/openapi.json',
    dom_id: '#swagger-ui',
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
    layout: 'BaseLayout',
    deepLinking: true,
  });
};`
    );
  });

  app.get('/api-docs/openapi.json', (_req, res) => res.json(openApiSpec));
  app.use('/api-docs', express.static(swaggerUiPath));

  app.get('/swagger/openapi.yaml', (_req, res) => {
    res.setHeader('Content-Type', 'application/yaml; charset=utf-8');
    res.sendFile(path.join(rootDir, 'openapi.yaml'));
  });

  app.get('/swagger', (_req, res) => {
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://unpkg.com",
        "style-src 'self' 'unsafe-inline' https://unpkg.com",
        "img-src 'self' data: https://unpkg.com",
        "connect-src 'self'",
        "font-src 'self' https://unpkg.com",
        "frame-ancestors 'none'",
      ].join('; ')
    );
    res.send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Backlog Claude – API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
    <style>body { margin: 0; }</style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      SwaggerUIBundle({
        url: '/swagger/openapi.yaml',
        dom_id: '#swagger-ui',
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
        layout: 'BaseLayout',
        deepLinking: true,
      });
    </script>
  </body>
</html>`);
  });

  app.use(docsCrudRoutes(shared));
  app.use(docsAiRoutes(shared));
  app.use(docsBatchRoutes(shared));
  app.use(linksRoutes(shared));
  app.use(storiesRoutes(shared));
  app.use(jiraPushDocRoutes(jiraShared));
  app.use(jiraPushSprintsRoutes(jiraShared));
  app.use(jiraPushRankRoutes(jiraShared));
  app.use(jiraSyncRoutes(jiraShared));
  app.use(jiraSearchRoutes(jiraShared));
  app.use(
    settingsRoutes({
      rootDir,
      broadcast: shared.broadcast,
      logInfo: shared.logInfo,
      jiraBase: jiraShared.JIRA_BASE,
    })
  );
  app.use(
    bugRoutes({
      BUGS_DIR: shared.BUGS_DIR,
      broadcast: shared.broadcast,
      callClaude: shared.callClaude,
      logInfo: shared.logInfo,
      logError: shared.logError,
      docIndex: shared.docIndex,
    })
  );
  app.use(canvasRoutes({ rootDir, logInfo: shared.logInfo }));
  app.use(
    skillsRoutes({
      rootDir,
      broadcast: shared.broadcast,
      callClaude: shared.callClaude,
      logInfo: shared.logInfo,
    })
  );
  app.use(exportRoutes({ rootDir, TYPE_CONFIG: shared.TYPE_CONFIG, docIndex: shared.docIndex }));
  app.use(bugsDashboardRoutes(jiraShared));

  const validationErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
    if (err instanceof ValidationError) {
      sendError(res, 400, 'VALIDATION_ERROR', err.message);
      return;
    }
    next(err);
  };
  app.use(validationErrorHandler);
}
