// ── Documentation undo: 60-second revert window after Modify Documentation (#374/#375) ──
import { postJSON, showJiraToast } from './state.js';
const UNDO_WINDOW_SECONDS = 60;
let _undoSnapshotId = null;
let _undoCountdownInterval;
let _undoRemainingSeconds = 0;
export function hasUndoSnapshot() {
  return _undoSnapshotId !== null;
}
export async function undoChanges(onReverted) {
  if (!_undoSnapshotId) return;
  const snapshotId = _undoSnapshotId;
  const btn = document.getElementById('doc-undo-btn');
  if (_undoCountdownInterval) {
    clearInterval(_undoCountdownInterval);
    _undoCountdownInterval = undefined;
  }
  if (btn) {
    btn.disabled = true;
    btn.classList.add('doc-undo-btn-loading');
    btn.textContent = 'Undoing\u2026';
  }
  try {
    await postJSON(`/api/confluence/undo/${encodeURIComponent(snapshotId)}`, {});
    showJiraToast('success', 'Changes reverted');
    hideUndoButton();
    onReverted();
  } catch (err) {
    const message = err?.message || String(err);
    if (message.toLowerCase().includes('expired') || message.toLowerCase().includes('not found')) {
      showJiraToast('error', 'Undo window expired');
      hideUndoButton();
    } else {
      showJiraToast('error', `Undo failed: ${message}`);
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('doc-undo-btn-loading');
      }
      if (_undoSnapshotId) {
        _updateUndoButtonLabel();
        _startUndoCountdownTimer();
      }
    }
  }
}
export function showUndoButton(snapshotId) {
  _undoSnapshotId = snapshotId;
  _undoRemainingSeconds = UNDO_WINDOW_SECONDS;
  const btn = document.getElementById('doc-undo-btn');
  if (!btn) return;
  btn.style.display = '';
  btn.disabled = false;
  btn.classList.remove('doc-undo-btn-loading');
  _updateUndoButtonLabel();
  _startUndoCountdownTimer();
}
export function hideUndoButton() {
  if (_undoCountdownInterval) {
    clearInterval(_undoCountdownInterval);
    _undoCountdownInterval = undefined;
  }
  _undoSnapshotId = null;
  const btn = document.getElementById('doc-undo-btn');
  if (btn) {
    btn.style.display = 'none';
    btn.disabled = false;
    btn.classList.remove('doc-undo-btn-loading');
    btn.textContent = '\u21a9 Undo all changes';
  }
}
function _startUndoCountdownTimer() {
  if (_undoCountdownInterval) clearInterval(_undoCountdownInterval);
  _undoCountdownInterval = setInterval(() => {
    _undoRemainingSeconds -= 1;
    if (_undoRemainingSeconds <= 0) {
      hideUndoButton();
      return;
    }
    _updateUndoButtonLabel();
  }, 1000);
}
function _updateUndoButtonLabel() {
  const btn = document.getElementById('doc-undo-btn');
  if (!btn) return;
  btn.textContent = `\u21a9 Undo all changes (${_undoRemainingSeconds}s)`;
}
//# sourceMappingURL=documentation-undo.js.map
