// ── Initialisation ─────────────────────────────────────────────
// Runs after all other scripts have loaded.

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// Bootstrap
loadDocs();
initDragDrop();

// SSE: auto-refresh on doc changes
const evtSource = new EventSource('/api/events');
evtSource.onmessage = (e) => {
  try {
    const payload = JSON.parse(e.data);
    if (['feature_created','epic_created','story_created','spike_created','status_updated','doc_deleted'].includes(payload.type)) {
      loadDocs();
    }
  } catch {}
};

// Close delete dialog on overlay click
document.getElementById('delete-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeDeleteDialog();
});
