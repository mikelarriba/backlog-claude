import fs from 'fs';
import path from 'path';
import { jiraToMarkdown } from '../utils/transforms.js';
import type { TypeConfig } from '../types.js';

export const LOCAL_TO_JIRA_TYPE: Record<string, string> = {
  feature: 'New Feature',
  epic: 'Epic',
  story: 'Story',
  spike: 'Task',
  bug: 'Bug',
};
export const JIRA_TO_LOCAL_TYPE: Record<string, string> = {
  'New Feature': 'feature',
  Epic: 'epic',
  Story: 'story',
  Improvement: 'story',
  Task: 'spike',
  Bug: 'bug',
};

const JIRA_TIMEOUT_MS = Number(process.env.JIRA_TIMEOUT_MS) || 30_000;

interface JiraServiceConfig {
  JIRA_BASE: string;
  JIRA_TOKEN: string;
  FIELD_EPIC_NAME: string;
  FIELD_STORY_POINTS: string;
  TYPE_CONFIG: TypeConfig;
  isoDate: () => string;
  slugify: (text: string) => string;
}

export interface JiraServiceInstance {
  jiraRequest: (
    method: string,
    urlPath: string,
    body?: any,
    opts?: { _retryOn429?: boolean }
  ) => Promise<any>;
  jiraPagedRequest: (
    jql: string,
    fields: string,
    opts?: { maxResults?: number; maxTotal?: number }
  ) => Promise<any[]>;
  jiraAgileRequest: (
    method: string,
    urlPath: string,
    body?: any,
    opts?: { _retryOn429?: boolean }
  ) => Promise<any>;
  jiraUploadAttachment: (issueKey: string, filename: string, buffer: Buffer) => Promise<any>;
  findLocalFileByJiraId: (jiraId: string) => Promise<{ docType: string; filename: string } | null>;
  jiraIssueToMarkdown: (issue: any) => { docType: string; content: string };
  extractJiraSummary: (content: string) => string;
}

export function createJiraService({
  JIRA_BASE,
  JIRA_TOKEN,
  FIELD_EPIC_NAME: _FIELD_EPIC_NAME,
  FIELD_STORY_POINTS,
  TYPE_CONFIG,
  isoDate,
  slugify: _slugify,
}: JiraServiceConfig): JiraServiceInstance {
  async function jiraRequest(
    method: string,
    urlPath: string,
    body?: any,
    { _retryOn429 = true } = {}
  ): Promise<any> {
    const url = `${JIRA_BASE}/rest/api/2${urlPath}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JIRA_TIMEOUT_MS);
    const opts: RequestInit = {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${JIRA_TOKEN}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    };
    if (body) opts.body = JSON.stringify(body);
    let res: Response;
    try {
      res = await fetch(url, opts);
    } catch (err: any) {
      if (err.name === 'AbortError')
        throw new Error(`JIRA request timed out after ${JIRA_TIMEOUT_MS / 1000}s`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
    // Rate-limit: wait for Retry-After and retry once
    if (res.status === 429 && _retryOn429) {
      const retryAfter = Number(res.headers.get('Retry-After')) || 60;
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return jiraRequest(method, urlPath, body, { _retryOn429: false });
    }
    if (!res.ok) {
      if (res.status === 429) throw new Error(`JIRA rate limit exceeded — try again later`);
      const text = await res.text().catch(() => '');
      // Scrub anything resembling a Bearer token from error output
      const safeText = text
        .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, 'Bearer [REDACTED]')
        .slice(0, 300);
      throw new Error(`JIRA ${method} ${urlPath} → ${res.status}: ${safeText}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  }

  async function jiraAgileRequest(
    method: string,
    urlPath: string,
    body?: any,
    { _retryOn429 = true } = {}
  ): Promise<any> {
    const url = `${JIRA_BASE}/rest/agile/1.0${urlPath}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JIRA_TIMEOUT_MS);
    const opts: RequestInit = {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${JIRA_TOKEN}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    };
    if (body) opts.body = JSON.stringify(body);
    let res: Response;
    try {
      res = await fetch(url, opts);
    } catch (err: any) {
      if (err.name === 'AbortError')
        throw new Error(`JIRA Agile request timed out after ${JIRA_TIMEOUT_MS / 1000}s`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429 && _retryOn429) {
      const retryAfter = Number(res.headers.get('Retry-After')) || 60;
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return jiraAgileRequest(method, urlPath, body, { _retryOn429: false });
    }
    if (!res.ok) {
      if (res.status === 429) throw new Error(`JIRA Agile rate limit exceeded — try again later`);
      const text = await res.text().catch(() => '');
      const safeText = text
        .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, 'Bearer [REDACTED]')
        .slice(0, 300);
      throw new Error(`JIRA Agile ${method} ${urlPath} → ${res.status}: ${safeText}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  }

  async function jiraPagedRequest(
    jql: string,
    fields: string,
    { maxResults = 100, maxTotal = 500 } = {}
  ): Promise<any[]> {
    const all: any[] = [];
    let startAt = 0;

    while (true) {
      const url = `/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&startAt=${startAt}&fields=${encodeURIComponent(fields)}`;
      const page = await jiraRequest('GET', url);
      const issues = page.issues || [];
      all.push(...issues);

      if (all.length >= maxTotal || all.length >= (page.total || 0) || issues.length < maxResults)
        break;
      startAt += issues.length;
    }

    return all.slice(0, maxTotal);
  }

  async function findLocalFileByJiraId(
    jiraId: string
  ): Promise<{ docType: string; filename: string } | null> {
    for (const [docType, cfg] of Object.entries(TYPE_CONFIG)) {
      const dir = cfg.dir();
      if (!fs.existsSync(dir)) continue;
      for (const f of (await fs.promises.readdir(dir)).filter((f) => f.endsWith('.md'))) {
        const content = await fs.promises.readFile(path.join(dir, f), 'utf-8');
        const m = content.match(/^JIRA_ID:\s*(.+)$/m);
        if (m && m[1].trim() === jiraId) return { docType, filename: f };
      }
    }
    return null;
  }

  function jiraIssueToMarkdown(issue: any): { docType: string; content: string } {
    const { key, fields } = issue;
    const summary = (fields.summary || '').replace(/[\r\n]+/g, ' ').trim();
    const description = jiraToMarkdown(fields.description || '');
    const issueType = fields.issuetype?.name || 'Epic';
    const priority = fields.priority?.name || 'Medium';
    const docType = JIRA_TO_LOCAL_TYPE[issueType] || 'epic';
    const fixVersion = fields.fixVersions?.[0]?.name || 'TBD';
    const jiraUrl = `${JIRA_BASE}/browse/${key}`;
    const spRaw = FIELD_STORY_POINTS ? fields[FIELD_STORY_POINTS] : null;
    const storyPoints = spRaw != null ? String(spRaw) : 'TBD';

    const content = `---
JIRA_ID: ${key}
JIRA_URL: ${jiraUrl}
Story_Points: ${storyPoints}
Status: Created in JIRA
Priority: ${priority}
Fix_Version: ${fixVersion}
Squad: TBD
PI: TBD
Sprint: TBD
Created: ${isoDate()}
---

## ${summary}

${description || '_No description in JIRA._'}
`;
    return { docType, content };
  }

  function extractJiraSummary(content: string): string {
    const storyHeader = content.match(/^## Story \d+:\s*(.+?)(?:\s*<!--.*?-->)?\s*$/m);
    if (storyHeader) return storyHeader[1].trim();
    // Any "## <Type> Title" placeholder → real title is the next non-empty line
    const namedSection = content.match(/^## \w[\w ]* Title\s*\n+(.+)/m);
    if (namedSection) return namedSection[1].trim();
    const h2 = content.match(/^## (.+)/m);
    if (h2) return h2[1].replace(/<!--.*?-->/g, '').trim();
    const h1 = content.match(/^# (.+)/m);
    if (h1) return h1[1].trim();
    return 'Untitled';
  }

  async function jiraUploadAttachment(
    issueKey: string,
    filename: string,
    buffer: Buffer
  ): Promise<any> {
    const url = `${JIRA_BASE}/rest/api/2/issue/${issueKey}/attachments`;
    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(buffer)]), filename);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${JIRA_TOKEN}`,
        'X-Atlassian-Token': 'no-check',
      },
      body: formData,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`JIRA attachment upload → ${res.status}: ${text.slice(0, 300)}`);
    }
    try {
      return await res.json();
    } catch {
      return { success: true }; // Attachment uploaded even if response parse fails
    }
  }

  return {
    jiraRequest,
    jiraAgileRequest,
    jiraPagedRequest,
    jiraUploadAttachment,
    findLocalFileByJiraId,
    jiraIssueToMarkdown,
    extractJiraSummary,
  };
}
