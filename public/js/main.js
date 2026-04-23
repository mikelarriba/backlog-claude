// ── Initialisation ─────────────────────────────────────────────
// Runs after all other scripts have loaded.

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ── Split-panel mode ───────────────────────────────────────────
const SPLIT_MIN_WIDTH = 1280; // px — below this, use classic single-view nav

function isSplitMode() {
  return document.querySelector('.right').classList.contains('split-mode');
}

function updateSplitMode() {
  const wide  = window.innerWidth >= SPLIT_MIN_WIDTH;
  const right = document.querySelector('.right');
  const wasOn = right.classList.contains('split-mode');

  if (wide === wasOn) return; // no change

  right.classList.toggle('split-mode', wide);

  if (!wide && currentFilename) {
    // Switching to narrow with a doc open — hide the list so detail view
    // keeps behaving like the classic full-screen detail.
    document.getElementById('list-view').style.display = 'none';
  } else if (wide && currentFilename) {
    // Switching to wide with a doc open — show the list alongside.
    document.getElementById('list-view').style.display = '';
    // Re-highlight the active list item.
    highlightSelectedItem(currentFilename, currentDocType);
  }
}

function highlightSelectedItem(filename, docType) {
  document.querySelectorAll('.epic-item').forEach(el => el.classList.remove('selected'));
  if (filename) {
    document.querySelector(`.epic-item[data-filename="${CSS.escape(filename)}"][data-doctype="${docType}"]`)
      ?.classList.add('selected');
  }
}

window.addEventListener('resize', updateSplitMode);

// Bootstrap
loadDocs();
initDragDrop();
updateSplitMode();

// SSE: auto-refresh on doc changes
const evtSource = new EventSource('/api/events');
evtSource.onmessage = (e) => {
  try {
    const payload = JSON.parse(e.data);
    if (['feature_created','epic_created','story_created','spike_created','bug_created','status_updated','title_updated','doc_deleted'].includes(payload.type)) {
      loadDocs();
    }
  } catch {}
};

// Close delete dialog on overlay click
document.getElementById('delete-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeDeleteDialog();
});
