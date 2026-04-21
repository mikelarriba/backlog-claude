// ── Stories: reset, load, render ──────────────────────────────
function resetStoriesSection() {
  currentStoriesFilename = null;
  document.getElementById('stories-section').style.display = 'none';
  document.getElementById('stories-cards').innerHTML = '';
  document.getElementById('stories-stream').style.display = 'none';
  document.getElementById('stories-stream').textContent = '';
  document.getElementById('stories-spinner').style.display = 'none';
  document.getElementById('stories-count').style.display = 'none';
  document.getElementById('stories-body').classList.add('open');
  document.getElementById('stories-chevron').style.transform = '';
}

async function loadStoriesForEpic(epicFilename) {
  const storiesFilename = epicFilename.replace('.md', '-stories.md');
  try {
    const res = await fetch(`/api/stories/${encodeURIComponent(storiesFilename)}`);
    if (!res.ok) return;
    const { sections } = await res.json();
    if (!sections.length) return;
    renderStoryCards(sections, storiesFilename);
  } catch {}
}

function renderStoryCards(sections, storiesFilename) {
  currentStoriesFilename = storiesFilename;
  const container = document.getElementById('stories-cards');
  const countEl   = document.getElementById('stories-count');
  const btn       = document.getElementById('stories-btn');

  countEl.textContent = sections.length;
  countEl.style.display = 'inline';
  btn.textContent = '↺ Regenerate';

  container.innerHTML = sections.map((s, i) => `
    <div class="story-card" id="story-card-${i}">
      <div class="story-card-header">
        <div class="story-card-toggle" onclick="toggleStoryCard(${i})">
          <span class="story-card-chevron" id="story-chevron-${i}">▶</span>
          <span class="story-card-title">${escHtml(s.title)}</span>
        </div>
        <div class="story-card-actions">
          <button class="btn-xs green" onclick="openStoryUpgrade(${i}, event)">↑ Upgrade</button>
          <button class="btn-xs red"   onclick="deleteStory(${i}, event)">Delete</button>
        </div>
      </div>
      <div class="story-card-body" id="story-body-${i}">
        <div class="story-upgrade-panel" id="story-upgrade-${i}">
          <textarea class="story-upgrade-textarea" id="story-feedback-${i}" placeholder="What to change or improve in this story…"></textarea>
          <div class="story-upgrade-actions">
            <button class="btn-xs green" id="story-upgrade-btn-${i}" onclick="executeStoryUpgrade(${i})">Regenerate</button>
            <button class="btn-xs" onclick="closeStoryUpgrade(${i})">Cancel</button>
          </div>
          <div class="story-upgrade-stream" id="story-stream-${i}"></div>
        </div>
        <div class="story-card-content markdown" id="story-content-${i}">${marked.parse(s.content)}</div>
      </div>
    </div>`).join('');

  document.getElementById('stories-section').style.display = 'block';
  document.getElementById('stories-section').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function toggleStoriesSection() {
  const body    = document.getElementById('stories-body');
  const chevron = document.getElementById('stories-chevron');
  const isOpen  = body.classList.toggle('open');
  chevron.style.transform = isOpen ? '' : 'rotate(-90deg)';
}

function toggleStoryCard(index) {
  const body    = document.getElementById(`story-body-${index}`);
  const chevron = document.getElementById(`story-chevron-${index}`);
  const isOpen  = body.classList.toggle('open');
  chevron.style.transform = isOpen ? 'rotate(90deg)' : '';
}

// ── Per-story upgrade ──────────────────────────────────────────
function openStoryUpgrade(index, event) {
  event.stopPropagation();
  const body = document.getElementById(`story-body-${index}`);
  if (!body.classList.contains('open')) toggleStoryCard(index);
  document.getElementById(`story-upgrade-${index}`).classList.add('open');
  document.getElementById(`story-feedback-${index}`).focus();
}

function closeStoryUpgrade(index) {
  document.getElementById(`story-upgrade-${index}`).classList.remove('open');
  document.getElementById(`story-feedback-${index}`).value = '';
  document.getElementById(`story-stream-${index}`).style.display = 'none';
  document.getElementById(`story-stream-${index}`).textContent = '';
  const btn = document.getElementById(`story-upgrade-btn-${index}`);
  btn.disabled = false; btn.textContent = 'Regenerate';
}

async function executeStoryUpgrade(index) {
  if (!currentStoriesFilename) return;
  const feedback = document.getElementById(`story-feedback-${index}`).value.trim();
  if (!feedback) { document.getElementById(`story-feedback-${index}`).focus(); return; }

  const btn    = document.getElementById(`story-upgrade-btn-${index}`);
  const stream = document.getElementById(`story-stream-${index}`);
  btn.disabled = true; btn.textContent = '⏳ Regenerating…';
  stream.textContent = ''; stream.style.display = 'block';

  try {
    const res = await fetch(
      `/api/stories/${encodeURIComponent(currentStoriesFilename)}/upgrade-story`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyIndex: index, feedback }) }
    );
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', result = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const p = JSON.parse(line.slice(6));
          if (p.text)  stream.textContent += p.text;
          if (p.error) throw new Error(getErrorMessage(p.error, 'Story upgrade failed'));
          if (p.done)  result = p;
        } catch (e) { if (e.message !== 'Unexpected token') throw e; }
      }
    }

    if (result) {
      document.getElementById(`story-content-${index}`).innerHTML = marked.parse(result.content);
      document.querySelector(`#story-card-${index} .story-card-title`).textContent = result.title;
    }
    closeStoryUpgrade(index);
  } catch (e) {
    stream.textContent += `\n\n❌ ${e.message}`;
    btn.disabled = false; btn.textContent = 'Regenerate';
  }
}

// ── Per-story delete ───────────────────────────────────────────
async function deleteStory(index, event) {
  event.stopPropagation();
  if (!currentStoriesFilename) return;
  if (!confirm(`Delete Story ${index + 1}? This cannot be undone.`)) return;

  try {
    const res = await fetch(
      `/api/stories/${encodeURIComponent(currentStoriesFilename)}/story`,
      { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyIndex: index }) }
    );
    if (!res.ok) throw new Error(getErrorMessage((await res.json()).error, 'Delete failed'));
    await loadStoriesForEpic(currentFilename);
  } catch (e) {
    alert(`Failed to delete story: ${e.message}`);
  }
}

// ── Generate / Regenerate Stories ─────────────────────────────
async function generateStories() {
  if (!currentFilename) return;

  const btn     = document.getElementById('stories-btn');
  const section = document.getElementById('stories-section');
  const stream  = document.getElementById('stories-stream');
  const spinner = document.getElementById('stories-spinner');

  btn.disabled = true;
  btn.textContent = '⏳ Generating…';
  document.getElementById('stories-cards').innerHTML = '';
  stream.textContent = '';
  stream.style.display = 'block';
  section.style.display = 'block';
  spinner.style.display = 'inline-block';
  document.getElementById('stories-body').classList.add('open');
  section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    const res = await fetch(`/api/epic/${encodeURIComponent(currentFilename)}/stories`, { method: 'POST' });
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', donePayload = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const p = JSON.parse(line.slice(6));
          if (p.text)  stream.textContent += p.text;
          if (p.error) throw new Error(getErrorMessage(p.error, 'Story generation failed'));
          if (p.done)  donePayload = p;
        } catch {}
      }
    }

    spinner.style.display = 'none';
    stream.style.display = 'none';
    if (donePayload) await loadStoriesForEpic(currentFilename);

  } catch (e) {
    spinner.style.display = 'none';
    stream.textContent += `\n\n❌ Error: ${e.message}`;
    btn.disabled = false;
    btn.textContent = '✨ Refine into Stories';
  }
}
