import fs from 'fs';
import path from 'path';

export const LOCAL_TO_JIRA_TYPE = { feature: 'New Feature', epic: 'Epic', story: 'Story', spike: 'Task' };
export const JIRA_TO_LOCAL_TYPE = { 'New Feature': 'feature', Epic: 'epic', Story: 'story', Task: 'spike' };

export function createJiraService({ JIRA_BASE, JIRA_TOKEN, FIELD_EPIC_NAME, TYPE_CONFIG, isoDate, slugify }) {
  async function jiraRequest(method, urlPath, body) {
    const url = `${JIRA_BASE}/rest/api/2${urlPath}`;
    const opts = {
      method,
      headers: {
        Authorization: `Bearer ${JIRA_TOKEN}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`JIRA ${method} ${urlPath} → ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json();
  }

  function findLocalFileByJiraId(jiraId) {
    for (const [docType, cfg] of Object.entries(TYPE_CONFIG)) {
      const dir = cfg.dir();
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
        const content = fs.readFileSync(path.join(dir, f), 'utf-8');
        const m = content.match(/^JIRA_ID:\s*(.+)$/m);
        if (m && m[1].trim() === jiraId) return { docType, filename: f };
      }
    }
    return null;
  }

  function jiraIssueToMarkdown(issue) {
    const { key, fields } = issue;
    const summary = (fields.summary || '').trim();
    const description = (fields.description || '').trim();
    const issueType = fields.issuetype?.name || 'Epic';
    const priority = fields.priority?.name || 'Medium';
    const docType = JIRA_TO_LOCAL_TYPE[issueType] || 'epic';

    const content = `---
JIRA_ID: ${key}
Story_Points: TBD
Status: Created in JIRA
Priority: ${priority}
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

  function extractJiraSummary(content) {
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

  function stripFrontmatter(content) {
    return content.replace(/^---[\s\S]*?---\n?/, '').trim();
  }

  return {
    jiraRequest,
    findLocalFileByJiraId,
    jiraIssueToMarkdown,
    extractJiraSummary,
    stripFrontmatter,
  };
}
