// ── Refine node interactions: context menus, create, split, move ─
import {
  escHtml,
  showJiraToast,
  TYPE_LABEL,
  postJSON,
  fetchJSON,
  deleteJSON,
  getErrorMessage,
} from './state.js';
import { loadDocs } from './list.js';
import { upsertDoc, removeDoc } from './store.js';
import {
  openRefinePanel,
  openManualRefine,
  closeRefinePanel,
  renderFeatureMultiPanel,
} from './refine.js';
import { buildCanvasGraph, renderCanvas, saveCanvasLayout } from './refine-canvas.js';
import { _closeLinkPopup } from './refine-edges.js';

// ── Local shape of canvas layout position entries ───────────────
// _activePanelState.layout / _panelStates' PanelState.layout are typed as
// Record<string, unknown> in state.ts; canvas code (refine-canvas.js)
// stores { col, row } objects under each filename key.
interface CanvasPosition {
  col: number;
  row: number;
}

export async function _fpCreateChild(
  type: string,
  epicFilename: string,
  featureFilename: string
): Promise<void> {
  const title = prompt(`Title for new ${type}:`);
  if (!title) return;
  try {
    const data = (await postJSON('/api/generate', {
      idea: title,
      type,
      parentEpic: epicFilename,
    })) as { filename?: string };
    if (data.filename) {
      await postJSON('/api/link', {
        sourceType: type,
        sourceFilename: data.filename,
        targetType: 'epic',
        targetFilename: epicFilename,
      });
      showJiraToast('ok', `Created ${data.filename}`);
      await renderFeatureMultiPanel(featureFilename);
    }
  } catch (e) {
    showJiraToast('error', `Failed: ${getErrorMessage(e)}`);
  }
}

// ── Card context menu (right-click → move to edge / split) ──
export function _showCardContextMenu(
  x: number,
  y: number,
  filename: string,
  epicFilename: string,
  docType: string
): void {
  _closeLinkPopup();
  const popup = document.createElement('div');
  popup.className = 'canvas-link-popup';
  popup.style.left = `${x}px`;
  popup.style.top = `${y}px`;
  popup.innerHTML = `
    <div class="canvas-link-popup-title">Move card</div>
    <button id="_ctx-left">← Move to Left</button>
    <button id="_ctx-right">Move to Right →</button>
    <button id="_ctx-top">↑ Move to Top</button>
    <button id="_ctx-bottom">Move to Bottom ↓</button>
    <hr style="border:none;border-top:1px solid var(--border);margin:4px 0">
    <button id="_ctx-split">✂ Split Issue</button>`;
  document.body.appendChild(popup);

  popup
    .querySelector('#_ctx-left')
    ?.addEventListener('click', () => _moveCardToEdge(filename, 'left', epicFilename, docType));
  popup
    .querySelector('#_ctx-right')
    ?.addEventListener('click', () => _moveCardToEdge(filename, 'right', epicFilename, docType));
  popup
    .querySelector('#_ctx-top')
    ?.addEventListener('click', () => _moveCardToEdge(filename, 'top', epicFilename, docType));
  popup
    .querySelector('#_ctx-bottom')
    ?.addEventListener('click', () => _moveCardToEdge(filename, 'bottom', epicFilename, docType));
  popup.querySelector('#_ctx-split')?.addEventListener('click', () => {
    _closeLinkPopup();
    _openCanvasSplit(filename, docType, epicFilename, _canvasDocType ?? '');
  });

  setTimeout(() => document.addEventListener('click', _closeLinkPopup, { once: true }), 0);
}

// ── Feature multi-panel card context menu ─────────────────────
export function _showFpCardContextMenu(
  x: number,
  y: number,
  filename: string,
  docType: string,
  currentEpicFilename: string,
  featureFilename: string
): void {
  _closeLinkPopup();
  const popup = document.createElement('div');
  popup.className = 'canvas-link-popup';
  popup.style.left = `${x}px`;
  popup.style.top = `${y}px`;

  // Build "Move to Epic" submenu items from _panelStates
  const epicItems = [..._panelStates.keys()]
    .map((ef) => {
      const isCurrent = ef === currentEpicFilename;
      const epicDoc = allDocs.find((d) => d.filename === ef && d.docType === 'epic');
      const label = epicDoc?.title || ef;
      return `<button class="fp-ctx-epic-btn${isCurrent ? ' fp-ctx-epic-current' : ''}"
      ${isCurrent ? 'disabled' : ''}
      data-epic="${escHtml(ef)}">
      ${escHtml(label)}${isCurrent ? ' (current)' : ''}
    </button>`;
    })
    .join('');

  popup.innerHTML = `
    <div class="canvas-link-popup-title">Move to Epic</div>
    ${epicItems || '<div style="font-size:0.75rem;color:var(--muted);padding:4px 8px">No other epics</div>'}
    <hr style="border:none;border-top:1px solid var(--border);margin:4px 0">
    <button id="_fp-ctx-open">↗ Open in panel</button>
    <button id="_fp-ctx-split">✂ Split Issue</button>`;
  document.body.appendChild(popup);

  popup.querySelectorAll<HTMLButtonElement>('.fp-ctx-epic-btn:not([disabled])').forEach((btn) => {
    btn.addEventListener('click', async () => {
      _closeLinkPopup();
      await _fpMoveToEpic(
        filename,
        docType,
        currentEpicFilename,
        btn.dataset.epic ?? '',
        featureFilename
      );
    });
  });
  popup.querySelector('#_fp-ctx-open')?.addEventListener('click', () => {
    _closeLinkPopup();
    openRefinePanel(filename, docType);
  });
  popup.querySelector('#_fp-ctx-split')?.addEventListener('click', () => {
    _closeLinkPopup();
    _openCanvasSplit(filename, docType, currentEpicFilename, 'epic');
  });

  setTimeout(() => document.addEventListener('click', _closeLinkPopup, { once: true }), 0);
}

export async function _fpMoveToEpic(
  filename: string,
  docType: string,
  fromEpic: string,
  toEpic: string,
  featureFilename: string
): Promise<void> {
  try {
    await postJSON('/api/link', {
      sourceType: docType,
      sourceFilename: filename,
      targetType: 'epic',
      targetFilename: toEpic,
    });
    // The link move only changes this doc's parent — apply it directly instead
    // of refetching the whole doc list.
    const doc = allDocs.find((d) => d.filename === filename && d.docType === docType);
    if (doc) upsertDoc({ ...doc, parentFilename: toEpic });
    showJiraToast('ok', `Moved to ${allDocs.find((d) => d.filename === toEpic)?.title || toEpic}`);
    await renderFeatureMultiPanel(featureFilename);
  } catch (e) {
    showJiraToast('error', getErrorMessage(e));
  }
}

// ── Epic context menu (right-click on epic header) ──────────
export function _showEpicContextMenu(
  x: number,
  y: number,
  epicFilename: string,
  featureFilename: string | null
): void {
  _closeLinkPopup();
  const epicDoc = allDocs.find((d) => d.filename === epicFilename && d.docType === 'epic');
  const popup = document.createElement('div');
  popup.className = 'canvas-link-popup';
  popup.style.left = `${x}px`;
  popup.style.top = `${y}px`;
  popup.innerHTML = `
    <div class="canvas-link-popup-title">${escHtml(epicDoc?.title || epicFilename)}</div>
    <button id="_epic-ctx-split">✂ Split Epic</button>
    <button id="_epic-ctx-open">↗ Open in panel</button>`;
  document.body.appendChild(popup);

  popup.querySelector('#_epic-ctx-split')?.addEventListener('click', () => {
    _closeLinkPopup();
    _openCanvasSplit(
      epicFilename,
      'epic',
      featureFilename || epicFilename,
      featureFilename ? 'feature' : 'epic'
    );
  });
  popup.querySelector('#_epic-ctx-open')?.addEventListener('click', () => {
    _closeLinkPopup();
    openRefinePanel(epicFilename, 'epic');
  });

  setTimeout(() => document.addEventListener('click', _closeLinkPopup, { once: true }), 0);
}

// ── Empty cell context menu (create new story/spike/bug) ─────
export function _showEmptyCellMenu(
  x: number,
  y: number,
  col: number,
  row: number,
  epicFilename: string,
  epicDocType: string
): void {
  _closeLinkPopup();
  const popup = document.createElement('div');
  popup.className = 'canvas-link-popup';
  popup.style.left = `${x}px`;
  popup.style.top = `${y}px`;
  popup.innerHTML = `
    <div class="canvas-link-popup-title">Create new</div>
    <button id="_cell-story" class="green">＋ Story</button>
    <button id="_cell-spike">＋ Spike</button>
    <button id="_cell-bug" style="color:var(--danger,#ef4444)">＋ Bug</button>`;
  document.body.appendChild(popup);

  const handleCreate = (type: string): void => {
    _closeLinkPopup();
    _openCellCreateForm(type, col, row, epicFilename, epicDocType);
  };
  popup.querySelector('#_cell-story')?.addEventListener('click', () => handleCreate('story'));
  popup.querySelector('#_cell-spike')?.addEventListener('click', () => handleCreate('spike'));
  popup.querySelector('#_cell-bug')?.addEventListener('click', () => handleCreate('bug'));

  setTimeout(() => document.addEventListener('click', _closeLinkPopup, { once: true }), 0);
}

export function _openCellCreateForm(
  type: string,
  col: number,
  row: number,
  epicFilename: string,
  epicDocType: string
): void {
  const typeName = TYPE_LABEL[type] || type;
  const panel = document.getElementById('refine-panel');
  if (!panel) return;
  panel.classList.add('open');
  document
    .querySelectorAll('.canvas-card.selected')
    .forEach((el) => el.classList.remove('selected'));

  panel.innerHTML = `
    <div class="rp-header">
      <div class="rp-meta">
        <span class="type-badge ${type}">${typeName}</span>
        <span class="rp-title">New ${typeName}</span>
      </div>
      <button class="rp-close" onclick="closeRefinePanel()" title="Close">✕</button>
    </div>
    <div class="rp-create-form">
      <div class="rp-field">
        <label class="rp-label">Describe the ${typeName.toLowerCase()}…</label>
        <textarea class="rp-textarea rp-textarea-tall" id="rp-cell-idea"
          placeholder="What should this ${typeName.toLowerCase()} cover?"></textarea>
      </div>
      <div class="rp-btn-row">
        <button class="btn-xs green" id="rp-cell-create-btn">Generate &amp; Link</button>
        <button class="btn-xs" onclick="closeRefinePanel()">Cancel</button>
      </div>
      <div class="rp-stream" id="rp-cell-stream" style="display:none"></div>
    </div>`;

  document
    .getElementById('rp-cell-create-btn')
    ?.addEventListener('click', () =>
      _executeEmptyCellCreate(type, col, row, epicFilename, epicDocType)
    );
  (document.getElementById('rp-cell-idea') as HTMLElement | null)?.focus();
}

interface CellCreateGenBody {
  idea: string;
  type: string;
  priority: string;
  fixVersion?: string;
  pi?: string;
  parentEpic?: string;
  parentFeature?: string;
}

export async function _executeEmptyCellCreate(
  type: string,
  col: number,
  row: number,
  epicFilename: string,
  epicDocType: string
): Promise<void> {
  const idea = (
    document.getElementById('rp-cell-idea') as HTMLTextAreaElement | null
  )?.value.trim();
  if (!idea) {
    (document.getElementById('rp-cell-idea') as HTMLElement | null)?.focus();
    return;
  }

  const btn = document.getElementById('rp-cell-create-btn') as HTMLButtonElement;
  const stream = document.getElementById('rp-cell-stream') as HTMLElement;
  btn.disabled = true;
  btn.textContent = '⏳ Generating…';
  stream.textContent = '⚙ Generating…';
  stream.style.display = 'block';

  try {
    const parentDoc = allDocs.find((d) => d.filename === epicFilename);
    const genBody: CellCreateGenBody = { idea, type, priority: 'Medium' };
    if (parentDoc?.fixVersion) genBody.fixVersion = parentDoc.fixVersion;
    if (parentDoc?.pi && parentDoc.pi !== 'TBD') genBody.pi = parentDoc.pi;
    if (epicDocType === 'epic') genBody.parentEpic = epicFilename;
    if (epicDocType === 'feature') genBody.parentFeature = epicFilename;

    const { filename: newFilename } = (await postJSON('/api/generate', genBody)) as {
      filename: string;
    };

    stream.textContent = `✓ Created ${newFilename}\n⚙ Linking…`;

    await postJSON('/api/link', {
      sourceType: type,
      sourceFilename: newFilename,
      targetType: epicDocType,
      targetFilename: epicFilename,
    });

    stream.textContent += '\n✓ Linked successfully.';
    showJiraToast('ok', `Created ${newFilename}`);

    await loadDocs();

    // Place the new card at the clicked cell position
    (_activePanelState.layout as Record<string, CanvasPosition>)[newFilename] = { col, row };
    await saveCanvasLayout(_activePanelState, epicFilename);
    await buildCanvasGraph(epicFilename, epicDocType);

    setTimeout(() => {
      const card = document.querySelector(
        `.canvas-card[data-filename="${CSS.escape(newFilename)}"]`
      );
      if (card) {
        card.classList.add('selected');
        openRefinePanel(newFilename, type);
      }
    }, 100);
  } catch (e) {
    stream.textContent += `\n\n❌ ${e instanceof Error ? e.message : String(e)}`;
    btn.disabled = false;
    btn.textContent = 'Generate & Link';
  }
}

// ── Multi-card context menu (batch operations) ───────────────
export function _showMultiCardContextMenu(
  x: number,
  y: number,
  epicFilename: string,
  docType: string
): void {
  _closeLinkPopup();
  const count = _canvasSelectedCards.size;
  const popup = document.createElement('div');
  popup.className = 'canvas-link-popup';
  popup.style.left = `${x}px`;
  popup.style.top = `${y}px`;
  popup.innerHTML = `
    <div class="canvas-link-popup-title">${count} cards selected</div>
    <button id="_ctx-m-left">← Move all Left</button>
    <button id="_ctx-m-right">Move all Right →</button>
    <button id="_ctx-m-top">↑ Move all Top</button>
    <button id="_ctx-m-bottom">Move all Bottom ↓</button>
    <hr style="border:none;border-top:1px solid var(--border);margin:4px 0">
    <button id="_ctx-m-delete" style="color:var(--danger,#ef4444)">🗑 Delete ${count} cards</button>`;
  document.body.appendChild(popup);

  popup
    .querySelector('#_ctx-m-left')
    ?.addEventListener('click', () =>
      _moveCardsToEdge([..._canvasSelectedCards], 'left', epicFilename, docType)
    );
  popup
    .querySelector('#_ctx-m-right')
    ?.addEventListener('click', () =>
      _moveCardsToEdge([..._canvasSelectedCards], 'right', epicFilename, docType)
    );
  popup
    .querySelector('#_ctx-m-top')
    ?.addEventListener('click', () =>
      _moveCardsToEdge([..._canvasSelectedCards], 'top', epicFilename, docType)
    );
  popup
    .querySelector('#_ctx-m-bottom')
    ?.addEventListener('click', () =>
      _moveCardsToEdge([..._canvasSelectedCards], 'bottom', epicFilename, docType)
    );
  popup.querySelector('#_ctx-m-delete')?.addEventListener('click', async () => {
    _closeLinkPopup();
    if (!confirm(`Delete ${count} selected items? This cannot be undone.`)) return;
    for (const fn of _canvasSelectedCards) {
      const doc = allDocs.find((d) => d.filename === fn);
      if (!doc) continue;
      await deleteJSON(`/api/doc/${doc.docType}/${encodeURIComponent(fn)}`);
      // We already know exactly which doc was deleted — remove it from the
      // store directly instead of refetching the whole doc list.
      removeDoc(fn);
    }
    _canvasSelectedCards.clear();
    await buildCanvasGraph(epicFilename, docType);
  });

  setTimeout(() => document.addEventListener('click', _closeLinkPopup, { once: true }), 0);
}

export async function _moveCardsToEdge(
  filenames: string[],
  direction: string,
  epicFilename: string,
  docType: string
): Promise<void> {
  _closeLinkPopup();
  const layout = _activePanelState.layout as Record<string, CanvasPosition>;
  const positions = Object.values(layout);
  for (const fn of filenames) {
    const cur = layout[fn];
    if (!cur) continue;
    let newCol = cur.col;
    let newRow = cur.row;
    switch (direction) {
      case 'left':
        newCol = 0;
        break;
      case 'right':
        newCol = Math.max(...positions.map((p) => p.col)) + 1;
        break;
      case 'top':
        newRow = 0;
        break;
      case 'bottom':
        newRow = Math.max(...positions.map((p) => p.row)) + 1;
        break;
    }
    layout[fn] = { col: newCol, row: newRow };
  }
  _canvasSelectedCards.clear();
  await saveCanvasLayout(_activePanelState, epicFilename);
  renderCanvas(epicFilename, docType);
}

export function _openCanvasSplit(
  filename: string,
  childDocType: string,
  epicFilename: string,
  epicDocType: string
): void {
  const doc = allDocs.find((d) => d.filename === filename);
  const typeName = TYPE_LABEL[childDocType] || childDocType;
  const panel = document.getElementById('refine-panel');
  if (!panel) return;
  panel.classList.add('open');
  document
    .querySelectorAll('.canvas-card.selected')
    .forEach((el) => el.classList.remove('selected'));

  panel.innerHTML = `
    <div class="rp-header">
      <div class="rp-meta">
        <span class="type-badge ${childDocType}">${typeName}</span>
        <span class="rp-title">Split: ${escHtml(doc?.title || filename)}</span>
      </div>
      <button class="rp-close" onclick="closeRefinePanel()" title="Close">✕</button>
    </div>
    <div class="rp-create-form">
      <div class="rp-field">
        <label class="rp-label">Describe what to extract into the new ${typeName}…</label>
        <textarea class="rp-textarea rp-textarea-tall" id="rp-split-idea"
          placeholder="What should the new ${typeName.toLowerCase()} cover?"></textarea>
      </div>
      <div class="rp-btn-row">
        <button class="btn-xs green" id="rp-split-btn"
          onclick="_executeCanvasSplit('${escHtml(filename)}','${escHtml(childDocType)}','${escHtml(epicFilename)}','${escHtml(epicDocType)}')">Generate &amp; Link</button>
        <button class="btn-xs" onclick="closeRefinePanel()">Cancel</button>
      </div>
      <div class="rp-stream" id="rp-split-stream" style="display:none"></div>
    </div>`;

  (document.getElementById('rp-split-idea') as HTMLElement | null)?.focus();
}

interface SplitGenBody {
  idea: string;
  type: string;
  priority: string;
  fixVersion?: string;
  pi?: string;
  parentEpic?: string;
  parentFeature?: string;
}

export async function _executeCanvasSplit(
  originalFilename: string,
  childDocType: string,
  epicFilename: string,
  epicDocType: string
): Promise<void> {
  const idea = (
    document.getElementById('rp-split-idea') as HTMLTextAreaElement | null
  )?.value.trim();
  if (!idea) {
    (document.getElementById('rp-split-idea') as HTMLElement | null)?.focus();
    return;
  }

  const btn = document.getElementById('rp-split-btn') as HTMLButtonElement;
  const stream = document.getElementById('rp-split-stream') as HTMLElement;
  btn.disabled = true;
  btn.textContent = '⏳ Generating…';
  stream.textContent = '⚙ Generating…';
  stream.style.display = 'block';

  try {
    // Epic splitting uses the composite /api/split-epic endpoint
    if (childDocType === 'epic') {
      stream.textContent = '⚙ Splitting epic…';
      const result = (await postJSON('/api/split-epic', {
        epicFilename: originalFilename,
        description: idea,
      })) as {
        newEpicFilename: string;
        featureCreated?: boolean;
        featureTitle?: string;
        featureFilename: string;
      };

      stream.textContent = `✓ Created ${result.newEpicFilename}`;
      if (result.featureCreated) {
        stream.textContent += `\n✓ Auto-created feature: ${result.featureTitle}`;
        showJiraToast('ok', `Created feature "${result.featureTitle}" and new epic`);
      } else {
        showJiraToast('ok', `Created ${result.newEpicFilename}`);
      }

      await loadDocs();
      // Always switch to feature multi-panel so both epics are visible
      // side by side and stories can be moved between them
      closeRefinePanel();
      await openManualRefine(result.featureFilename, 'feature');
      return;
    }

    // Non-epic splitting: existing generate + link flow
    const { content: origContent } = (await fetchJSON(
      `/api/doc/${childDocType}/${encodeURIComponent(originalFilename)}`
    )) as { content: string };
    const origDoc = allDocs.find((d) => d.filename === originalFilename);

    stream.textContent = '⚙ Generating new issue…';

    const genBody: SplitGenBody = {
      idea: `${idea}\n\n---\nContext from original issue:\n${origContent}`,
      type: childDocType,
      priority: origDoc?.priority || 'Medium',
    };
    if (origDoc?.fixVersion) genBody.fixVersion = origDoc.fixVersion;
    if (origDoc?.pi && origDoc.pi !== 'TBD') genBody.pi = origDoc.pi;
    if (epicDocType === 'epic') genBody.parentEpic = epicFilename;
    if (epicDocType === 'feature') genBody.parentFeature = epicFilename;

    const { filename: newFilename } = (await postJSON('/api/generate', genBody)) as {
      filename: string;
    };

    stream.textContent = `✓ Created ${newFilename}\n⚙ Linking…`;

    await postJSON('/api/link', {
      sourceType: childDocType,
      sourceFilename: newFilename,
      targetType: epicDocType,
      targetFilename: epicFilename,
    });

    stream.textContent += '\n✓ Linked successfully.';
    showJiraToast('ok', `Created ${newFilename}`);

    await loadDocs();
    await buildCanvasGraph(epicFilename, epicDocType);

    setTimeout(() => {
      const card = document.querySelector(
        `.canvas-card[data-filename="${CSS.escape(newFilename)}"]`
      );
      if (card) {
        card.classList.add('selected');
        openRefinePanel(newFilename, childDocType);
      }
    }, 100);
  } catch (e) {
    stream.textContent += `\n\n❌ ${e instanceof Error ? e.message : String(e)}`;
    btn.disabled = false;
    btn.textContent = 'Generate & Link';
  }
}

export async function _moveCardToEdge(
  filename: string,
  direction: string,
  epicFilename: string,
  docType: string
): Promise<void> {
  _closeLinkPopup();
  const layout = _activePanelState.layout as Record<string, CanvasPosition>;
  const cur = layout[filename];
  if (!cur) return;

  const positions = Object.values(layout);
  let newCol = cur.col;
  let newRow = cur.row;

  switch (direction) {
    case 'left':
      newCol = 0;
      break;
    case 'right':
      newCol = Math.max(...positions.map((p) => p.col)) + 1;
      break;
    case 'top':
      newRow = 0;
      break;
    case 'bottom':
      newRow = Math.max(...positions.map((p) => p.row)) + 1;
      break;
  }

  if (newCol === cur.col && newRow === cur.row) return;

  layout[filename] = { col: newCol, row: newRow };
  await saveCanvasLayout(_activePanelState, epicFilename);
  renderCanvas(epicFilename, docType);
}
