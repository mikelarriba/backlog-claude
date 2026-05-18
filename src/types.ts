// ── Shared TypeScript type definitions ────────────────────────────────────────

import type { Request, Response } from 'express';

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
  team: string | null;
  workCategory: string | null;
  hasDescription: boolean;
}

export interface DocIndexInstance {
  build: () => Promise<DocIndexInstance>;
  getAll: () => DocEntry[];
  get: (filename: string) => DocEntry | null;
  invalidate: (docType: string, filename: string) => void;
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

// ── SSE events ──────────────────────────────────────────────────────────────

export interface SSEEvent {
  type: string;
  [key: string]: any;
}

export type BroadcastFn = (event: SSEEvent) => void;
