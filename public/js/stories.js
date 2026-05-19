// ── Stories: stream reset ──────────────────────────────────────
function resetStoriesSection() {
  const wrap = document.getElementById('stories-stream-wrap');
  if (wrap) wrap.classList.add('hidden');
  const stream = document.getElementById('stories-stream');
  if (stream) stream.textContent = '';
  const spinner = document.getElementById('stories-spinner');
  if (spinner) spinner.classList.add('hidden');
  const bar = document.getElementById('stories-progress');
  if (bar) bar.classList.add('hidden');
}

// ── Generate / Regenerate Stories ─────────────────────────────
async function generateStories() {
  if (!currentFilename) return;

  const btn     = document.getElementById('stories-btn');
  const wrap    = document.getElementById('stories-stream-wrap');
  const stream  = document.getElementById('stories-stream');
  const spinner = document.getElementById('stories-spinner');
  const bar     = document.getElementById('stories-progress');
  const barFill = document.getElementById('stories-progress-fill');
  const barText = document.getElementById('stories-progress-text');

  btn.disabled = true;
  btn.textContent = '⏳ Generating…';
  stream.textContent = '';
  wrap.classList.remove('hidden');
  spinner.classList.remove('hidden');
  if (bar) bar.classList.add('hidden');
  wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    let donePayload = null;
    await streamSSE(
      `/api/epic/${encodeURIComponent(currentFilename)}/stories`,
      {},
      {
        onText: (text) => { stream.textContent += text; },
        onDone: (payload) => { donePayload = payload; },
        onProgress: (progress) => {
          // Show progress bar, hide streaming text
          spinner.classList.add('hidden');
          stream.textContent = '';
          if (bar) {
            bar.classList.remove('hidden');
            const pct = Math.round((progress.current / progress.total) * 100);
            if (barFill) barFill.style.width = `${pct}%`;
            if (barText) barText.textContent = `Saving story ${progress.current} of ${progress.total}: ${progress.title}`;
          }
        },
      }
    );

    spinner.classList.add('hidden');
    stream.textContent = '';

    if (donePayload?.files?.length) {
      const count = donePayload.files.length;
      if (bar) bar.classList.add('hidden');
      stream.textContent = `✅ Created ${count} stor${count === 1 ? 'y' : 'ies'}:\n` +
        donePayload.files.map(f => `• ${f.title}`).join('\n');
      wrap.classList.remove('hidden');

      // Sequential refresh: loadDocs first, then hierarchy
      await loadDocs();
      loadHierarchy(currentFilename, currentDocType);

      // Refresh canvas if refine view is open
      if (typeof _canvasEpicFilename !== 'undefined' && _canvasEpicFilename === currentFilename) {
        await buildCanvasGraph(_canvasEpicFilename, _canvasDocType);
      }
    } else {
      wrap.classList.add('hidden');
    }

    btn.disabled = false;
    btn.textContent = 'AI Story Generation';

  } catch (e) {
    spinner.classList.add('hidden');
    if (bar) bar.classList.add('hidden');
    stream.textContent += `\n\n❌ Error: ${e.message}`;
    btn.disabled = false;
    btn.textContent = 'AI Story Generation';
  }
}
