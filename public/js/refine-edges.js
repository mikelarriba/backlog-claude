// ── Refine edge/link popups and manage-links mode ─────────────
import { showJiraToast, escHtml, getErrorMessage, postJSON, fetchJSON } from './state.js';
import { loadDocs } from './list.js';
import { rebuildCanvasEdges, renderCanvas } from './refine-canvas.js';
import { registerActions } from './actions.js';
// Typed data-action names for _showLinkPopup's buttons (issue #461 migration —
// see actions.ts and CTX_ACTIONS in list-filters.ts for the established pattern).
// Replaces the onclick="_createCanvasLink(...)" / onclick="_closeLinkPopup()"
// strings previously built by hand-interpolating escHtml() args into the
// template, which reached these handlers through main.ts's untyped window
// bridge instead of a direct, typed call.
export const EDGE_ACTIONS = {
  createLink: 'edgeCreateLink',
  closePopup: 'edgeClosePopup',
};
registerActions({
  [EDGE_ACTIONS.createLink]: (el) => {
    const { linkType, srcFilename, srcDocType, tgtFilename, tgtDocType } = el.dataset;
    _createCanvasLink(
      linkType ?? '',
      srcFilename ?? '',
      srcDocType ?? '',
      tgtFilename ?? '',
      tgtDocType ?? ''
    );
  },
  [EDGE_ACTIONS.closePopup]: () => {
    _closeLinkPopup();
  },
});
// ── Edge click popup ───────────────────────────────────────────
export function _showEdgePopup(x, y, linkType, srcFn, srcDt, tgtFn, tgtDt) {
  _closeLinkPopup();
  const popup = document.createElement('div');
  popup.className = 'canvas-link-popup';
  popup.style.left = `${x}px`;
  popup.style.top = `${y}px`;
  const altType = linkType === 'blocks' ? 'parallel' : 'blocks';
  const altLabel = linkType === 'blocks' ? 'Change to PARALLEL' : 'Change to BLOCKS';
  popup.innerHTML = `
    <div class="canvas-link-popup-title">${linkType.toUpperCase()} dependency</div>
    <button class="canvas-link-popup-danger" id="_edge-delete-btn">Delete dependency</button>
    <button id="_edge-change-btn">${altLabel}</button>
    <button id="_edge-cancel-btn">Cancel</button>`;
  document.body.appendChild(popup);
  popup
    .querySelector('#_edge-delete-btn')
    ?.addEventListener('click', () => _deleteCanvasLink(linkType, srcFn, srcDt, tgtFn, tgtDt));
  popup
    .querySelector('#_edge-change-btn')
    ?.addEventListener('click', () =>
      _changeCanvasLinkType(linkType, altType, srcFn, srcDt, tgtFn, tgtDt)
    );
  popup.querySelector('#_edge-cancel-btn')?.addEventListener('click', _closeLinkPopup);
  setTimeout(() => document.addEventListener('click', _closeLinkPopup, { once: true }), 0);
}
export async function _deleteCanvasLink(linkType, srcFn, srcDt, tgtFn, tgtDt) {
  _closeLinkPopup();
  try {
    // fetchJSON is used directly (rather than deleteJSON) because this DELETE
    // needs a JSON request body, which deleteJSON's signature doesn't support.
    await fetchJSON('/api/link', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        linkType,
        sourceType: srcDt,
        sourceFilename: srcFn,
        targetType: tgtDt,
        targetFilename: tgtFn,
      }),
    });
    await loadDocs();
    rebuildCanvasEdges();
    renderCanvas(_canvasEpicFilename || '', _canvasDocType || '');
    _restoreManageLinksState();
  } catch (e) {
    showJiraToast('error', getErrorMessage(e));
  }
}
export async function _changeCanvasLinkType(oldType, newType, srcFn, srcDt, tgtFn, tgtDt) {
  _closeLinkPopup();
  try {
    // fetchJSON is used directly (rather than deleteJSON) because this DELETE
    // needs a JSON request body, which deleteJSON's signature doesn't support.
    await fetchJSON('/api/link', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        linkType: oldType,
        sourceType: srcDt,
        sourceFilename: srcFn,
        targetType: tgtDt,
        targetFilename: tgtFn,
      }),
    });
    await postJSON('/api/link', {
      linkType: newType,
      sourceType: srcDt,
      sourceFilename: srcFn,
      targetType: tgtDt,
      targetFilename: tgtFn,
    });
    await loadDocs();
    rebuildCanvasEdges();
    renderCanvas(_canvasEpicFilename || '', _canvasDocType || '');
    _restoreManageLinksState();
  } catch (e) {
    showJiraToast('error', getErrorMessage(e));
  }
}
export function _restoreManageLinksState() {
  if (!_canvasManageLinks) return;
  const btn = document.getElementById('manage-links-btn');
  if (btn) btn.classList.add('active');
  const canvas = document.getElementById('refine-canvas');
  if (canvas) canvas.classList.add('manage-links-active');
  document.querySelectorAll('.canvas-card').forEach((c) => c.setAttribute('draggable', 'false'));
}
// ── Manage Links mode ──────────────────────────────────────────
export function toggleManageLinks() {
  _canvasManageLinks = !_canvasManageLinks;
  const btn = document.getElementById('manage-links-btn');
  if (btn) btn.classList.toggle('active', _canvasManageLinks);
  // CSS controls handle visibility via this class
  const canvas = document.getElementById('refine-canvas');
  if (canvas) canvas.classList.toggle('manage-links-active', _canvasManageLinks);
  // Disable card drag while in manage-links mode so handles don't compete with HTML5 drag
  document.querySelectorAll('.canvas-card').forEach((c) => {
    c.setAttribute('draggable', _canvasManageLinks ? 'false' : 'true');
  });
}
export function _closeLinkPopup() {
  document.querySelectorAll('.canvas-link-popup').forEach((el) => el.remove());
}
export function _showLinkPopup(x, y, srcFilename, srcDocType, tgtFilename, tgtDocType) {
  _closeLinkPopup();
  const popup = document.createElement('div');
  popup.className = 'canvas-link-popup';
  popup.style.left = `${x}px`;
  popup.style.top = `${y}px`;
  const linkDataAttrs = `data-src-filename="${escHtml(srcFilename)}" data-src-doc-type="${escHtml(srcDocType)}" data-tgt-filename="${escHtml(tgtFilename)}" data-tgt-doc-type="${escHtml(tgtDocType)}"`;
  popup.innerHTML = `
    <button data-action="${EDGE_ACTIONS.createLink}" data-link-type="blocks" ${linkDataAttrs}>Add BLOCKS link</button>
    <button data-action="${EDGE_ACTIONS.createLink}" data-link-type="parallel" ${linkDataAttrs}>Add PARALLEL link</button>
    <button data-action="${EDGE_ACTIONS.closePopup}">Cancel</button>`;
  document.body.appendChild(popup);
  // Close on outside click
  setTimeout(() => document.addEventListener('click', _closeLinkPopup, { once: true }), 0);
}
export async function _createCanvasLink(
  linkType,
  srcFilename,
  srcDocType,
  tgtFilename,
  tgtDocType
) {
  _closeLinkPopup();
  // Reject epic node links
  if (!['story', 'spike', 'bug'].includes(tgtDocType)) {
    showJiraToast('error', 'Only leaf stories can be linked');
    return;
  }
  try {
    await postJSON('/api/link', {
      linkType,
      sourceType: srcDocType,
      sourceFilename: srcFilename,
      targetType: tgtDocType,
      targetFilename: tgtFilename,
    });
    await loadDocs();
    rebuildCanvasEdges();
    renderCanvas(_canvasEpicFilename || '', _canvasDocType || '');
    _restoreManageLinksState();
  } catch (e) {
    showJiraToast('error', getErrorMessage(e));
  }
}
//# sourceMappingURL=refine-edges.js.map
