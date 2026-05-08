// ── Stories: stream reset ──────────────────────────────────────
function resetStoriesSection() {
  const wrap = document.getElementById('stories-stream-wrap');
  if (wrap) wrap.classList.add('hidden');
  const stream = document.getElementById('stories-stream');
  if (stream) stream.textContent = '';
  const spinner = document.getElementById('stories-spinner');
  if (spinner) spinner.classList.add('hidden');
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
  wrap.classList.remove('hidden');
  spinner.classList.remove('hidden');
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

    spinner.classList.add('hidden');
    stream.textContent = '';

    if (donePayload?.files?.length) {
      const count = donePayload.files.length;
      stream.textContent = `✅ Created ${count} stor${count === 1 ? 'y' : 'ies'}:\n` +
        donePayload.files.map(f => `• ${f.title}`).join('\n');
      wrap.classList.remove('hidden');
      setTimeout(() => { wrap.classList.add('hidden'); stream.textContent = ''; }, 4000);
      loadHierarchy(currentFilename, currentDocType);
    } else {
      wrap.classList.add('hidden');
    }

    btn.disabled = false;
    btn.textContent = 'AI Story Generation';

  } catch (e) {
    spinner.classList.add('hidden');
    stream.textContent += `\n\n❌ Error: ${e.message}`;
    btn.disabled = false;
    btn.textContent = '✨ Refine';
  }
}
