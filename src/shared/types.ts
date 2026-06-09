// ── Shared types usable in both frontend (browser) and backend ─────────────
// No Node.js-specific imports (Buffer, etc.) allowed here.

export type DocType = 'feature' | 'epic' | 'story' | 'spike' | 'bug';

export type Priority = 'Critical' | 'High' | 'Medium' | 'Low';

export type WorkflowStatus = 'Draft' | 'Created in JIRA' | 'Archived';

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

export interface PISettings {
  currentPi: string | null;
  nextPi: string | null;
}

export type SprintConfig = Record<string, { capacity: number; sprints?: string[] }>;

export interface SwimlaneCollapsed {
  currentPi: boolean;
  nextPi: boolean;
  backlog: boolean;
}

export interface PanelState {
  stories: DocEntry[];
  layout: Record<string, unknown>;
  blocks: string[];
  parallel: string[];
}
