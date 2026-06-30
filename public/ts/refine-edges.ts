// ── Refine edge/link popups and manage-links mode ─────────────
import { showJiraToast, escHtml, getErrorMessage } from './state.js';
import { loadDocs } from './list.js';
import { rebuildCanvasEdges, renderCanvas } from './refine-canvas.js';

// ── Edge click popup ───────────────────────────────────────────
export function _showEdgePopup(
  x: number,
  y: number,
  linkType: string,
  srcFn: string,
  srcDt: string,
  tgtFn: string,
  tgtDt: string
): void {
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

export async function _deleteCanvasLink(
  linkType: string,
  srcFn: string,
  srcDt: string,
  tgtFn: string,
  tgtDt: string
): Promise<void> {
  _closeLinkPopup();
  try {
    const res = await fetch('/api/link', {
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
    if (!res.ok) {
      const d = (await res.json()) as { error?: { message?: string } };
      throw new Error(d.error?.message || 'Delete failed');
    }
    await loadDocs();
    rebuildCanvasEdges();
    renderCanvas(_canvasEpicFilename || '', _canvasDocType || '');
    _restoreManageLinksState();
  } catch (e) {
    showJiraToast('error', getErrorMessage(e));
  }
}

export async function _changeCanvasLinkType(
  oldType: string,
  newType: string,
  srcFn: string,
  srcDt: string,
  tgtFn: string,
  tgtDt: string
): Promise<void> {
  _closeLinkPopup();
  try {
    const delRes = await fetch('/api/link', {
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
    if (!delRes.ok) throw new Error('Delete failed');

    const addRes = await fetch('/api/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        linkType: newType,
        sourceType: srcDt,
        sourceFilename: srcFn,
        targetType: tgtDt,
        targetFilename: tgtFn,
      }),
    });
    if (!addRes.ok) {
      const d = (await addRes.json()) as { error?: { message?: string } };
      throw new Error(d.error?.message || 'Create failed');
    }
    await loadDocs();
    rebuildCanvasEdges();
    renderCanvas(_canvasEpicFilename || '', _canvasDocType || '');
    _restoreManageLinksState();
  } catch (e) {
    showJiraToast('error', getErrorMessage(e));
  }
}

export function _restoreManageLinksState(): void {
  if (!_canvasManageLinks) return;
  const btn = document.getElementById('manage-links-btn');
  if (btn) btn.classList.add('active');
  const canvas = document.getElementById('refine-canvas');
  if (canvas) canvas.classList.add('manage-links-active');
  document.querySelectorAll('.canvas-card').forEach((c) => c.setAttribute('draggable', 'false'));
}

// ── Manage Links mode ──────────────────────────────────────────
export function toggleManageLinks(): void {
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

export function _closeLinkPopup(): void {
  document.querySelectorAll('.canvas-link-popup').forEach((el) => el.remove());
}

export function _showLinkPopup(
  x: number,
  y: number,
  srcFilename: string,
  srcDocType: string,
  tgtFilename: string,
  tgtDocType: string
): void {
  _closeLinkPopup();
  const popup = document.createElement('div');
  popup.className = 'canvas-link-popup';
  popup.style.left = `${x}px`;
  popup.style.top = `${y}px`;
  popup.innerHTML = `
    <button onclick="_createCanvasLink('blocks','${escHtml(srcFilename)}','${escHtml(srcDocType)}','${escHtml(tgtFilename)}','${escHtml(tgtDocType)}')">Add BLOCKS link</button>
    <button onclick="_createCanvasLink('parallel','${escHtml(srcFilename)}','${escHtml(srcDocType)}','${escHtml(tgtFilename)}','${escHtml(tgtDocType)}')">Add PARALLEL link</button>
    <button onclick="_closeLinkPopup()">Cancel</button>`;
  document.body.appendChild(popup);
  // Close on outside click
  setTimeout(() => document.addEventListener('click', _closeLinkPopup, { once: true }), 0);
}

export async function _createCanvasLink(
  linkType: string,
  srcFilename: string,
  srcDocType: string,
  tgtFilename: string,
  tgtDocType: string
): Promise<void> {
  _closeLinkPopup();
  // Reject epic node links
  if (!['story', 'spike', 'bug'].includes(tgtDocType)) {
    showJiraToast('error', 'Only leaf stories can be linked');
    return;
  }
  try {
    const res = await fetch('/api/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        linkType,
        sourceType: srcDocType,
        sourceFilename: srcFilename,
        targetType: tgtDocType,
        targetFilename: tgtFilename,
      }),
    });
    const data = (await res.json()) as { error?: { message?: string } };
    if (!res.ok) throw new Error(data.error?.message || 'Link failed');

    await loadDocs();
    rebuildCanvasEdges();
    renderCanvas(_canvasEpicFilename || '', _canvasDocType || '');
    _restoreManageLinksState();
  } catch (e) {
    showJiraToast('error', getErrorMessage(e));
  }
}
