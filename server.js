import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadCommand as loadCommandService, callClaude as callClaudeService, streamClaude as streamClaudeService } from './src/services/claudeService.js';
import { createEventService } from './src/services/eventService.js';
import { createJiraService } from './src/services/jiraService.js';
import { watchInbox } from './src/services/inboxWatcher.js';
import { isoDate, slugify } from './src/utils/transforms.js';
import { ensureDir } from './src/utils/routeHelpers.js';
import docsRoutes from './src/routes/docs.js';
import linksRoutes from './src/routes/links.js';
import storiesRoutes from './src/routes/stories.js';
import jiraRoutes from './src/routes/jira.js';
import settingsRoutes from './src/routes/settings.js';

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
const PORT = 3000;

const LOG_PREFIX = '[backlog-claude]';
function nowIso() { return new Date().toISOString(); }
function logInfo(scope, message, meta = {})  { console.log(`${LOG_PREFIX} ${nowIso()} [INFO] [${scope}] ${message}`, meta); }
function logWarn(scope, message, meta = {})  { console.warn(`${LOG_PREFIX} ${nowIso()} [WARN] [${scope}] ${message}`, meta); }
function logError(scope, message, meta = {}) { console.error(`${LOG_PREFIX} ${nowIso()} [ERROR] [${scope}] ${message}`, meta); }

// ── Folder paths ─────────────────────────────────────────────────────────────
const DOCS_ROOT    = process.env.TEST_DOCS_ROOT || path.join(__dirname, 'docs');
const FEATURES_DIR = path.join(DOCS_ROOT, 'features');
const EPICS_DIR    = path.join(DOCS_ROOT, 'epics');
const STORIES_DIR  = path.join(DOCS_ROOT, 'stories');
const SPIKES_DIR   = path.join(DOCS_ROOT, 'spikes');
const BUGS_DIR     = path.join(DOCS_ROOT, 'bugs');
const INBOX_DIR    = process.env.TEST_INBOX_DIR || path.join(__dirname, 'inbox');

const _apiInFlight = new Set();

const TYPE_CONFIG = {
  feature: { command: 'create-features', dir: () => FEATURES_DIR, event: 'feature_created' },
  epic:    { command: 'create-epics',    dir: () => EPICS_DIR,    event: 'epic_created' },
  story:   { command: 'create-stories',  dir: () => STORIES_DIR,  event: 'story_created' },
  spike:   { command: 'create-spikes',   dir: () => SPIKES_DIR,   event: 'spike_created' },
  bug:     { command: 'create-bugs',     dir: () => BUGS_DIR,     event: 'bug_created'   },
};

// ── JIRA config ──────────────────────────────────────────────────────────────
const JIRA_BASE  = (process.env.JIRA_BASE_URL || 'https://devstack.vwgroup.com/jira').replace(/\/$/, '');
const JIRA_TOKEN = process.env.JIRA_API_TOKEN || '';
const JIRA_PROJECT = 'EAMDM';
const JIRA_LABEL   = 'MIDAS_Development';
const FIELD_EPIC_NAME = 'customfield_10002';
const FIELD_EPIC_LINK = 'customfield_10000';

const { jiraRequest, findLocalFileByJiraId, jiraIssueToMarkdown, extractJiraSummary } =
  createJiraService({ JIRA_BASE, JIRA_TOKEN, FIELD_EPIC_NAME, TYPE_CONFIG, isoDate, slugify });

// ── Middleware & SSE ─────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(__dirname));

const { handleEvents, broadcast } = createEventService();
app.get('/api/events', handleEvents);

const loadCommand  = name => loadCommandService(__dirname, name);
const callClaude   = prompt => callClaudeService(__dirname, prompt);
const streamClaude = (prompt, onChunk) => streamClaudeService(__dirname, prompt, onChunk);

// ── Mount route modules ──────────────────────────────────────────────────────
const shared = { TYPE_CONFIG, FEATURES_DIR, EPICS_DIR, STORIES_DIR, SPIKES_DIR, BUGS_DIR, INBOX_DIR, broadcast, loadCommand, callClaude, streamClaude, _apiInFlight, logInfo, logWarn, logError };

app.use(docsRoutes(shared));
app.use(linksRoutes(shared));
app.use(storiesRoutes(shared));
app.use(jiraRoutes({ ...shared, JIRA_PROJECT, JIRA_LABEL, FIELD_EPIC_NAME, FIELD_EPIC_LINK, jiraRequest, findLocalFileByJiraId, jiraIssueToMarkdown, extractJiraSummary }));
app.use(settingsRoutes({ rootDir: __dirname, broadcast, logInfo }));

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
