// ── Shared TypeScript type definitions ────────────────────────────────────────

import type { Request, Response } from 'express';
import type { Logger } from './utils/logger.js';

// ── Document types ──────────────────────────────────────────────────────────

export type DocType = 'feature' | 'epic' | 'story' | 'spike' | 'bug';

export type Priority = 'Critical' | 'High' | 'Medium' | 'Low';

export type WorkflowStatus = 'Draft' | 'Created in JIRA' | 'Archived';

export interface TypeConfigEntry {
  command: string;
  dir: () => string;
  event: string;
}

export type TypeConfig = Record<string, TypeConfigEntry>;

// ── Doc index entry ─────────────────────────────────────────────────────────

export interface DocEntry {
  filename: string;
  docType: string;
  title: string;
  date: string;
  status: string;
  fixVersion: string | null;
  jiraId: string | null;
  jiraUrl: string | null;
  storyPoints: number | null;
  sprint: string | null;
  rank: number | null;
  priority: string;
  parentFilename: string | null;
  parentType: string | null;
  blocks: string[];
  blockedBy: string[];
  parallel: string[];
  pi: string | null;
  team: string | null;
  workCategory: string | null;
  hasDescription: boolean;
  descriptionSnippet: string | null;
}

export interface DocIndexInstance {
  build: () => Promise<DocIndexInstance>;
  getAll: () => DocEntry[];
  get: (filename: string) => DocEntry | null;
  invalidate: (docType: string, filename: string) => Promise<void>;
  invalidateAll: () => Promise<void>;
  findByJiraId: (jiraId: string) => { docType: string; filename: string } | null;
}

// ── Sprint distribution ─────────────────────────────────────────────────────

export interface SprintSlot {
  name: string;
  capacity: number;
  used: number;
}

// ── JIRA ────────────────────────────────────────────────────────────────────

export interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    description: string | null;
    issuetype: { name: string };
    priority: { name: string };
    fixVersions: Array<{ name: string }>;
    [key: string]: any;
  };
}

// ── Attachments & email parsing ─────────────────────────────────────────────

export interface ProcessedAttachment {
  filename: string;
  buffer: Buffer;
}

export interface EmailSegment {
  type: 'text' | 'image';
  value?: string;
  buffer?: Buffer;
}

export interface ParsedMsg {
  subject: string;
  senderName: string;
  senderEmail: string;
  sentDate: string;
  body: string;
  bodyHtml: string;
  inlineImages: Map<string, Buffer>;
  attachmentImages: Array<{ filename: string; buffer: Buffer }>;
}

// ── Audit log ───────────────────────────────────────────────────────────────

export type AuditOp = 'create' | 'update' | 'delete' | 'jira-push' | 'jira-sync';
export type AuditSource = 'api' | 'inbox' | 'jira-sync';

export interface AuditEvent {
  ts: string;
  op: AuditOp;
  docType: string;
  filename: string;
  fields?: Record<string, unknown>;
  source: AuditSource;
}

// ── SSE events ──────────────────────────────────────────────────────────────

export interface SSEEvent {
  type: string;
  [key: string]: any;
}

export type BroadcastFn = (event: SSEEvent) => void;

// ── Route context shapes ─────────────────────────────────────────────────────

export interface RouteContext {
  rootDir: string;
  TYPE_CONFIG: TypeConfig;
  FEATURES_DIR: string;
  EPICS_DIR: string;
  STORIES_DIR: string;
  SPIKES_DIR: string;
  BUGS_DIR: string;
  INBOX_DIR: string;
  broadcast: BroadcastFn;
  loadCommand: (name: string) => string | null;
  callClaude: (prompt: string) => Promise<string>;
  streamClaude: (prompt: string, onChunk: (chunk: string) => void) => Promise<void>;
  _apiInFlight: Set<string>;
  logInfo: Logger['logInfo'];
  logWarn: Logger['logWarn'];
  logError: Logger['logError'];
  docIndex: DocIndexInstance;
}

export interface JiraRouteContext extends RouteContext {
  JIRA_PROJECT: string;
  JIRA_LABEL: string;
  JIRA_BASE: string;
  JIRA_BOARD_ID: string;
  FIELD_EPIC_NAME: string;
  FIELD_EPIC_LINK: string;
  FIELD_STORY_POINTS: string;
  jiraRequest: (method: string, urlPath: string, body?: unknown, opts?: { _retryOn429?: boolean }) => Promise<unknown>;
  jiraAgileRequest: (method: string, urlPath: string, body?: unknown, opts?: { _retryOn429?: boolean }) => Promise<unknown>;
  jiraPagedRequest: (jql: string, fields: string, opts?: { maxResults?: number; maxTotal?: number }) => Promise<unknown[]>;
  jiraUploadAttachment: (issueKey: string, filename: string, buffer: Buffer) => Promise<unknown>;
  findLocalFileByJiraId: (jiraId: string) => Promise<{ docType: string; filename: string } | null>;
  jiraIssueToMarkdown: (issue: unknown) => { docType: string; content: string };
  extractJiraSummary: (content: string) => string;
}

// ── Settings route context ───────────────────────────────────────────────────

export interface SettingsRouteContext {
  rootDir: string;
  broadcast: BroadcastFn;
  logInfo: Logger['logInfo'];
  jiraBase: string;
}

// ── Bug route context ────────────────────────────────────────────────────────

export interface BugRouteContext {
  BUGS_DIR: string;
  broadcast: BroadcastFn;
  callClaude: (prompt: string) => Promise<string>;
  logInfo: Logger['logInfo'];
  logError: Logger['logError'];
  docIndex: DocIndexInstance;
}

// ── Canvas route context ─────────────────────────────────────────────────────

export interface CanvasRouteContext {
  rootDir: string;
  logInfo: Logger['logInfo'];
}
