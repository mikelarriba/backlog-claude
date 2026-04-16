import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(__dirname));

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

// ── helpers ──────────────────────────────────────────────────────────────────

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 50);
}

function pad(n) { return String(n).padStart(2, '0'); }

function isoDate() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function readSystemPrompt() {
  return fs.readFileSync(path.join(__dirname, 'CLAUDE.md'), 'utf-8');
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

    // 2. Process with Claude (system prompt from CLAUDE.md, prompt-cached)
    const systemPrompt = readSystemPrompt();

    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      system: [
        { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }
      ],
      messages: [{
        role: 'user',
        content: `Process this new idea from the inbox. Generate a complete Epic following your instructions.\n\nFile: ${filename}\n\n${inboxContent}`
      }]
    });

    const backlogContent = response.content[0].text;

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

    const storiesSystemPrompt = `You are a Product Owner agent. Your task is to break down an Epic into detailed User Stories.

For each User Story follow the COVE Framework strictly:
- **C - Context**: The background. Why are we building this now?
- **O - Objective**: The specific, measurable goal of this ticket.
- **V - Value**: The "So What?" — the benefit to the user or business.
- **E - Execution**: High-level technical steps to implement.

Also write Acceptance Criteria in Gherkin format (Given / When / Then) for each story.

## Output Format

Start with YAML frontmatter, then list all stories:

\`\`\`
---
JIRA_ID: TBD
Story_Points: TBD
Status: Ready for Development
Created: ${isoDate()}
---
\`\`\`

Then for each story:

## Story [N]: [Title]

**Context:** ...
**Objective:** ...
**Value:** ...
**Execution:** ...

### Acceptance Criteria

\`\`\`gherkin
Feature: [Feature Name]

  Scenario: [Scenario Name]
    Given [initial context]
    When [action taken]
    Then [expected outcome]
\`\`\`

Generate between 3 and 6 stories that fully cover the Epic scope.`;

    let fullContent = '';

    const stream = client.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 8000,
      system: [
        { type: 'text', text: storiesSystemPrompt, cache_control: { type: 'ephemeral' } }
      ],
      messages: [{
        role: 'user',
        content: `Generate comprehensive User Stories for this Epic:\n\n${epicContent}`
      }]
    });

    stream.on('text', (text) => {
      fullContent += text;
      send({ text });
    });

    await stream.finalMessage();

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
});
