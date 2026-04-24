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
    let finalContent = null;
    await streamSSE(
      `/api/doc/${currentDocType}/${encodeURIComponent(currentFilename)}/upgrade`,
      { feedback },
      {
        onText:  (text) => { stream.textContent += text; },
        onDone:  (payload) => { finalContent = payload.content; },
        onError: (e) => { throw e; },
      }
    );

    if (finalContent) {
      document.getElementById('detail-content').innerHTML = marked.parse(stripFrontmatter(finalContent));
    }
    document.getElementById('upgrade-panel').classList.remove('open');
    resetUpgradePanel();
    btn.textContent = 'Regenerate';

  } catch (e) {
    stream.textContent += `\n\n❌ Error: ${e.message}`;
    btn.disabled = false;
    btn.textContent = 'Regenerate';
  }
}
