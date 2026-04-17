import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

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

function extractWorkflowStatus(content) {
  const m = content.match(/^Status:\s*(.+)$/m);
  if (m) {
    const val = m[1].trim();
    return WORKFLOW_STATUSES.includes(val) ? val : 'Draft';
  }
  return 'Draft';
}

// Update or insert a field in the YAML frontmatter block.
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
    if (!idea?.trim()) return res.status(400).json({ error: 'Idea is required' });

    const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.epic;

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
    broadcast({ type: cfg.event, filename, docType: type });

    res.json({ success: true, filename, docType: type });
  } catch (err) {
    console.error('[POST /api/generate]', err.message);
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/doc/:type/:filename ── read one document ────────────────────────
app.get('/api/doc/:type/:filename', (req, res) => {
  try {
    const cfg = TYPE_CONFIG[req.params.type];
    if (!cfg) return res.status(400).json({ error: 'Invalid type' });
    const filename = path.basename(req.params.filename);
    const filepath = path.join(cfg.dir(), filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Not found' });
    const content = fs.readFileSync(filepath, 'utf-8');
    res.json({ filename, docType: req.params.type, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/doc/:type/:filename ── update workflow status ─────────────────
app.patch('/api/doc/:type/:filename', (req, res) => {
  try {
    const cfg = TYPE_CONFIG[req.params.type];
    if (!cfg) return res.status(400).json({ error: 'Invalid type' });
    const filename = path.basename(req.params.filename);
    const filepath = path.join(cfg.dir(), filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Not found' });

    const { status } = req.body;
    if (!WORKFLOW_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    let content = fs.readFileSync(filepath, 'utf-8');
    content = setFrontmatterField(content, 'Status', status);
    fs.writeFileSync(filepath, content);

    broadcast({ type: 'status_updated', filename, docType: req.params.type, status });
    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/doc/:type/:filename ── delete a document ─────────────────────
app.delete('/api/doc/:type/:filename', (req, res) => {
  try {
    const cfg = TYPE_CONFIG[req.params.type];
    if (!cfg) return res.status(400).json({ error: 'Invalid type' });
    const filename = path.basename(req.params.filename);
    const filepath = path.join(cfg.dir(), filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Not found' });

    fs.unlinkSync(filepath);
    broadcast({ type: 'doc_deleted', filename, docType: req.params.type });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/epic/:filename', (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    const filepath = path.join(EPICS_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Not found' });
    res.json({ filename, docType: 'epic', content: fs.readFileSync(filepath, 'utf-8') });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/epic/:filename/stories ── stream story generation ───────────────
app.post('/api/epic/:filename/stories', async (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(EPICS_DIR, filename);

  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Not found' });

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
    console.error('[POST /api/epic/stories]', err.message);
    send({ error: err.message });
    res.end();
  }
});

// ── Server start ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n⚡ Backlog Claude running → http://localhost:${PORT}\n`);
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
    console.error(`   ❌ Failed to process ${filename}:`, err.message);
  }
}
