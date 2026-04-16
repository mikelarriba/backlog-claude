import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(__dirname));

// ── helpers ──────────────────────────────────────────────────────────────────

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 50);
}

function pad(n) { return String(n).padStart(2, '0'); }

function isoDate() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Run `claude -p <prompt>` and return the full text output.
// The CLAUDE.md in __dirname is automatically used as the system prompt.
function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    let out = '', err = '';
    const proc = spawn('claude', ['-p', prompt], { cwd: __dirname });
    proc.stdout.on('data', d => out += d.toString());
    proc.stderr.on('data', d => err += d.toString());
    proc.on('close', code =>
      code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `claude exited ${code}`))
    );
  });
}

// Same as callClaude but streams stdout chunks into an SSE response.
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

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function extractTitle(content) {
  const m = content.match(/^## Epic Title\s*\n+(.+)/m)
    || content.match(/^# (.+)/m)
    || content.match(/^## (.+)/m);
  return m ? m[1].trim() : null;
}

// ── POST /api/epic ── create epic from idea ───────────────────────────────────
app.post('/api/epic', async (req, res) => {
  try {
    const { title, idea, priority = 'Medium' } = req.body;
    if (!idea?.trim()) return res.status(400).json({ error: 'Idea is required' });

    const date = isoDate();
    const slug = slugify(title || idea.slice(0, 40));
    const filename = `${date}-${slug}.md`;

    const inboxContent = `---
JIRA_ID: TBD
Story_Points: TBD
Status: Inbox — Awaiting Refinement
Priority: ${priority}
Created: ${new Date().toISOString()}
---

# ${title?.trim() || 'Untitled Epic'}

## Raw Idea

${idea.trim()}
`;

    // 1. Save to inbox
    ensureDir(path.join(__dirname, 'inbox'));
    fs.writeFileSync(path.join(__dirname, 'inbox', filename), inboxContent);

    // 2. Process with Claude Code CLI — uses CLAUDE.md as system prompt automatically
    const backlogContent = await callClaude(
      `Process this new idea from the inbox. Generate a complete Epic following your instructions.\n\nFile: ${filename}\n\n${inboxContent}`
    );

    // 3. Save to backlog
    ensureDir(path.join(__dirname, 'backlog'));
    fs.writeFileSync(path.join(__dirname, 'backlog', filename), backlogContent);

    res.json({ success: true, filename });
  } catch (err) {
    console.error('[POST /api/epic]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/epics ── list backlog ─────────────────────────────────────────────
app.get('/api/epics', (req, res) => {
  try {
    const dir = path.join(__dirname, 'backlog');
    ensureDir(dir);

    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.md') && f !== '.gitkeep')
      .map(f => {
        const content = fs.readFileSync(path.join(dir, f), 'utf-8');
        const dateMatch = f.match(/^(\d{4}-\d{2}-\d{2})/);
        return {
          filename: f,
          title: extractTitle(content) || f.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace('.md', ''),
          date: dateMatch ? dateMatch[1] : ''
        };
      })
      .sort((a, b) => b.filename.localeCompare(a.filename));

    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/epic/:filename ── get one epic ────────────────────────────────────
app.get('/api/epic/:filename', (req, res) => {
  try {
    const filename = path.basename(req.params.filename); // prevent traversal
    const filepath = path.join(__dirname, 'backlog', filename);

    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Not found' });

    const content = fs.readFileSync(filepath, 'utf-8');
    res.json({ filename, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/epic/:filename/stories ── stream user story generation ──────────
app.post('/api/epic/:filename/stories', async (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(__dirname, 'backlog', filename);

  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  try {
    const epicContent = fs.readFileSync(filepath, 'utf-8');

    const storiesPrompt = `You are a Product Owner agent breaking down an Epic into User Stories.

For each story follow the COVE Framework:
- **C - Context**: Why are we building this now?
- **O - Objective**: The specific, measurable goal.
- **V - Value**: The benefit to the user or business.
- **E - Execution**: High-level technical steps.

Also write Acceptance Criteria in Gherkin (Given/When/Then) per story.

Start with YAML frontmatter:
---
JIRA_ID: TBD
Story_Points: TBD
Status: Ready for Development
Created: ${isoDate()}
---

Then for each story:
## Story [N]: [Title]
**Context:** ...  **Objective:** ...  **Value:** ...  **Execution:** ...
### Acceptance Criteria
\`\`\`gherkin
Given ... When ... Then ...
\`\`\`

Generate 3–6 stories covering the full Epic scope.

---

Epic to break down:

${epicContent}`;

    let fullContent = '';

    await streamClaude(storiesPrompt, (chunk) => {
      fullContent += chunk;
      send({ text: chunk });
    });

    // Save stories file
    const storyFilename = filename.replace('.md', '-stories.md');
    ensureDir(path.join(__dirname, 'docs', 'stories'));
    fs.writeFileSync(path.join(__dirname, 'docs', 'stories', storyFilename), fullContent);

    send({ done: true, filename: storyFilename });
    res.end();
  } catch (err) {
    console.error('[POST /api/epic/stories]', err.message);
    send({ error: err.message });
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`\n⚡ Backlog Claude running → http://localhost:${PORT}\n`);
  watchInbox();
});

// ── Inbox watcher ─────────────────────────────────────────────────────────────
// Automatically processes any .md file dropped into /inbox that doesn't yet
// have a corresponding file in /backlog.

function watchInbox() {
  const inboxDir = path.join(__dirname, 'inbox');
  ensureDir(inboxDir);

  // Process any files already in inbox that have no backlog entry (e.g. on restart)
  for (const f of fs.readdirSync(inboxDir).filter(isInboxFile)) {
    const backlogPath = path.join(__dirname, 'backlog', f);
    if (!fs.existsSync(backlogPath)) processInboxFile(f);
  }

  fs.watch(inboxDir, (event, filename) => {
    if (event !== 'rename' || !filename || !isInboxFile(filename)) return;

    const inboxPath = path.join(inboxDir, filename);
    const backlogPath = path.join(__dirname, 'backlog', filename);

    // Wait briefly for the write to complete, then check the file exists
    // and hasn't already been processed
    setTimeout(() => {
      if (fs.existsSync(inboxPath) && !fs.existsSync(backlogPath)) {
        processInboxFile(filename);
      }
    }, 500);
  });

  console.log(`👀 Watching /inbox for new files…`);
}

function isInboxFile(filename) {
  return filename.endsWith('.md') && filename !== '.gitkeep';
}

async function processInboxFile(filename) {
  const inboxPath = path.join(__dirname, 'inbox', filename);
  const backlogPath = path.join(__dirname, 'backlog', filename);

  console.log(`\n📥 New inbox file: ${filename}`);

  try {
    const inboxContent = fs.readFileSync(inboxPath, 'utf-8');

    console.log(`   ✍️  Claude is writing the Epic…`);
    const backlogContent = await callClaude(
      `Process this new idea from the inbox. Generate a complete Epic following your instructions.\n\nFile: ${filename}\n\n${inboxContent}`
    );

    ensureDir(path.join(__dirname, 'backlog'));
    fs.writeFileSync(backlogPath, backlogContent);

    console.log(`   ✅ Epic saved → backlog/${filename}`);
  } catch (err) {
    console.error(`   ❌ Failed to process ${filename}:`, err.message);
  }
}
