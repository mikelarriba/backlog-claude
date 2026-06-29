// ── Application context builder ─────────────────────────────────────────────────
import path from 'path';
import {
  loadCommand as loadCommandService,
  callClaude as callClaudeService,
  streamClaude as streamClaudeService,
} from '../services/claudeService.js';
import { createEventService } from '../services/eventService.js';
import { createJiraService, type JiraServiceInstance } from '../services/jiraService.js';
import { createDocIndex } from '../services/docIndex.js';
import { validateJiraConfig } from '../services/jiraValidator.js';
import { watchInbox } from '../services/inboxWatcher.js';
import { createTypeConfig } from '../config/docTypes.js';
import { config } from '../config/env.js';
import { isoDate, slugify } from '../utils/transforms.js';
import { createLogger } from '../utils/logger.js';
import { ensureDir } from '../utils/routeHelpers.js';
import { createCircuitBreaker, type CircuitBreaker } from '../utils/circuitBreaker.js';
import type { RouteContext, JiraRouteContext } from '../types.js';
import type { Request, Response } from 'express';

export interface AppContext {
  shared: RouteContext;
  jiraShared: JiraRouteContext;
  handleEvents: (req: Request, res: Response) => void;
  DOCS_ROOT: string;
  INBOX_DIR: string;
  JIRA_BASE: string;
  JIRA_TOKEN: string;
  JIRA_PROJECT: string;
  FIELD_EPIC_NAME: string;
  FIELD_EPIC_LINK: string;
  FIELD_STORY_POINTS: string;
  jiraCircuit: CircuitBreaker;
  logInfo: ReturnType<typeof createLogger>['logInfo'];
  logWarn: ReturnType<typeof createLogger>['logWarn'];
  logError: ReturnType<typeof createLogger>['logError'];
  runStartup: (port: number) => void;
}

export async function buildContext(rootDir: string): Promise<AppContext> {
  const { logInfo, logWarn, logError } = createLogger('[midas-backlog]');

  const DOCS_ROOT = process.env.TEST_DOCS_ROOT || path.join(rootDir, 'docs');
  const INBOX_DIR = process.env.TEST_INBOX_DIR || path.join(rootDir, 'inbox');
  const TYPE_CONFIG = createTypeConfig(DOCS_ROOT);

  const JIRA_BASE = config.JIRA_BASE_URL.replace(/\/$/, '');
  const JIRA_TOKEN = config.JIRA_API_TOKEN;
  const JIRA_PROJECT = config.JIRA_PROJECT;
  const JIRA_LABEL = config.JIRA_LABEL;
  const FIELD_EPIC_NAME = config.JIRA_FIELD_EPIC_NAME;
  const FIELD_EPIC_LINK = config.JIRA_FIELD_EPIC_LINK;
  const FIELD_STORY_POINTS = config.JIRA_FIELD_STORY_POINTS;
  const JIRA_BOARD_ID = config.JIRA_BOARD_ID;

  const rawJira: JiraServiceInstance = createJiraService({
    JIRA_BASE,
    JIRA_TOKEN,
    FIELD_EPIC_NAME,
    FIELD_STORY_POINTS,
    TYPE_CONFIG,
    isoDate,
    slugify,
  });

  const jiraCircuit = createCircuitBreaker({
    failureThreshold: config.JIRA_CIRCUIT_FAILURE_THRESHOLD,
    resetTimeoutMs: config.JIRA_CIRCUIT_RESET_TIMEOUT_MS,
  });

  const jiraRequest: JiraServiceInstance['jiraRequest'] = (m, p, b) =>
    jiraCircuit.execute(() => rawJira.jiraRequest(m, p, b));
  const jiraAgileRequest: JiraServiceInstance['jiraAgileRequest'] = (m, p, b) =>
    jiraCircuit.execute(() => rawJira.jiraAgileRequest(m, p, b));
  const jiraPagedRequest: JiraServiceInstance['jiraPagedRequest'] = (jql, fields, opts) =>
    jiraCircuit.execute(() => rawJira.jiraPagedRequest(jql, fields, opts));
  const jiraUploadAttachment: JiraServiceInstance['jiraUploadAttachment'] = (key, name, buf) =>
    jiraCircuit.execute(() => rawJira.jiraUploadAttachment(key, name, buf));
  const { findLocalFileByJiraId, jiraIssueToMarkdown, extractJiraSummary } = rawJira;

  const { handleEvents, broadcast } = createEventService();

  const docIndex = createDocIndex({ TYPE_CONFIG });
  docIndex.build().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    logError('docIndex', `Background build failed: ${msg}`);
  });

  const _apiInFlight = new Set<string>();

  const loadCommand = (name: string): string | null => loadCommandService(rootDir, name);
  const callClaude = (prompt: string): Promise<string> => callClaudeService(rootDir, prompt);
  const streamClaude = (prompt: string, onChunk: (chunk: string) => void): Promise<void> =>
    streamClaudeService(rootDir, prompt, onChunk);

  const FEATURES_DIR = TYPE_CONFIG.feature.dir();
  const EPICS_DIR = TYPE_CONFIG.epic.dir();
  const STORIES_DIR = TYPE_CONFIG.story.dir();
  const SPIKES_DIR = TYPE_CONFIG.spike.dir();
  const BUGS_DIR = TYPE_CONFIG.bug.dir();

  const shared: RouteContext = {
    rootDir,
    TYPE_CONFIG,
    FEATURES_DIR,
    EPICS_DIR,
    STORIES_DIR,
    SPIKES_DIR,
    BUGS_DIR,
    INBOX_DIR,
    broadcast,
    loadCommand,
    callClaude,
    streamClaude,
    _apiInFlight,
    logInfo,
    logWarn,
    logError,
    docIndex,
  };

  const jiraShared: JiraRouteContext = {
    ...shared,
    JIRA_PROJECT,
    JIRA_LABEL,
    JIRA_BASE,
    JIRA_BOARD_ID,
    FIELD_EPIC_NAME,
    FIELD_EPIC_LINK,
    FIELD_STORY_POINTS,
    jiraRequest,
    jiraAgileRequest,
    jiraPagedRequest,
    jiraUploadAttachment,
    findLocalFileByJiraId,
    jiraIssueToMarkdown,
    extractJiraSummary,
  };

  function runStartup(port: number): void {
    for (const [key, val, msg] of [
      ['JIRA_BASE_URL', JIRA_BASE, 'JIRA base URL is not set'],
      [
        'JIRA_API_TOKEN',
        JIRA_TOKEN,
        'JIRA API token is not configured; JIRA endpoints will return 503',
      ],
      ['JIRA_PROJECT', JIRA_PROJECT, 'JIRA project key is not set'],
    ] as [string, string, string][]) {
      if (val) logInfo('startup', `${key} configured`);
      else logWarn('startup', msg);
    }
    validateJiraConfig({
      jiraBase: JIRA_BASE,
      jiraToken: JIRA_TOKEN,
      fieldStoryPoints: FIELD_STORY_POINTS,
      fieldEpicLink: FIELD_EPIC_LINK,
      fieldEpicName: FIELD_EPIC_NAME,
      logInfo,
      logWarn,
    }).catch((err: unknown) =>
      logWarn(
        'jira-validator',
        `Unexpected error: ${err instanceof Error ? err.message : String(err)}`
      )
    );
    logInfo('startup', `Backlog Claude running on http://localhost:${port}`);
    watchInbox({
      INBOX_DIR,
      EPICS_DIR: shared.EPICS_DIR,
      DOC_DIRS: [
        shared.FEATURES_DIR,
        shared.EPICS_DIR,
        shared.STORIES_DIR,
        shared.SPIKES_DIR,
        shared.BUGS_DIR,
      ],
      isClaimedByApi: (fn) => shared._apiInFlight.has(fn),
      ensureDir,
      loadCommand: shared.loadCommand,
      callClaude: shared.callClaude,
      broadcast: shared.broadcast,
      logInfo,
      logError,
    });
  }

  return {
    shared,
    jiraShared,
    handleEvents,
    DOCS_ROOT,
    INBOX_DIR,
    JIRA_BASE,
    JIRA_TOKEN,
    JIRA_PROJECT,
    FIELD_EPIC_NAME,
    FIELD_EPIC_LINK,
    FIELD_STORY_POINTS,
    logInfo,
    logWarn,
    logError,
    jiraCircuit,
    runStartup,
  };
}
