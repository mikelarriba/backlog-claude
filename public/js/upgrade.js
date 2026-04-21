// ── Upgrade panel ─────────────────────────────────────────────
function toggleUpgradePanel() {
  const panel  = document.getElementById('upgrade-panel');
  const isOpen = panel.classList.toggle('open');
  if (isOpen) {
    document.getElementById('upgrade-feedback').focus();
  } else {
    resetUpgradePanel();
  }
}

function resetUpgradePanel() {
  document.getElementById('upgrade-feedback').value = '';
  document.getElementById('upgrade-stream').style.display = 'none';
  document.getElementById('upgrade-stream').textContent = '';
  const btn = document.getElementById('upgrade-run-btn');
  btn.disabled = false;
  btn.textContent = 'Regenerate';
}

async function executeUpgrade() {
  if (!currentFilename || !currentDocType) return;
  const feedback = document.getElementById('upgrade-feedback').value.trim();
  if (!feedback) { document.getElementById('upgrade-feedback').focus(); return; }

  const btn    = document.getElementById('upgrade-run-btn');
  const stream = document.getElementById('upgrade-stream');

  btn.disabled = true;
  btn.textContent = '⏳ Regenerating…';
  stream.textContent = '';
  stream.style.display = 'block';

  try {
    const res = await fetch(
      `/api/doc/${currentDocType}/${encodeURIComponent(currentFilename)}/upgrade`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feedback }) }
    );

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', finalContent = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const payload = JSON.parse(line.slice(6));
          if (payload.text)  stream.textContent += payload.text;
          if (payload.error) throw new Error(getErrorMessage(payload.error, 'Upgrade failed'));
          if (payload.done)  finalContent = payload.content;
        } catch (parseErr) {
          if (parseErr.message !== 'Unexpected token') throw parseErr;
        }
      }
    }

    if (finalContent) {
      document.getElementById('detail-content').innerHTML = marked.parse(stripFrontmatter(finalContent));
    }
    document.getElementById('upgrade-panel').classList.remove('open');
    resetUpgradePanel();
    btn.textContent = 'Regenerate';
    await loadDocs();

  } catch (e) {
    stream.textContent += `\n\n❌ Error: ${e.message}`;
    btn.disabled = false;
    btn.textContent = 'Regenerate';
  }
}
