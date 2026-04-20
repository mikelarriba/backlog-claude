import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load .env ─────────────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const eq = line.indexOf('=');
    if (eq > 0) {
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (key && !process.env[key]) process.env[key] = val;
    }
  });
}

const app = express();
const PORT = 3000;

const LOG_PREFIX = '[backlog-claude]';

function nowIso() {
  return new Date().toISOString();
}

function logInfo(scope, message, meta = {}) {
  console.log(`${LOG_PREFIX} ${nowIso()} [INFO] [${scope}] ${message}`, meta);
}

function logWarn(scope, message, meta = {}) {
  console.warn(`${LOG_PREFIX} ${nowIso()} [WARN] [${scope}] ${message}`, meta);
}

function logError(scope, message, meta = {}) {
  console.error(`${LOG_PREFIX} ${nowIso()} [ERROR] [${scope}] ${message}`, meta);
}

function sendError(res, status, code, message, details = null) {
  return res.status(status).json({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  });
}

// ── Folder paths ──────────────────────────────────────────────────────────────
const EPICS_DIR   = path.join(__dirname, 'docs', 'epics');
const STORIES_DIR = path.join(__dirname, 'docs', 'stories');
const SPIKES_DIR  = path.join(__dirname, 'docs', 'spikes');
const INBOX_DIR   = path.join(__dirname, 'inbox');

// Maps type → { command, dir, broadcastType }
const TYPE_CONFIG = {
  epic:  { command: 'create-epics',  dir: () => EPICS_DIR,   event: 'epic_created' },
  story: { command: 'create-stories', dir: () => STORIES_DIR, event: 'story_created' },
  spike: { command: 'create-spikes', dir: () => SPIKES_DIR,  event: 'spike_created' },
};

app.use(express.json());
app.use(express.static(__dirname));

// ── SSE broadcast (live updates to all open browser tabs) ────────────────────
const sseClients = new Set();

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write('data: {"type":"connected"}\n\n');
  sseClients.add(res);

  req.on('close', () => sseClients.delete(res));
});

function broadcast(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) client.write(data);
}

// ── Command loader ────────────────────────────────────────────────────────────
// Reads a .claude/commands/<name>.md file and strips the YAML frontmatter,
// returning just the prompt body. Falls back to null if the file doesn't exist.
function loadCommand(name) {
  const p = path.join(__dirname, '.claude', 'commands', `${name}.md`);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf-8').replace(/^---[\s\S]*?---\n?/, '').trim();
}

// ── Story section helpers ─────────────────────────────────────────────────────

function parseStorySections(content) {
  const fmMatch = content.match(/^---[\s\S]*?---\n?/);
  const frontmatter = fmMatch ? fmMatch[0] : '';
  const body = content.slice(frontmatter.length).trim();
  // Split on "## Story N" headings (keep delimiter with each section)
  const sections = body.split(/(?=^## Story \d+[:\s])/m)
    .map(s => s.trim()).filter(s => s.length > 0);
  return { frontmatter, sections };
}

function serializeStoryFile(frontmatter, sections) {
  return frontmatter + '\n' + sections.join('\n\n') + '\n';
}

function extractStoryTitle(section) {
  const m = section.match(/^## (.+)$/m);
  return m ? m[1].trim() : 'Untitled Story';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 50);
}

function pad(n) { return String(n).padStart(2, '0'); }

function isoDate() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function extractTitle(content) {
  const m = content.match(/^## Epic Title\s*\n+(.+)/m)
    || content.match(/^# (.+)/m)
    || content.match(/^## (.+)/m);
  return m ? m[1].trim() : null;
}

const WORKFLOW_STATUSES = ['Draft', 'Created in JIRA', 'Archived'];

function parseApiError(err, fallbackCode = 'INTERNAL_ERROR', fallbackMessage = 'Unexpected server error') {
  if (!err) return { code: fallbackCode, message: fallbackMessage };
  if (typeof err === 'string') return { code: fallbackCode, message: err };
  return {
    code: err.code || fallbackCode,
    message: err.message || fallbackMessage,
    ...(err.details ? { details: err.details } : {}),
  };
}

function normalizeType(value) {
  return String(value || '').toLowerCase().trim();
}

function assertDocType(type) {
  const normalized = normalizeType(type);
  if (!TYPE_CONFIG[normalized]) {
    throw {
      code: 'INVALID_TYPE',
      message: 'Invalid document type',
      details: { allowed: Object.keys(TYPE_CONFIG), received: type },
    };
  }
  return normalized;
}

function assertStatus(status) {
  if (!WORKFLOW_STATUSES.includes(status)) {
    throw {
      code: 'INVALID_STATUS',
      message: 'Invalid workflow status',
      details: { allowed: WORKFLOW_STATUSES, received: status },
    };
  }
}

function assertFilename(filename) {
  const cleaned = path.basename(String(filename || '').trim());
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw {
      code: 'INVALID_FILENAME',
      message: 'Filename is required and must be valid',
    };
  }
  return cleaned;
}

function validateStartupConfig() {
  const checks = [
    { key: 'JIRA_BASE_URL', ok: !!JIRA_BASE, level: 'warn', message: 'JIRA base URL is not set' },
    { key: 'JIRA_API_TOKEN', ok: !!JIRA_TOKEN, level: 'warn', message: 'JIRA API token is not configured; JIRA endpoints will return 503' },
    { key: 'JIRA_PROJECT', ok: !!JIRA_PROJECT, level: 'warn', message: 'JIRA project key is not set' },
  ];

  for (const check of checks) {
    if (check.ok) {
      logInfo('startup', `${check.key} configured`);
      continue;
    }
    if (check.level === 'warn') {
      logWarn('startup', check.message);
    } else {
      logError('startup', check.message);
    }
  }
}

function extractWorkflowStatus(content) {
  const m = content.match(/^Status:\s*(.+)$/m);
  if (m) {
    const val = m[1].trim();
    return WORKFLOW_STATUSES.includes(val) ? val : 'Draft';
  }
  return 'Draft';
}

// ── JIRA config & helpers ─────────────────────────────────────────────────────
const JIRA_BASE  = (process.env.JIRA_BASE_URL  || 'https://devstack.vwgroup.com/jira').replace(/\/$/, '');
const JIRA_TOKEN = process.env.JIRA_API_TOKEN  || '';
const JIRA_PROJECT = 'EAMDM';
const JIRA_LABEL   = 'MIDAS_Development';

// Map between local type names and JIRA issue type names
const LOCAL_TO_JIRA_TYPE = { epic: 'Epic', story: 'Story', spike: 'Task' };
const JIRA_TO_LOCAL_TYPE = { Epic: 'epic', Story: 'story', Task: 'spike' };

// Custom field IDs (discovered via /rest/api/2/field)
const FIELD_EPIC_NAME = 'customfield_10002'; // Epic Name (required when creating Epics)
const FIELD_EPIC_LINK = 'customfield_10000'; // Epic Link (set on Stories/Tasks to link to parent Epic)

async function jiraRequest(method, urlPath, body) {
  const url = `${JIRA_BASE}/rest/api/2${urlPath}`;
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${JIRA_TOKEN}`,
      'Accept': 'application/json',
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

// Scan all local docs for one whose JIRA_ID frontmatter field matches jiraId
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

// Convert a JIRA issue object into markdown content + metadata
function jiraIssueToMarkdown(issue) {
  const { key, fields } = issue;
  const summary     = (fields.summary || '').trim();
  const description = (fields.description || '').trim();
  const epicName    = (fields[FIELD_EPIC_NAME] || summary).trim();
  const issueType   = fields.issuetype?.name || 'Epic';
  const priority    = fields.priority?.name || 'Medium';
  const docType     = JIRA_TO_LOCAL_TYPE[issueType] || 'epic';

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
  return { docType, content, epicName };
}

// Extract a clean title from document content for use as JIRA Summary field
function extractJiraSummary(content) {
  // "## Story 1: Title" or "## Story 1: Title <!-- JIRA:KEY -->"
  const storyHeader = content.match(/^## Story \d+:\s*(.+?)(?:\s*<!--.*?-->)?\s*$/m);
  if (storyHeader) return storyHeader[1].trim();
  // Named title section: "## Epic Title\n\nActual Title Text"
  const namedSection = content.match(/^## (?:Epic|Spike) Title\s*\n+(.+)/m);
  if (namedSection) return namedSection[1].trim();
  // First ## heading
  const h2 = content.match(/^## (.+)/m);
  if (h2) return h2[1].replace(/<!--.*?-->/g, '').trim();
  // First # heading
  const h1 = content.match(/^# (.+)/m);
  if (h1) return h1[1].trim();
  return 'Untitled';
}

// Strip YAML frontmatter block — returns the body text for JIRA description
function stripFrontmatter(content) {
  return content.replace(/^---[\s\S]*?---\n?/, '').trim();
}

// ── Update or insert a field in the YAML frontmatter block.
function setFrontmatterField(content, field, value) {
  const re = new RegExp(`^(${field}:\\s*).*$`, 'm');
  if (re.test(content)) return content.replace(re, `$1${value}`);
  // Field missing — insert after opening ---
  return content.replace(/^---\n/, `---\n${field}: ${value}\n`);
}

// Runs `claude -p <prompt>` and returns full stdout.
// CLAUDE.md in __dirname is automatically used as the system prompt.
function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    let out = '', err = '';
    const proc = spawn('claude', ['-p', prompt], { cwd: __dirname });
    proc.stdout.on('data', d => out += d.toString());
    proc.stderr.on('data', d => err += d.toString());
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(err.trim() || `claude exited ${code}`));
      // Strip markdown code fences if Claude wrapped the output
      const trimmed = out.trim().replace(/^```(?:markdown)?\n?/, '').replace(/\n?```$/, '');
      resolve(trimmed);
    });
  });
}

// Same but streams stdout chunks via a callback (for SSE responses).
function streamClaude(prompt, onChunk) {
  return new Promise((resolve, reject) => {
    let err = '';
    const proc = spawn('claude', ['-p', prompt], { cwd: __dirname });
    proc.stdout.on('data', d => onChunk(d.toString()));
    proc.stderr.on('data', d => err += d.toString());
    proc.on('close', code =>
      code === 0 ? resolve() : reject(new Error(err.trim() || `claude exited ${code}`))
    );
  });
}

// ── POST /api/generate ── create epic / story / spike from web form ───────────
app.post('/api/generate', async (req, res) => {
  try {
    const { title, idea, priority = 'Medium', type = 'epic' } = req.body;
    if (!idea?.trim()) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Idea is required');
    }

    const normalizedType = assertDocType(type);
    const cfg = TYPE_CONFIG[normalizedType];

    const date = isoDate();
    const slug = slugify(title || idea.slice(0, 40));
    const filename = `${date}-${slug}.md`;

    const rawContent = `---
JIRA_ID: TBD
Story_Points: TBD
Status: Inbox — Awaiting Refinement
Priority: ${priority}
Created: ${new Date().toISOString()}
---

# ${title?.trim() || 'Untitled'}

## Raw Idea

${idea.trim()}
`;

    // 1. Save raw idea to inbox
    ensureDir(INBOX_DIR);
    fs.writeFileSync(path.join(INBOX_DIR, filename), rawContent);

    // 2. Process with the appropriate command
    const template = loadCommand(cfg.command);
    const prompt = template
      ? template.replace('$ARGUMENTS', `File: ${filename}\n\n${rawContent}`)
      : `Generate a complete ${type} using the COVE Framework. Output ONLY the markdown content.\n\nFile: ${filename}\n\n${rawContent}`;
    const generatedContent = await callClaude(prompt);

    // 3. Save to the correct docs folder (always start as Draft)
    const destDir = cfg.dir();
    ensureDir(destDir);
    const finalContent = setFrontmatterField(generatedContent, 'Status', 'Draft');
    fs.writeFileSync(path.join(destDir, filename), finalContent);

    // 4. Notify all open browser tabs
    broadcast({ type: cfg.event, filename, docType: normalizedType });

    res.json({ success: true, filename, docType: normalizedType });
  } catch (err) {
    const apiErr = parseApiError(err);
    logError('POST /api/generate', apiErr.message, apiErr.details || {});
    sendError(res, apiErr.code === 'VALIDATION_ERROR' || apiErr.code === 'INVALID_TYPE' ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
  }
});

// ── GET /api/docs ── list all docs across epics / stories / spikes ───────────
app.get('/api/docs', (req, res) => {
  try {
    const entries = [];
    for (const [docType, cfg] of Object.entries(TYPE_CONFIG)) {
      const dir = cfg.dir();
      ensureDir(dir);
      for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== '.gitkeep')) {
        const content = fs.readFileSync(path.join(dir, f), 'utf-8');
        const dateMatch = f.match(/^(\d{4}-\d{2}-\d{2})/);
        entries.push({
          filename: f,
          docType,
          title: extractTitle(content) || f.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace('.md', ''),
          date: dateMatch ? dateMatch[1] : '',
          status: extractWorkflowStatus(content)
        });
      }
    }
    entries.sort((a, b) => b.filename.localeCompare(a.filename));
    res.json(entries);
  } catch (err) {
    const apiErr = parseApiError(err);
    sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
  }
});

// ── GET /api/doc/:type/:filename ── read one document ────────────────────────
app.get('/api/doc/:type/:filename', (req, res) => {
  try {
    const docType = assertDocType(req.params.type);
    const cfg = TYPE_CONFIG[docType];
    const filename = assertFilename(req.params.filename);
    const filepath = path.join(cfg.dir(), filename);
    if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Document not found');
    const content = fs.readFileSync(filepath, 'utf-8');
    res.json({ filename, docType, content });
  } catch (err) {
    const apiErr = parseApiError(err);
    sendError(res, apiErr.code === 'INVALID_TYPE' || apiErr.code === 'INVALID_FILENAME' ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
  }
});

// ── PATCH /api/doc/:type/:filename ── update workflow status ─────────────────
app.patch('/api/doc/:type/:filename', (req, res) => {
  try {
    const docType = assertDocType(req.params.type);
    const cfg = TYPE_CONFIG[docType];
    const filename = assertFilename(req.params.filename);
    const filepath = path.join(cfg.dir(), filename);
    if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Document not found');

    const { status } = req.body;
    assertStatus(status);

    let content = fs.readFileSync(filepath, 'utf-8');
    content = setFrontmatterField(content, 'Status', status);
    fs.writeFileSync(filepath, content);

    broadcast({ type: 'status_updated', filename, docType, status });
    res.json({ success: true, status });
  } catch (err) {
    const apiErr = parseApiError(err);
    sendError(
      res,
      ['INVALID_TYPE', 'INVALID_FILENAME', 'INVALID_STATUS'].includes(apiErr.code) ? 400 : 500,
      apiErr.code,
      apiErr.message,
      apiErr.details
    );
  }
});

// ── DELETE /api/doc/:type/:filename ── delete a document ─────────────────────
app.delete('/api/doc/:type/:filename', (req, res) => {
  try {
    const docType = assertDocType(req.params.type);
    const cfg = TYPE_CONFIG[docType];
    const filename = assertFilename(req.params.filename);
    const filepath = path.join(cfg.dir(), filename);
    if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Document not found');

    fs.unlinkSync(filepath);
    broadcast({ type: 'doc_deleted', filename, docType });
    res.json({ success: true });
  } catch (err) {
    const apiErr = parseApiError(err);
    sendError(res, ['INVALID_TYPE', 'INVALID_FILENAME'].includes(apiErr.code) ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
  }
});

// ── GET /api/inbox/:filename ── read original inbox file ─────────────────────
app.get('/api/inbox/:filename', (req, res) => {
  try {
    const filename = assertFilename(req.params.filename);
    const filepath = path.join(INBOX_DIR, filename);
    if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Inbox file not found');
    res.json({ filename, content: fs.readFileSync(filepath, 'utf-8') });
  } catch (err) {
    const apiErr = parseApiError(err);
    sendError(res, apiErr.code === 'INVALID_FILENAME' ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
  }
});

// ── GET /api/stories/:filename ── read parsed story sections ─────────────────
app.get('/api/stories/:filename', (req, res) => {
  try {
    const filename = assertFilename(req.params.filename);
    const filepath = path.join(STORIES_DIR, filename);
    if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Stories file not found');
    const content = fs.readFileSync(filepath, 'utf-8');
    const { frontmatter, sections } = parseStorySections(content);
    res.json({
      filename,
      sections: sections.map((s, i) => ({ index: i, title: extractStoryTitle(s), content: s }))
    });
  } catch (err) {
    const apiErr = parseApiError(err);
    sendError(res, apiErr.code === 'INVALID_FILENAME' ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
  }
});

// ── POST /api/stories/:filename/upgrade-story ── upgrade one story (SSE) ─────
app.post('/api/stories/:filename/upgrade-story', async (req, res) => {
  let filename;
  let filepath;
  try {
    filename = assertFilename(req.params.filename);
    filepath = path.join(STORIES_DIR, filename);
  } catch (err) {
    const apiErr = parseApiError(err);
    return sendError(res, 400, apiErr.code, apiErr.message, apiErr.details);
  }
  if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Stories file not found');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = p => res.write(`data: ${JSON.stringify(p)}\n\n`);

  try {
    const { storyIndex, feedback } = req.body;
    if (!feedback?.trim()) { send({ error: { code: 'VALIDATION_ERROR', message: 'Feedback is required' } }); return res.end(); }

    const content = fs.readFileSync(filepath, 'utf-8');
    const { frontmatter, sections } = parseStorySections(content);
    if (storyIndex < 0 || storyIndex >= sections.length) {
      send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid story index' } }); return res.end();
    }

    // Load upgrade history from the original epic inbox file
    const epicFilename = filename.replace('-stories.md', '.md');
    const inboxPath = path.join(INBOX_DIR, epicFilename);
    const inboxHistory = fs.existsSync(inboxPath)
      ? `\n\nOriginal epic idea and upgrade history:\n---\n${fs.readFileSync(inboxPath, 'utf-8')}\n---`
      : '';

    const upgradePrompt = `You are upgrading a single User Story based on user feedback.

Current story:
---
${sections[storyIndex]}
---${inboxHistory}

New feedback / requested changes:
${feedback.trim()}

Rewrite ONLY this story incorporating the feedback. Keep the "## Story N: Title" heading format. Output ONLY the markdown — no files, no explanation.`;

    let newStory = '';
    await streamClaude(upgradePrompt, chunk => { newStory += chunk; send({ text: chunk }); });

    newStory = newStory.trim().replace(/^```(?:markdown)?\n?/, '').replace(/\n?```$/, '');
    sections[storyIndex] = newStory;
    fs.writeFileSync(filepath, serializeStoryFile(frontmatter, sections));

    // Append upgrade note to epic inbox file
    if (fs.existsSync(inboxPath)) {
      const note = `\n\n---\n\n## Story Upgrade Note — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} (Story ${storyIndex + 1})\n\n${feedback.trim()}\n`;
      fs.appendFileSync(inboxPath, note);
    }

    send({ done: true, title: extractStoryTitle(newStory), content: newStory });
    res.end();
  } catch (err) {
    const apiErr = parseApiError(err);
    logError('POST /api/stories/:filename/upgrade-story', apiErr.message, apiErr.details || {});
    send({ error: { code: apiErr.code, message: apiErr.message, ...(apiErr.details ? { details: apiErr.details } : {}) } });
    res.end();
  }
});

// ── DELETE /api/stories/:filename/story ── delete one story section ───────────
app.delete('/api/stories/:filename/story', (req, res) => {
  try {
    const filename = assertFilename(req.params.filename);
    const filepath = path.join(STORIES_DIR, filename);
    if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Stories file not found');

    const { storyIndex } = req.body;
    const content = fs.readFileSync(filepath, 'utf-8');
    const { frontmatter, sections } = parseStorySections(content);
    if (storyIndex < 0 || storyIndex >= sections.length) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid story index');
    }

    sections.splice(storyIndex, 1);
    fs.writeFileSync(filepath, serializeStoryFile(frontmatter, sections));
    res.json({ success: true, remaining: sections.length });
  } catch (err) {
    const apiErr = parseApiError(err);
    sendError(res, apiErr.code === 'INVALID_FILENAME' ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
  }
});

// ── POST /api/jira/push/:type/:filename ── push local doc to JIRA ────────────
app.post('/api/jira/push/:type/:filename', async (req, res) => {
  if (!JIRA_TOKEN) return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

  const docType = assertDocType(req.params.type);
  const cfg = TYPE_CONFIG[docType];

  const type     = docType;
  const filename = assertFilename(req.params.filename);
  const filepath = path.join(cfg.dir(), filename);
  if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Document not found');

  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    const { frontmatter, sections } = parseStorySections(content);

    // Detect a generated multi-section stories file (## Story 1: …, ## Story 2: …)
    const isMultiStory = type === 'story'
      && sections.length > 0
      && /^## Story \d+/m.test(sections[0]);

    // ── Multi-section stories file: push each section as a separate JIRA Story ──
    if (isMultiStory) {
      // Derive parent epic filename and read its JIRA_ID for the Epic Link field
      const epicFilename = filename.replace('-stories.md', '.md');
      const epicPath     = path.join(EPICS_DIR, epicFilename);
      let epicJiraId     = null;
      if (fs.existsSync(epicPath)) {
        const m = fs.readFileSync(epicPath, 'utf-8').match(/^JIRA_ID:\s*(.+)$/m);
        if (m && m[1].trim() !== 'TBD') epicJiraId = m[1].trim();
      }

      const results         = [];
      const updatedSections = [];

      for (let section of sections) {
        // Check if section header already carries an embedded JIRA key
        // e.g. "## Story 1: Title <!-- JIRA:EAMDM-123 -->"
        const headerMatch = section.match(/^(## Story \d+:\s*.+?)(?:\s*<!--\s*JIRA:(\S+?)\s*-->)?\s*$/m);
        const existingKey = headerMatch?.[2] || null;
        const storyTitle  = headerMatch
          ? headerMatch[1].replace(/^## Story \d+:\s*/, '').trim()
          : extractJiraSummary(section);

        let key;
        if (existingKey) {
          // Update description only
          await jiraRequest('PUT', `/issue/${existingKey}`, {
            fields: { description: section }
          });
          key = existingKey;
          results.push({ action: 'updated', key });
        } else {
          // Create new Story
          const fields = {
            project:   { key: JIRA_PROJECT },
            summary:   storyTitle,
            description: section,
            issuetype: { name: 'Story' },
            labels:    [JIRA_LABEL],
          };
          if (epicJiraId) fields[FIELD_EPIC_LINK] = epicJiraId;

          const created = await jiraRequest('POST', '/issue', { fields });
          key = created.key;
          results.push({ action: 'created', key });

          // Embed the new JIRA key into the section header so future syncs update it
          section = section.replace(
            /^(## Story \d+:\s*.+?)(\s*)$/m,
            `$1 <!-- JIRA:${key} -->`
          );
        }
        updatedSections.push(section);
      }

      // Rewrite stories file with embedded JIRA keys
      fs.writeFileSync(filepath, serializeStoryFile(frontmatter, updatedSections));
      // Reload story cards in all open tabs
      broadcast({ type: 'story_created', filename, docType: type });

      return res.json({ type: 'multi-story', results });
    }

    // ── Single issue: epic, spike, or standalone story ────────────────────────
    const jiraIdMatch = content.match(/^JIRA_ID:\s*(.+)$/m);
    const jiraId      = jiraIdMatch ? jiraIdMatch[1].trim() : 'TBD';
    const summary     = extractJiraSummary(content);
    const description = stripFrontmatter(content);
    const jiraType    = LOCAL_TO_JIRA_TYPE[type] || 'Story';

    let key, action;

    if (jiraId !== 'TBD') {
      // Update description of the existing issue
      await jiraRequest('PUT', `/issue/${jiraId}`, { fields: { description } });
      key    = jiraId;
      action = 'updated';
    } else {
      // Create a new issue
      const fields = {
        project:     { key: JIRA_PROJECT },
        summary,
        description,
        issuetype:   { name: jiraType },
        labels:      [JIRA_LABEL],
      };

      if (type === 'epic') {
        // Epic Name is a required short label shown in boards/roadmaps
        fields[FIELD_EPIC_NAME] = summary.slice(0, 60);
      }

      if (type === 'story') {
        // Link to parent epic via Epic Link field
        const epicFilename = filename.replace('-stories.md', '.md');
        const epicPath     = path.join(EPICS_DIR, epicFilename);
        if (fs.existsSync(epicPath)) {
          const m = fs.readFileSync(epicPath, 'utf-8').match(/^JIRA_ID:\s*(.+)$/m);
          if (m && m[1].trim() !== 'TBD') fields[FIELD_EPIC_LINK] = m[1].trim();
        }
      }

      const created = await jiraRequest('POST', '/issue', { fields });
      key    = created.key;
      action = 'created';

      // Write the returned JIRA key + new status back to the local file
      let updated = setFrontmatterField(content, 'JIRA_ID', key);
      updated     = setFrontmatterField(updated,  'Status',  'Created in JIRA');
      fs.writeFileSync(filepath, updated);
      broadcast({ type: 'status_updated', filename, docType: type, status: 'Created in JIRA' });
    }

    res.json({ action, key, filename, docType: type });
  } catch (err) {
    const apiErr = parseApiError(err);
    logError('POST /api/jira/push/:type/:filename', apiErr.message, apiErr.details || {});
    sendError(res, ['INVALID_TYPE', 'INVALID_FILENAME'].includes(apiErr.code) ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
  }
});

// ── GET /api/jira/search ── search JIRA issues ───────────────────────────────
app.get('/api/jira/search', async (req, res) => {
  try {
    if (!JIRA_TOKEN) return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

    const { type = 'all', text = '' } = req.query;
    if (type !== 'all' && !TYPE_CONFIG[normalizeType(type)]) {
      return sendError(res, 400, 'INVALID_TYPE', 'Invalid JIRA filter type', { allowed: ['all', ...Object.keys(TYPE_CONFIG)], received: type });
    }

    const typeClause = type === 'all'
      ? `issuetype in (Epic, Story, Task)`
      : `issuetype = "${LOCAL_TO_JIRA_TYPE[type] || 'Epic'}"`;

    const textClause = text.trim() ? ` AND text ~ "${text.trim().replace(/"/g, '')}"` : '';

    const jql = `project = ${JIRA_PROJECT} AND labels = ${JIRA_LABEL} AND ${typeClause}${textClause} ORDER BY updated DESC`;

    const fields = `summary,issuetype,status,priority,${FIELD_EPIC_NAME},description`;
    const data = await jiraRequest('GET', `/search?jql=${encodeURIComponent(jql)}&maxResults=50&fields=${fields}`);

    const issues = (data.issues || []).map(issue => {
      const existing = findLocalFileByJiraId(issue.key);
      return {
        key:         issue.key,
        summary:     issue.fields.summary || '',
        epicName:    issue.fields[FIELD_EPIC_NAME] || '',
        issuetype:   issue.fields.issuetype?.name || '',
        status:      issue.fields.status?.name || '',
        priority:    issue.fields.priority?.name || '',
        localExists: !!existing,
        localFilename: existing?.filename || null,
        localDocType:  existing?.docType || null,
      };
    });

    res.json({ issues, total: data.total });
  } catch (err) {
    const apiErr = parseApiError(err);
    logError('GET /api/jira/search', apiErr.message, apiErr.details || {});
    sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
  }
});

// ── POST /api/jira/pull ── download selected JIRA issues as local .md files ──
app.post('/api/jira/pull', async (req, res) => {
  try {
    if (!JIRA_TOKEN) return sendError(res, 503, 'JIRA_NOT_CONFIGURED', 'JIRA_API_TOKEN not configured');

    const { keys = [], overwriteKeys = [] } = req.body;
    if (!keys.length) return sendError(res, 400, 'VALIDATION_ERROR', 'No keys provided');

    const pulled    = [];
    const conflicts = [];

    for (const key of keys) {
      // Check for existing local file with this JIRA_ID
      const existing = findLocalFileByJiraId(key);
      if (existing && !overwriteKeys.includes(key)) {
        conflicts.push({ key, existingFilename: existing.filename, existingDocType: existing.docType });
        continue;
      }

      // Fetch full issue from JIRA
      const issue = await jiraRequest('GET', `/issue/${key}?fields=summary,issuetype,status,priority,description,${FIELD_EPIC_NAME}`);
      const { docType, content } = jiraIssueToMarkdown(issue);

      // Determine filename: reuse existing if overwriting, else generate new
      let filename;
      if (existing && overwriteKeys.includes(key)) {
        filename = existing.filename;
      } else {
        const slug = slugify(issue.fields.summary || key);
        filename = `${isoDate()}-${slug}.md`;
      }

      const destDir = TYPE_CONFIG[docType].dir();
      ensureDir(destDir);
      fs.writeFileSync(path.join(destDir, filename), content);

      pulled.push({ key, filename, docType });
      broadcast({ type: `${docType}_created`, filename, docType });
    }

    res.json({ pulled, conflicts });
  } catch (err) {
    const apiErr = parseApiError(err);
    logError('POST /api/jira/pull', apiErr.message, apiErr.details || {});
    sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
  }
});

// ── POST /api/doc/:type/:filename/upgrade ── regenerate with feedback ─────────
app.post('/api/doc/:type/:filename/upgrade', async (req, res) => {
  let docType;
  let cfg;
  let filename;
  let filepath;
  try {
    docType = assertDocType(req.params.type);
    cfg = TYPE_CONFIG[docType];
    filename = assertFilename(req.params.filename);
    filepath = path.join(cfg.dir(), filename);
  } catch (err) {
    const apiErr = parseApiError(err);
    return sendError(res, 400, apiErr.code, apiErr.message, apiErr.details);
  }
  if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Document not found');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  try {
    const { feedback } = req.body;
    if (!feedback?.trim()) { send({ error: { code: 'VALIDATION_ERROR', message: 'Feedback is required' } }); return res.end(); }

    const currentContent = fs.readFileSync(filepath, 'utf-8');
    const currentStatus  = extractWorkflowStatus(currentContent);

    // Load inbox file once — used for context in the prompt and for appending the note after
    const inboxPath = path.join(INBOX_DIR, filename);
    const inboxExists = fs.existsSync(inboxPath);
    const inboxHistory = inboxExists
      ? `\n\nOriginal idea and upgrade history (for context):\n---\n${fs.readFileSync(inboxPath, 'utf-8')}\n---`
      : '';

    const upgradePrompt = `You are upgrading an existing ${docType} document based on user feedback.

Current document:
---
${currentContent}
---${inboxHistory}

New feedback / requested changes:
${feedback.trim()}

Rewrite the complete document incorporating the feedback. Preserve all COVE sections and YAML frontmatter structure. Output ONLY the markdown content — do not write any files.`;

    let fullContent = '';
    await streamClaude(upgradePrompt, (chunk) => {
      fullContent += chunk;
      send({ text: chunk });
    });

    // Strip code fences, restore workflow status
    fullContent = fullContent.trim().replace(/^```(?:markdown)?\n?/, '').replace(/\n?```$/, '');
    fullContent = setFrontmatterField(fullContent, 'Status', currentStatus);

    fs.writeFileSync(filepath, fullContent);

    // Append upgrade note to the inbox file so future upgrades have full history
    if (inboxExists) {
      const note = `\n\n---\n\n## Upgrade Note — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}\n\n${feedback.trim()}\n`;
      fs.appendFileSync(inboxPath, note);
    }

    send({ done: true, content: fullContent });
    res.end();
  } catch (err) {
    const apiErr = parseApiError(err);
    logError('POST /api/doc/:type/:filename/upgrade', apiErr.message, apiErr.details || {});
    send({ error: { code: apiErr.code, message: apiErr.message, ...(apiErr.details ? { details: apiErr.details } : {}) } });
    res.end();
  }
});

// ── Legacy: keep /api/epics and /api/epic/:filename working ──────────────────
app.get('/api/epics', (_, res) => {
  try {
    ensureDir(EPICS_DIR);
    const files = fs.readdirSync(EPICS_DIR)
      .filter(f => f.endsWith('.md') && f !== '.gitkeep')
      .map(f => {
        const content = fs.readFileSync(path.join(EPICS_DIR, f), 'utf-8');
        const dateMatch = f.match(/^(\d{4}-\d{2}-\d{2})/);
        return { filename: f, docType: 'epic', title: extractTitle(content) || f.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace('.md', ''), date: dateMatch ? dateMatch[1] : '' };
      })
      .sort((a, b) => b.filename.localeCompare(a.filename));
    res.json(files);
  } catch (err) {
    const apiErr = parseApiError(err);
    sendError(res, 500, apiErr.code, apiErr.message, apiErr.details);
  }
});

app.get('/api/epic/:filename', (req, res) => {
  try {
    const filename = assertFilename(req.params.filename);
    const filepath = path.join(EPICS_DIR, filename);
    if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Epic not found');
    res.json({ filename, docType: 'epic', content: fs.readFileSync(filepath, 'utf-8') });
  } catch (err) {
    const apiErr = parseApiError(err);
    sendError(res, apiErr.code === 'INVALID_FILENAME' ? 400 : 500, apiErr.code, apiErr.message, apiErr.details);
  }
});

// ── POST /api/epic/:filename/stories ── stream story generation ───────────────
app.post('/api/epic/:filename/stories', async (req, res) => {
  let filename;
  let filepath;
  try {
    filename = assertFilename(req.params.filename);
    filepath = path.join(EPICS_DIR, filename);
  } catch (err) {
    const apiErr = parseApiError(err);
    return sendError(res, 400, apiErr.code, apiErr.message, apiErr.details);
  }

  if (!fs.existsSync(filepath)) return sendError(res, 404, 'NOT_FOUND', 'Epic not found');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  try {
    const epicContent = fs.readFileSync(filepath, 'utf-8');

    const storiesTemplate = loadCommand('create-stories');
    const storiesPrompt = storiesTemplate
      ? storiesTemplate.replace('$ARGUMENTS', epicContent)
      : `Break down the following Epic into 3–6 INVEST-compliant User Stories with Gherkin acceptance criteria. Output ONLY the markdown content.\n\n${epicContent}`;

    let fullContent = '';

    await streamClaude(storiesPrompt, (chunk) => {
      fullContent += chunk;
      send({ text: chunk });
    });

    const storyFilename = filename.replace('.md', '-stories.md');
    ensureDir(STORIES_DIR);
    fs.writeFileSync(path.join(STORIES_DIR, storyFilename), fullContent);

    send({ done: true, filename: storyFilename });
    res.end();
  } catch (err) {
    const apiErr = parseApiError(err);
    logError('POST /api/epic/:filename/stories', apiErr.message, apiErr.details || {});
    send({ error: { code: apiErr.code, message: apiErr.message, ...(apiErr.details ? { details: apiErr.details } : {}) } });
    res.end();
  }
});

// ── Server start ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  validateStartupConfig();
  logInfo('startup', `Backlog Claude running on http://localhost:${PORT}`);
  watchInbox();
});

// ── Inbox watcher ─────────────────────────────────────────────────────────────
// Picks up any .md file dropped into /inbox and saves the generated Epic to
// docs/epics. Also notifies all open browser tabs via SSE.

function watchInbox() {
  ensureDir(INBOX_DIR);

  // Process unmatched files already in inbox on startup
  for (const f of fs.readdirSync(INBOX_DIR).filter(isInboxFile)) {
    if (!fs.existsSync(path.join(EPICS_DIR, f))) processInboxFile(f);
  }

  fs.watch(INBOX_DIR, (event, filename) => {
    if (event !== 'rename' || !filename || !isInboxFile(filename)) return;
    setTimeout(() => {
      const exists = fs.existsSync(path.join(INBOX_DIR, filename));
      const already = fs.existsSync(path.join(EPICS_DIR, filename));
      if (exists && !already) processInboxFile(filename);
    }, 500);
  });

  console.log(`👀 Watching /inbox for new files…`);
}

function isInboxFile(f) {
  return f.endsWith('.md') && f !== '.gitkeep';
}

async function processInboxFile(filename) {
  console.log(`\n📥 New inbox file: ${filename}`);
  try {
    const inboxContent = fs.readFileSync(path.join(INBOX_DIR, filename), 'utf-8');

    console.log(`   ✍️  Claude is writing the Epic…`);
    const epicTemplate = loadCommand('create-epics');
    const epicPrompt = epicTemplate
      ? epicTemplate.replace('$ARGUMENTS', `File: ${filename}\n\n${inboxContent}`)
      : `Generate a complete Epic using the COVE Framework. Output ONLY the markdown content.\n\nFile: ${filename}\n\n${inboxContent}`;
    const epicContent = await callClaude(epicPrompt);

    ensureDir(EPICS_DIR);
    fs.writeFileSync(path.join(EPICS_DIR, filename), epicContent);

    console.log(`   ✅ Epic saved → docs/epics/${filename}`);

    // Push live update to all open browser tabs
    broadcast({ type: 'epic_created', filename });
  } catch (err) {
    logError('watchInbox/processInboxFile', `Failed to process ${filename}`, { error: err.message });
  }
}
