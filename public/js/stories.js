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
    wrap.style.display = 'none';
    stream.textContent = '';

    if (donePayload) {
      await loadDocs();
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
