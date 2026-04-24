// ── Stories: stream reset ──────────────────────────────────────
function resetStoriesSection() {
  const wrap = document.getElementById('stories-stream-wrap');
  if (wrap) wrap.style.display = 'none';
  const stream = document.getElementById('stories-stream');
  if (stream) stream.textContent = '';
  const spinner = document.getElementById('stories-spinner');
  if (spinner) spinner.style.display = 'none';
}

// ── Generate / Regenerate Stories ─────────────────────────────
async function generateStories() {
  if (!currentFilename) return;

  const btn     = document.getElementById('stories-btn');
  const wrap    = document.getElementById('stories-stream-wrap');
  const stream  = document.getElementById('stories-stream');
  const spinner = document.getElementById('stories-spinner');

  btn.disabled = true;
  btn.textContent = '⏳ Generating…';
  stream.textContent = '';
  wrap.style.display = 'block';
  spinner.style.display = 'inline-block';
  wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    let donePayload = null;
    await streamSSE(
      `/api/epic/${encodeURIComponent(currentFilename)}/stories`,
      {},
      {
        onText: (text) => { stream.textContent += text; },
        onDone: (payload) => { donePayload = payload; },
      }
    );

    spinner.style.display = 'none';
    wrap.style.display = 'none';
    stream.textContent = '';

    if (donePayload) {
      loadHierarchy(currentFilename, currentDocType);
    }

    btn.disabled = false;
    btn.textContent = '✨ Refine';

  } catch (e) {
    spinner.style.display = 'none';
    stream.textContent += `\n\n❌ Error: ${e.message}`;
    btn.disabled = false;
    btn.textContent = '✨ Refine';
  }
}
