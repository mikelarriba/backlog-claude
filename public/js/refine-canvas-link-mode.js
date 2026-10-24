// ── Refine canvas: keyboard link mode + aria-live announcements (#486, #699) ───
// Extracted from refine-canvas.ts; no dependency on the canvas rendering code.
// ── Keyboard-operable link creation (#486 phase 4/N) ────────────
// Mirrors the mouse rubber-band-line flow below (mousedown on a
// .canvas-handle → drag → mouseup over a target card → _showLinkPopup) with
// a "pick up source, then confirm target" keyboard alternative: Enter/Space
// on a handle starts link mode from that card, Tab moves focus to another
// card's handle, and Enter/Space there confirms it as the target and opens
// the same _showLinkPopup. Escape cancels. Purely additive — the mouse path
// is untouched.
let _canvasLinkModeSource = null;
let _canvasLinkModeEscListener = null;
// No aria-live region exists elsewhere in the app yet, so this adds one,
// visually hidden but announced to screen readers, following the same
// lazily-created/appended-to-body convention used by the mouse-flow popups
// in this file (#486 phase 4/N).
function _canvasLinkStatusRegion() {
  let el = document.getElementById('canvas-link-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'canvas-link-status';
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('role', 'status');
    el.style.cssText =
      'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';
    document.body.appendChild(el);
  }
  return el;
}
export function _announceCanvasLinkStatus(message) {
  _canvasLinkStatusRegion().textContent = message;
}
// aria-live region for the keyboard-operable node-move alternatives below
// (both the main canvas grid and the feature multi-panel mini-canvas),
// generalizing the same lazily-created/appended-to-body announcement
// pattern used for canvas link mode above (#486 phase 4/N), backlog list
// rerank (#486 phase 6/N, dragdrop.ts's _listReorderStatusRegion), and
// roadmap card move (#486 phase 7/N, roadmap-drag.ts's
// _roadmapDragStatusRegion) to the last remaining drag interaction.
function _canvasMoveStatusRegion() {
  let el = document.getElementById('canvas-move-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'canvas-move-status';
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('role', 'status');
    el.style.cssText =
      'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';
    document.body.appendChild(el);
  }
  return el;
}
export function _announceCanvasMoveStatus(message) {
  _canvasMoveStatusRegion().textContent = message;
}
export const CANVAS_MOVE_BLOCKED_EDGE = {
  up: 'top',
  down: 'bottom',
  left: 'left edge',
  right: 'right edge',
};
// Ends keyboard link mode (on confirm, cancel, or Manage Links being turned
// off) — clears the tracked source, its visual highlight, and the Escape
// listener registered by _startCanvasLinkMode.
export function getCanvasLinkModeSource() {
  return _canvasLinkModeSource;
}
export function _endCanvasLinkMode(announce) {
  _canvasLinkModeSource = null;
  document
    .querySelectorAll('.canvas-card.canvas-link-source')
    .forEach((el) => el.classList.remove('canvas-link-source'));
  if (_canvasLinkModeEscListener) {
    document.removeEventListener('keydown', _canvasLinkModeEscListener);
    _canvasLinkModeEscListener = null;
  }
  if (announce) _announceCanvasLinkStatus(announce);
}
export function _startCanvasLinkMode(card, filename, docType, title) {
  _canvasLinkModeSource = { filename, docType, title };
  card.classList.add('canvas-link-source');
  _announceCanvasLinkStatus(
    `Link mode: creating a link from ${title}. Tab to another card's link handle and press Enter or Space to confirm, or press Escape to cancel.`
  );
  _canvasLinkModeEscListener = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    _endCanvasLinkMode('Link creation cancelled.');
  };
  document.addEventListener('keydown', _canvasLinkModeEscListener);
}
//# sourceMappingURL=refine-canvas-link-mode.js.map
