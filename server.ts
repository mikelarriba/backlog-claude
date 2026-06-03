import express, { type ErrorRequestHandler } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadCommand as loadCommandService, callClaude as callClaudeService, streamClaude as streamClaudeService } from './src/services/claudeService.js';
import { createEventService } from './src/services/eventService.js';
import { createJiraService } from './src/services/jiraService.js';
import { watchInbox } from './src/services/inboxWatcher.js';
import { isoDate, slugify } from './src/utils/transforms.js';
import { ensureDir } from './src/utils/routeHelpers.js';
import { ValidationError } from './src/utils/validate.js';
import { createLogger } from './src/utils/logger.js';
import { requestLogger } from './src/utils/requestLogger.js';
import { createTypeConfig } from './src/config/docTypes.js';
import { TEAMS, WORK_CATEGORIES } from './src/config/metadata.js';
import { createDocIndex } from './src/services/docIndex.js';
import { validateJiraConfig } from './src/services/jiraValidator.js';
import docsCrudRoutes from './src/routes/docs-crud.js';
import docsAiRoutes from './src/routes/docs-ai.js';
import docsBatchRoutes from './src/routes/docs-batch.js';
import linksRoutes from './src/routes/links.js';
import storiesRoutes from './src/routes/stories.js';
import jiraPushRoutes from './src/routes/jira-push.js';
import jiraSyncRoutes from './src/routes/jira-sync.js';
import jiraSearchRoutes from './src/routes/jira-search.js';
import settingsRoutes from './src/routes/settings.js';
import bugRoutes from './src/routes/bugs.js';
import canvasRoutes from './src/routes/canvas.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Load .env ────────────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const eq = line.indexOf('=');
    if (eq > 0) {
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  });
}

const app = express();
const PORT = process.env.PORT || 3000;

const { logInfo, logWarn, logError } = createLogger('[backlog-claude]');

// ── Folder paths ─────────────────────────────────────────────────────────────
const DOCS_ROOT = process.env.TEST_DOCS_ROOT || path.join(__dirname, 'docs');
const INBOX_DIR = process.env.TEST_INBOX_DIR || path.join(__dirname, 'inbox');

const _apiInFlight = new Set<string>();

const TYPE_CONFIG  = createTypeConfig(DOCS_ROOT);
// Convenience aliases — derived from TYPE_CONFIG to stay in sync
const FEATURES_DIR = TYPE_CONFIG.feature.dir();
const EPICS_DIR    = TYPE_CONFIG.epic.dir();
const STORIES_DIR  = TYPE_CONFIG.story.dir();
const SPIKES_DIR   = TYPE_CONFIG.spike.dir();
const BUGS_DIR     = TYPE_CONFIG.bug.dir();

// ── JIRA config ──────────────────────────────────────────────────────────────
const JIRA_BASE  = (process.env.JIRA_BASE_URL || 'https://devstack.vwgroup.com/jira').replace(/\/$/, '');
const JIRA_TOKEN = process.env.JIRA_API_TOKEN || '';
const JIRA_PROJECT = process.env.JIRA_PROJECT  || 'EAMDM';
const JIRA_LABEL   = process.env.JIRA_LABEL    || 'MIDAS_Development';
// Custom field IDs vary per JIRA instance — override via environment variables
const FIELD_EPIC_NAME    = process.env.JIRA_FIELD_EPIC_NAME    || 'customfield_10002';
const FIELD_EPIC_LINK    = process.env.JIRA_FIELD_EPIC_LINK    || 'customfield_10000';
const FIELD_STORY_POINTS = process.env.JIRA_FIELD_STORY_POINTS || 'customfield_10006';
const JIRA_BOARD_ID      = process.env.JIRA_BOARD_ID || '';

const { jiraRequest, jiraAgileRequest, jiraPagedRequest, jiraUploadAttachment, findLocalFileByJiraId, jiraIssueToMarkdown, extractJiraSummary } =
  createJiraService({ JIRA_BASE, JIRA_TOKEN, FIELD_EPIC_NAME, FIELD_STORY_POINTS, TYPE_CONFIG, isoDate, slugify });

const docIndex = createDocIndex({ TYPE_CONFIG });
await docIndex.build();

// ── Security headers ─────────────────────────────────────────────────────────
app.use((_req, res, next) => {
  // Prevent MIME-type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Block framing (clickjacking)
  res.setHeader('X-Frame-Options', 'DENY');
  // Limit referrer information on cross-origin requests
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // CSP: scripts/styles from same origin only; marked is now vendored locally
  // 'unsafe-inline' is required because index.html uses inline event handlers
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "font-src 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  next();
});

// ── Middleware & SSE ─────────────────────────────────────────────────────────
app.use(requestLogger());
app.use(express.json());

// Cache-Control: no-store for all /api/* responses
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// JS and CSS: 5-minute browser cache with ETag revalidation
app.use('/public/js', express.static(path.join(__dirname, 'public/js'), {
  etag: true,
  lastModified: true,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
  },
}));
app.use('/public/css', express.static(path.join(__dirname, 'public/css'), {
  etag: true,
  lastModified: true,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
  },
}));

// index.html: never cache (it references versioned assets)
app.get('/', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
});
app.get('/index.html', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
});

// Remaining static assets (manifest.json, sw.js, etc.)
app.use(express.static(__dirname));

// ── API versioning ── /api/v1/* is an alias for /api/* ───────────────────────
// Rewrite /api/v1/... → /api/... so all route modules work unchanged.
// Clients can migrate to /api/v1/ at their own pace; both paths are supported.
app.use((req, _res, next) => {
  if (req.url.startsWith('/api/v1/')) {
    req.url = '/api' + req.url.slice('/api/v1'.length);
  }
  next();
});

const { handleEvents, broadcast } = createEventService();
app.get('/api/events', handleEvents);

// ── Config endpoints ─────────────────────────────────────────────────────────
app.get('/api/config/metadata', (_req, res) => {
  res.json({ teams: TEAMS, workCategories: WORK_CATEGORIES });
});

// ── OpenAPI spec & Swagger UI ─────────────────────────────────────────────────
app.get('/swagger/openapi.yaml', (_req, res) => {
  res.setHeader('Content-Type', 'application/yaml; charset=utf-8');
  res.sendFile(path.join(__dirname, 'openapi.yaml'));
});

app.get('/swagger', (_req, res) => {
  // Relax CSP for this single route to allow Swagger UI CDN assets
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://unpkg.com",
    "img-src 'self' data: https://unpkg.com",
    "connect-src 'self'",
    "font-src 'self' https://unpkg.com",
    "frame-ancestors 'none'",
  ].join('; '));
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

const loadCommand  = (name: string): string | null => loadCommandService(__dirname, name);
const callClaude   = (prompt: string): Promise<string> => callClaudeService(__dirname, prompt);
const streamClaude = (prompt: string, onChunk: (chunk: string) => void): Promise<void> => streamClaudeService(__dirname, prompt, onChunk);

// ── Mount route modules ──────────────────────────────────────────────────────
const shared = { rootDir: __dirname, TYPE_CONFIG, FEATURES_DIR, EPICS_DIR, STORIES_DIR, SPIKES_DIR, BUGS_DIR, INBOX_DIR, broadcast, loadCommand, callClaude, streamClaude, _apiInFlight, logInfo, logWarn, logError, docIndex };

const jiraShared = { ...shared, JIRA_PROJECT, JIRA_LABEL, JIRA_BASE, JIRA_BOARD_ID, FIELD_EPIC_NAME, FIELD_EPIC_LINK, FIELD_STORY_POINTS, jiraRequest, jiraAgileRequest, jiraPagedRequest, jiraUploadAttachment, findLocalFileByJiraId, jiraIssueToMarkdown, extractJiraSummary };

app.use(docsCrudRoutes(shared));
app.use(docsAiRoutes(shared));
app.use(docsBatchRoutes(shared));
app.use(linksRoutes(shared));
app.use(storiesRoutes(shared));
app.use(jiraPushRoutes(jiraShared));
app.use(jiraSyncRoutes(jiraShared));
app.use(jiraSearchRoutes(jiraShared));
app.use(settingsRoutes({ rootDir: __dirname, broadcast, logInfo, jiraBase: JIRA_BASE }));
app.use(bugRoutes({ BUGS_DIR, broadcast, callClaude, logInfo, logError, docIndex }));
app.use(canvasRoutes({ rootDir: __dirname, logInfo }));

// ── Centralised ValidationError handler ─────────────────────────────────────
// Catches ValidationError instances thrown and forwarded via next(err).
const validationErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (err instanceof ValidationError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err.message } });
    return;
  }
  next(err);
};
app.use(validationErrorHandler);

// ── Startup ──────────────────────────────────────────────────────────────────
function validateStartupConfig() {
  const checks = [
    { key: 'JIRA_BASE_URL', ok: !!JIRA_BASE, level: 'warn', message: 'JIRA base URL is not set' },
    { key: 'JIRA_API_TOKEN', ok: !!JIRA_TOKEN, level: 'warn', message: 'JIRA API token is not configured; JIRA endpoints will return 503' },
    { key: 'JIRA_PROJECT', ok: !!JIRA_PROJECT, level: 'warn', message: 'JIRA project key is not set' },
  ];
  for (const check of checks) {
    if (check.ok) logInfo('startup', `${check.key} configured`);
    else if (check.level === 'warn') logWarn('startup', check.message);
    else logError('startup', check.message);
  }
}

export { app };

if (process.argv[1] === __filename) {
  app.listen(PORT, () => {
    validateStartupConfig();
    validateJiraConfig({
      jiraBase: JIRA_BASE,
      jiraToken: JIRA_TOKEN,
      fieldStoryPoints: FIELD_STORY_POINTS,
      fieldEpicLink: FIELD_EPIC_LINK,
      fieldEpicName: FIELD_EPIC_NAME,
      logInfo,
      logWarn,
    }).catch(err => logWarn('jira-validator', `Unexpected error: ${err.message}`));
    logInfo('startup', `Backlog Claude running on http://localhost:${PORT}`);
    watchInbox({
      INBOX_DIR,
      EPICS_DIR,
      DOC_DIRS:      [FEATURES_DIR, EPICS_DIR, STORIES_DIR, SPIKES_DIR, BUGS_DIR],
      isClaimedByApi: fn => _apiInFlight.has(fn),
      ensureDir,
      loadCommand,
      callClaude,
      broadcast,
      logInfo,
      logError,
    });
  });
}
