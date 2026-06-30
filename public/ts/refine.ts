// ── Manual Refinement View coordinator ────────────────────────
// Visual hierarchy editor for Epics. Uses a custom vanilla JS + SVG
// grid canvas for automatic top-down node placement with swim-lane columns.
//
// Scope: Feature → Epic → [Stories, Spikes, Bugs]
// Clicking a card opens a slide-in panel with full markdown content,
// an upgrade (AI rewrite) panel, and a delete action.
// "+ Story / + Spike / + Bug" buttons in the header open a creation
// form that generates the doc and links it in one flow.
import {
  escHtml,
  showJiraToast,
  TYPE_LABEL,
  streamSSE,
  stripFrontmatter,
  patchJSON,
} from './state.js';
import type { DocEntry, PanelState } from './state.js';
import { loadDocs } from './list.js';
import {
  buildCanvasGraph,
  renderCanvas,
  rebuildCanvasEdges,
  _renderFpCanvas,
  computeAutoLayout,
} from './refine-canvas.js';
import { _closeLinkPopup } from './refine-edges.js';

// ── Local ambient declarations ─────────────────────────────────
// _renderComments / _parseComments are module-local (non-exported, never
// attached to window) functions defined in detail.js. The original
// refine.js calls them as bare globals inside openRefinePanel — this is
// pre-existing dead code (they are not reachable at runtime and the call
// would throw a ReferenceError). Preserved here exactly as-is; see the
// migration summary for details instead of adding a new ambient global.
declare const _renderComments: (
  comments: RpComment[],
  filename: string,
  docType: string,
  containerEl?: HTMLElement | null
) => void;
declare const _parseComments: (content: string) => RpComment[];

interface RpComment {
  id: string;
  text: string;
}

// ── Canvas state ─ all in state.js as _storeVar globals ──────
// _canvasEpicFilename, _canvasDocType, _canvasManageLinks,
// _canvasSelectedCards, _activePanelState, _panelStates

// ── API response shapes ───────────────────────────────────────
interface FeatureDeepEpic {
  filename: string;
  title?: string;
  children?: DocEntry[];
  blocks?: string[];
  parallel?: string[];
}

interface FeatureDeepResponse {
  epics: FeatureDeepEpic[];
}

interface LinksDeepResponseItem {
  filename: string;
  title?: string;
  docType?: string;
}

interface LinksDeepResponse {
  blocks?: LinksDeepResponseItem[];
  blockedBy?: LinksDeepResponseItem[];
  parallel?: LinksDeepResponseItem[];
}

interface ApiErrorBody {
  error?: { message?: string };
}

// ── Card search / filter ──────────────────────────────────────
export function onCanvasSearch(query: string): void {
  const cards = document.querySelectorAll<HTMLElement>('#refine-canvas .canvas-card');
  const q = (query || '').trim().toLowerCase();

  if (q.length < 3) {
    // Clear all filter classes
    cards.forEach((c) => {
      c.classList.remove('search-dimmed', 'search-match');
    });
    return;
  }

  cards.forEach((card) => {
    const title = (card.querySelector('.canvas-card-title')?.textContent || '').toLowerCase();
    if (title.includes(q)) {
      card.classList.add('search-match');
      card.classList.remove('search-dimmed');
    } else {
      card.classList.add('search-dimmed');
      card.classList.remove('search-match');
    }
  });
}

// ── Entry / Exit ───────────────────────────────────────────────
export async function openManualRefine(filename: string, docType?: string): Promise<void> {
  if (!filename) return;
  docType = docType || 'epic';
  _canvasEpicFilename = filename;
  _canvasDocType = docType;
  // Refine view needs the full right panel — suspend split mode while open
  document.querySelector('.right')?.classList.remove('split-mode');

  const doc = allDocs.find((d) => d.filename === filename && d.docType === docType);
  const titleEl = document.getElementById('refine-epic-title');
  if (titleEl) titleEl.textContent = doc?.title || filename;

  // Switch views
  const listView = document.getElementById('list-view') as HTMLElement | null;
  if (listView) listView.style.display = 'none';
  document.getElementById('detail-view')?.classList.remove('show');
  document.getElementById('refine-view')?.classList.add('show');

  // Clear search
  const searchInput = document.getElementById('refine-search') as HTMLInputElement | null;
  if (searchInput) searchInput.value = '';

  // Render the correct "+ Create" buttons for this doc type
  _canvasManageLinks = false;
  const addBtns = document.getElementById('refine-add-btns');
  if (addBtns) {
    if (docType === 'feature') {
      addBtns.innerHTML = `<button class="btn-xs" onclick="openCreatePanel('epic')">＋ Epic</button>`;
    } else {
      addBtns.innerHTML = `
      <button class="btn-xs green" onclick="openCreatePanel('story')">＋ Story</button>
      <button class="btn-xs" onclick="openCreatePanel('spike')">＋ Spike</button>
      <button class="btn-xs red" onclick="openCreatePanel('bug')">＋ Bug</button>
      <button class="btn-xs" id="manage-links-btn" onclick="toggleManageLinks()">⛓ Manage Links</button>`;
    }
  }

  closeRefinePanel();
  if (docType === 'feature') {
    await renderFeatureMultiPanel(filename);
  } else {
    await buildCanvasGraph(filename, docType);
  }
  document.addEventListener('keydown', _onCanvasKeydown);
}

function _onCanvasKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && _canvasSelectedCards.size > 0) {
    _canvasSelectedCards.clear();
    document
      .querySelectorAll('.canvas-card.canvas-multi-selected')
      .forEach((el) => el.classList.remove('canvas-multi-selected'));
  }
}

export function closeRefineView(): void {
  document.getElementById('refine-view')?.classList.remove('show');
  document.removeEventListener('keydown', _onCanvasKeydown);
  updateSplitMode();

  // Clear canvas state
  _canvasEpicFilename = null;
  _canvasDocType = null;
  _activePanelState.layout = {};
  _activePanelState.stories = [];
  _activePanelState.parallel = [];
  _activePanelState.blocks = [];
  _canvasManageLinks = false;
  _canvasSelectedCards.clear();
  const canvas = document.getElementById('refine-canvas');
  if (canvas) canvas.classList.remove('manage-links-active');

  if (currentFilename && currentDocType) {
    document.getElementById('detail-view')?.classList.add('show');
  } else {
    const listView = document.getElementById('list-view') as HTMLElement | null;
    if (listView) listView.style.display = 'flex';
  }
}

// ── Feature multi-panel view ───────────────────────────────────
const _FP_COLLAPSED_KEY = (fn: string): string => `fp:collapsed:${fn}`;

export async function renderFeatureMultiPanel(featureFilename: string): Promise<void> {
  const container = document.getElementById('refine-canvas');
  if (!container) return;
  container.innerHTML = '<div class="canvas-empty">Loading feature…</div>';
  _panelStates.clear();

  let data: FeatureDeepResponse;
  try {
    const res = await fetch(`/api/links/feature/${encodeURIComponent(featureFilename)}/deep`);
    if (!res.ok) throw new Error('Failed to load feature hierarchy');
    data = (await res.json()) as FeatureDeepResponse;
  } catch (e) {
    container.innerHTML = `<div class="canvas-empty">Error: ${escHtml(e instanceof Error ? e.message : String(e))}</div>`;
    return;
  }

  const collapsedSet = _fpLoadCollapsed(featureFilename);
  const wrapper = document.createElement('div');
  wrapper.className = 'feature-panels-container';

  for (const epic of data.epics) {
    const children = epic.children || [];
    const ps: PanelState = {
      stories: children,
      layout: {},
      blocks: (epic.blocks || []) as unknown as string[],
      parallel: (epic.parallel || []) as unknown as string[],
    };
    _panelStates.set(epic.filename, ps);

    // Load or compute layout for this epic's panel
    try {
      const lr = await fetch(`/api/canvas/layout/${encodeURIComponent(epic.filename)}`);
      if (lr.ok) {
        const saved = (await lr.json()) as Record<string, unknown>;
        if (Object.keys(saved).length) ps.layout = saved;
      }
    } catch {
      /* no-op */
    }
    if (!Object.keys(ps.layout).length && children.length) {
      ps.layout = computeAutoLayout(children, ps.blocks, ps.parallel) as Record<string, unknown>;
    }

    const isCollapsed = collapsedSet.has(epic.filename);
    wrapper.appendChild(_renderEpicPanel(epic, ps, featureFilename, isCollapsed));
  }

  if (!data.epics.length) {
    wrapper.innerHTML = '<div class="canvas-empty">No epics linked to this feature yet.</div>';
  }

  container.innerHTML = '';
  container.appendChild(wrapper);

  // Render mini-canvases now that panels are in the DOM
  for (const epic of data.epics) {
    const ps = _panelStates.get(epic.filename);
    if (ps) _renderFpCanvas(epic.filename, ps, featureFilename);
  }
}

function _fpLoadCollapsed(featureFilename: string): Set<string> {
  try {
    return new Set(
      JSON.parse(localStorage.getItem(_FP_COLLAPSED_KEY(featureFilename)) || '[]') as string[]
    );
  } catch {
    return new Set();
  }
}

function _fpSaveCollapsed(featureFilename: string): void {
  const collapsed: (string | undefined)[] = [];
  document
    .querySelectorAll<HTMLElement>('.feature-panel.fp-collapsed')
    .forEach((p) => collapsed.push(p.dataset.epicFilename));
  try {
    localStorage.setItem(_FP_COLLAPSED_KEY(featureFilename), JSON.stringify(collapsed));
  } catch {
    /* no-op */
  }
}

export function _toggleEpicPanel(epicFilename: string, featureFilename: string): void {
  const panel = document.querySelector<HTMLElement>(
    `.feature-panel[data-epic-filename="${CSS.escape(epicFilename)}"]`
  );
  if (!panel) return;
  panel.classList.toggle('fp-collapsed');
  const chevron = panel.querySelector('.fp-chevron');
  if (chevron) chevron.textContent = panel.classList.contains('fp-collapsed') ? '▶' : '▼';
  _fpSaveCollapsed(featureFilename);
}

function _renderEpicPanel(
  epic: FeatureDeepEpic,
  ps: PanelState,
  featureFilename: string,
  isCollapsed: boolean
): HTMLElement {
  const totalSP = ps.stories.reduce(
    (s, c) => s + (allDocs.find((d) => d.filename === c.filename)?.storyPoints || 0),
    0
  );
  const count = ps.stories.length;
  const ef = escHtml(epic.filename);
  const ff = escHtml(featureFilename);

  const panel = document.createElement('div');
  panel.className = 'feature-panel' + (isCollapsed ? ' fp-collapsed' : '');
  panel.dataset.epicFilename = epic.filename;

  panel.innerHTML = `
    <div class="fp-header" onclick="_toggleEpicPanel('${ef}','${ff}')">
      <span class="fp-chevron">${isCollapsed ? '▶' : '▼'}</span>
      <span class="type-badge epic">Epic</span>
      <span class="fp-title">${escHtml(epic.title || epic.filename)}</span>
      <span class="fp-meta">${count} item${count !== 1 ? 's' : ''}${totalSP ? ` · ${totalSP} SP` : ''}</span>
    </div>
    <div class="fp-body">
      <div class="fp-toolbar">
        <button class="btn-xs green" onclick="_fpCreateChild('story','${ef}','${ff}')">＋ Story</button>
        <button class="btn-xs" onclick="_fpCreateChild('spike','${ef}','${ff}')">＋ Spike</button>
        <button class="btn-xs red" onclick="_fpCreateChild('bug','${ef}','${ff}')">＋ Bug</button>
        <button class="btn-xs" onclick="openManualRefine('${ef}','epic')">↗ Open Epic</button>
      </div>
      <div class="fp-canvas" id="fp-canvas-${ef}"></div>
    </div>`;

  // Right-click on epic header → context menu with Split Epic
  const header = panel.querySelector('.fp-header');
  header?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    _showEpicContextMenu(
      (e as MouseEvent).clientX,
      (e as MouseEvent).clientY,
      epic.filename,
      featureFilename
    );
  });

  // Canvas rendering is deferred — called from renderFeatureMultiPanel
  // after the panel is actually inserted into the DOM.
  return panel;
}

// ── Refine Panel ───────────────────────────────────────────────
export function closeRefinePanel(): void {
  const panel = document.getElementById('refine-panel');
  if (!panel) return;
  panel.classList.remove('open');
  setTimeout(() => {
    if (!panel.classList.contains('open')) panel.innerHTML = '';
  }, 230);
  document
    .querySelectorAll('.canvas-card.selected')
    .forEach((el) => el.classList.remove('selected'));
}

export async function openRefinePanel(filename: string, docType: string): Promise<void> {
  const panel = document.getElementById('refine-panel');
  if (!panel) return;
  panel.innerHTML = '<div class="rp-loading">Loading…</div>';
  panel.classList.add('open');

  try {
    const res = await fetch(`/api/doc/${docType}/${encodeURIComponent(filename)}`);
    if (!res.ok) throw new Error('Not found');
    const { content } = (await res.json()) as { content: string };
    const doc = allDocs.find((d) => d.filename === filename && d.docType === docType);
    const title = doc?.title || filename;

    const ef = escHtml(filename);
    const et = escHtml(docType);

    const sp = doc?.storyPoints != null ? doc.storyPoints : '';
    const pri = doc?.priority || 'Medium';
    const isLeaf = ['story', 'spike', 'bug'].includes(docType);

    panel.innerHTML = `
      <div class="rp-header">
        <div class="rp-meta">
          <span class="type-badge ${docType}">${TYPE_LABEL[docType] || docType}</span>
          <button class="rp-close" onclick="closeRefinePanel()" title="Close">✕</button>
        </div>
        <input class="rp-title-input" id="rp-title-input" type="text"
          value="${escHtml(title)}" data-original="${escHtml(title)}"
          data-filename="${ef}" data-doctype="${et}"
          onblur="saveRpTitle()" onkeydown="if(event.key==='Enter'){this.blur()} if(event.key==='Escape'){cancelRpTitleEdit()}" />
        <div class="rp-edit-row">
          ${
            isLeaf
              ? `<div class="rp-edit-field">
            <label class="rp-edit-label">SP</label>
            <input class="rp-sp-input" id="rp-sp-input" type="number" min="0" max="999"
              value="${sp}" data-original="${sp}"
              placeholder="—"
              onblur="saveRpStoryPoints('${ef}','${et}')"
              onkeydown="if(event.key==='Enter'){this.blur()} if(event.key==='Escape'){this.blur()}" />
          </div>`
              : ''
          }
          <div class="rp-edit-field">
            <label class="rp-edit-label">Priority</label>
            <select class="rp-priority-select" id="rp-priority-select"
              onchange="saveRpPriority('${ef}','${et}')">
              <option value="Critical"${pri === 'Critical' ? ' selected' : ''}>Critical</option>
              <option value="High"${pri === 'High' ? ' selected' : ''}>High</option>
              <option value="Medium"${pri === 'Medium' ? ' selected' : ''}>Medium</option>
              <option value="Low"${pri === 'Low' ? ' selected' : ''}>Low</option>
            </select>
          </div>
        </div>
      </div>
      <div class="rp-toolbar">
        <button class="btn-xs" onclick="toggleRpUpgrade()">↑ Upgrade</button>
        <button class="btn-xs" onclick="openDoc('${ef}','${et}');closeRefineView()">↗ Open</button>
        ${docType !== 'feature' ? `<button class="btn-xs red" onclick="confirmRpDelete('${ef}','${et}')">Delete</button>` : ''}
      </div>
      <div class="rp-upgrade-wrap" id="rp-upgrade-wrap" style="display:none">
        <textarea class="rp-textarea" id="rp-upgrade-text"
          placeholder="Describe what to change or improve…"></textarea>
        <div class="rp-btn-row">
          <button class="btn-xs green" id="rp-upgrade-run"
            onclick="executeRpUpgrade('${ef}','${et}')">Regenerate</button>
          <button class="btn-xs" onclick="toggleRpUpgrade()">Cancel</button>
        </div>
        <div class="rp-stream" id="rp-upgrade-stream" style="display:none"></div>
      </div>
      <div class="rp-content markdown" id="rp-content">
        ${marked.parse(stripFrontmatter(content).replace(/\n## Comments\b[\s\S]*$/, ''))}
      </div>
      <div class="rp-deps-section" id="rp-deps-section">
        <div class="rp-loading">Loading dependencies…</div>
      </div>
      <div class="rp-comments-section comments-section hidden" id="rp-comments-section"></div>`;

    // Load and render dependency section and comments
    _loadRpDeps(filename, docType);
    _renderComments(
      _parseComments(content),
      filename,
      docType,
      document.getElementById('rp-comments-section')
    );
  } catch {
    panel.innerHTML = '<div class="rp-loading">Failed to load content.</div>';
  }
}

async function _loadRpDeps(filename: string, docType: string): Promise<void> {
  const section = document.getElementById('rp-deps-section');
  if (!section) return;
  try {
    const res = await fetch(
      `/api/links/${encodeURIComponent(docType)}/${encodeURIComponent(filename)}`
    );
    if (!res.ok) {
      section.innerHTML = '';
      return;
    }
    const data = (await res.json()) as LinksDeepResponse;

    function depRow(item: LinksDeepResponseItem, lType: string): string {
      const ef = escHtml(item.filename);
      const et = escHtml(item.docType || docType);
      return `<div class="rp-dep-row">
        <span class="rp-dep-title">${escHtml(item.title || item.filename)}</span>
        <button class="btn-ghost btn-xs dep-remove-btn"
          onclick="_removeCanvasLink('${lType}','${escHtml(filename)}','${escHtml(docType)}','${ef}','${et}')">&times;</button>
      </div>`;
    }

    const blocks = data.blocks || [];
    const blockedBy = data.blockedBy || [];
    const parallel = data.parallel || [];

    section.innerHTML = `
      <div class="rp-deps-header">Dependencies</div>
      <div class="rp-dep-group">
        <div class="rp-dep-label">Blocks</div>
        ${blocks.length ? blocks.map((i) => depRow(i, 'blocks')).join('') : '<div class="dep-empty">None</div>'}
      </div>
      <div class="rp-dep-group">
        <div class="rp-dep-label">Blocked by</div>
        ${blockedBy.length ? blockedBy.map((i) => depRow(i, 'blockedBy')).join('') : '<div class="dep-empty">None</div>'}
      </div>
      <div class="rp-dep-group">
        <div class="rp-dep-label">Parallel with</div>
        ${parallel.length ? parallel.map((i) => depRow(i, 'parallel')).join('') : '<div class="dep-empty">None</div>'}
      </div>`;
  } catch {
    section.innerHTML = '';
  }
}

export async function _removeCanvasLink(
  linkType: string,
  srcFilename: string,
  srcDocType: string,
  tgtFilename: string,
  tgtDocType: string
): Promise<void> {
  // For blockedBy direction: the blocker is tgt, the blocked is src
  let finalSrc = srcFilename,
    finalSrcType = srcDocType;
  let finalTgt = tgtFilename,
    finalTgtType = tgtDocType;
  if (linkType === 'blockedBy') {
    linkType = 'blocks';
    [finalSrc, finalSrcType, finalTgt, finalTgtType] = [
      tgtFilename,
      tgtDocType,
      srcFilename,
      srcDocType,
    ];
  }
  try {
    await fetch('/api/link', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        linkType,
        sourceType: finalSrcType,
        sourceFilename: finalSrc,
        targetType: finalTgtType,
        targetFilename: finalTgt,
      }),
    });
    await loadDocs();
    rebuildCanvasEdges();
    renderCanvas(_canvasEpicFilename ?? '', _canvasDocType ?? '');
    // Reopen panel to refresh deps
    openRefinePanel(srcFilename, srcDocType);
  } catch (e) {
    showJiraToast('error', e instanceof Error ? e.message : String(e));
  }
}

// ── Inline field editing (refine panel) ───────────────────────
export async function saveRpTitle(): Promise<void> {
  const input = document.getElementById('rp-title-input') as HTMLInputElement | null;
  if (!input) return;
  const newTitle = input.value.trim();
  const original = input.dataset.original;
  const filename = input.dataset.filename;
  const docType = input.dataset.doctype;
  if (!newTitle || newTitle === original || !filename) return;
  try {
    await patchJSON(`/api/doc/${docType}/${encodeURIComponent(filename)}`, { title: newTitle });
    input.dataset.original = newTitle;
    // Update canvas card title instantly
    const card = document.querySelector(
      `.canvas-card[data-filename="${CSS.escape(filename)}"] .canvas-card-title`
    );
    if (card) card.textContent = newTitle;
    // Update in-memory allDocs
    const doc = allDocs.find((d) => d.filename === filename && d.docType === docType);
    if (doc) doc.title = newTitle;
    // Update markdown heading in panel content
    const h2 = document.querySelector('#rp-content h2');
    if (h2) h2.textContent = newTitle;
  } catch {
    input.value = original ?? '';
  }
}

export function cancelRpTitleEdit(): void {
  const input = document.getElementById('rp-title-input') as HTMLInputElement | null;
  if (input) {
    input.value = input.dataset.original || '';
    input.blur();
  }
}

export async function saveRpStoryPoints(filename: string, docType: string): Promise<void> {
  const input = document.getElementById('rp-sp-input') as HTMLInputElement | null;
  if (!input) return;
  const newVal = input.value.trim();
  const orig = input.dataset.original || '';
  if (newVal === orig) return;
  try {
    await patchJSON(`/api/doc/${docType}/${encodeURIComponent(filename)}`, {
      storyPoints: newVal === '' ? null : Number(newVal),
    });
    input.dataset.original = newVal;
    // Update canvas card SP badge instantly
    const spEl = document.querySelector(
      `.canvas-card[data-filename="${CSS.escape(filename)}"] .canvas-card-sp`
    );
    if (spEl) spEl.textContent = newVal ? `${newVal} SP` : '';
    // Update in-memory
    const doc = allDocs.find((d) => d.filename === filename && d.docType === docType);
    if (doc) doc.storyPoints = newVal === '' ? null : Number(newVal);
  } catch {
    input.value = orig;
  }
}

export async function saveRpPriority(filename: string, docType: string): Promise<void> {
  const sel = document.getElementById('rp-priority-select') as HTMLSelectElement | null;
  if (!sel) return;
  const newPri = sel.value;
  try {
    await patchJSON(`/api/doc/${docType}/${encodeURIComponent(filename)}`, { priority: newPri });
    // Update in-memory
    const doc = allDocs.find((d) => d.filename === filename && d.docType === docType);
    if (doc) doc.priority = newPri;
  } catch (e) {
    showJiraToast(
      'error',
      `Failed to save priority: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

export function toggleRpUpgrade(): void {
  const wrap = document.getElementById('rp-upgrade-wrap') as HTMLElement | null;
  if (!wrap) return;
  const isOpen = wrap.style.display !== 'none';
  wrap.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) (document.getElementById('rp-upgrade-text') as HTMLElement | null)?.focus();
}

export async function executeRpUpgrade(filename: string, docType: string): Promise<void> {
  const feedback = (
    document.getElementById('rp-upgrade-text') as HTMLTextAreaElement | null
  )?.value.trim();
  if (!feedback) {
    (document.getElementById('rp-upgrade-text') as HTMLElement | null)?.focus();
    return;
  }

  const btn = document.getElementById('rp-upgrade-run') as HTMLButtonElement;
  const stream = document.getElementById('rp-upgrade-stream') as HTMLElement;
  btn.disabled = true;
  btn.textContent = '⏳ Regenerating…';
  stream.textContent = '';
  stream.style.display = 'block';

  try {
    let result: Record<string, unknown> | null = null;
    await streamSSE(
      `/api/doc/${docType}/${encodeURIComponent(filename)}/upgrade`,
      { feedback },
      {
        onText: (text) => {
          stream.textContent += text;
        },
        onDone: (payload) => {
          result = payload;
        },
      }
    );

    if (result) {
      const content = (result as { content: string }).content;
      const rpContent = document.getElementById('rp-content');
      if (rpContent) rpContent.innerHTML = marked.parse(stripFrontmatter(content));
      await loadDocs();
      // Update the card title in the canvas
      const updated = allDocs.find((d) => d.filename === filename && d.docType === docType);
      if (updated) {
        const card = document.querySelector(
          `.canvas-card[data-filename="${CSS.escape(filename)}"] .canvas-card-title`
        );
        if (card) card.textContent = updated.title;
      }
    }
    btn.textContent = 'Regenerate';
    btn.disabled = false;
    stream.style.display = 'none';
    const wrap = document.getElementById('rp-upgrade-wrap') as HTMLElement | null;
    if (wrap) wrap.style.display = 'none';
    const textArea = document.getElementById('rp-upgrade-text') as HTMLTextAreaElement | null;
    if (textArea) textArea.value = '';
  } catch (e) {
    stream.textContent += `\n\n❌ ${e instanceof Error ? e.message : String(e)}`;
    btn.disabled = false;
    btn.textContent = 'Regenerate';
  }
}

export async function confirmRpDelete(filename: string, docType: string): Promise<void> {
  if (!confirm(`Delete "${filename}"? This cannot be undone.`)) return;
  try {
    const res = await fetch(`/api/doc/${docType}/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const body = (await res.json()) as ApiErrorBody;
      throw new Error(body.error?.message || 'Delete failed');
    }
    closeRefinePanel();
    await buildCanvasGraph(_canvasEpicFilename ?? '', _canvasDocType ?? '');
  } catch (e) {
    alert(`Failed to delete: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── Create new child node ──────────────────────────────────────
export function openCreatePanel(type: string): void {
  if (!_canvasEpicFilename) return;
  const panel = document.getElementById('refine-panel');
  if (!panel) return;
  panel.classList.add('open');
  document
    .querySelectorAll('.canvas-card.selected')
    .forEach((el) => el.classList.remove('selected'));

  panel.innerHTML = `
    <div class="rp-header">
      <div class="rp-meta">
        <span class="type-badge ${type}">${TYPE_LABEL[type] || type}</span>
        <span class="rp-title">New ${TYPE_LABEL[type]}</span>
      </div>
      <button class="rp-close" onclick="closeRefinePanel()" title="Close">✕</button>
    </div>
    <div class="rp-create-form">
      <div class="rp-field">
        <label class="rp-label">Title</label>
        <input class="rp-input" id="rp-create-title" type="text"
          placeholder="Optional — AI will infer one…" />
      </div>
      <div class="rp-field">
        <label class="rp-label">Description *</label>
        <textarea class="rp-textarea rp-textarea-tall" id="rp-create-idea"
          placeholder="Describe the ${TYPE_LABEL[type].toLowerCase()}…"></textarea>
      </div>
      <div class="rp-btn-row">
        <button class="btn-xs green" id="rp-create-btn"
          onclick="executeRpCreate('${type}')">Generate &amp; Link</button>
        <button class="btn-xs" onclick="closeRefinePanel()">Cancel</button>
      </div>
      <div class="rp-stream" id="rp-create-stream" style="display:none"></div>
    </div>`;

  (document.getElementById('rp-create-idea') as HTMLElement | null)?.focus();
}

interface RpCreateGenBody {
  title: string;
  idea: string;
  type: string;
  priority: string;
  fixVersion?: string;
  pi?: string;
  parentEpic?: string;
  parentFeature?: string;
}

export async function executeRpCreate(type: string): Promise<void> {
  const title = (document.getElementById('rp-create-title') as HTMLInputElement).value.trim();
  const idea = (document.getElementById('rp-create-idea') as HTMLTextAreaElement).value.trim();
  if (!idea) {
    (document.getElementById('rp-create-idea') as HTMLElement | null)?.focus();
    return;
  }

  const btn = document.getElementById('rp-create-btn') as HTMLButtonElement;
  const stream = document.getElementById('rp-create-stream') as HTMLElement;
  btn.disabled = true;
  btn.textContent = '⏳ Generating…';
  stream.textContent = '⚙ Generating document…';
  stream.style.display = 'block';

  try {
    const parentDoc = allDocs.find((d) => d.filename === _canvasEpicFilename);
    const genBody: RpCreateGenBody = { title, idea, type, priority: 'Medium' };
    if (parentDoc?.fixVersion) genBody.fixVersion = parentDoc.fixVersion;
    if (parentDoc?.pi && parentDoc.pi !== 'TBD') genBody.pi = parentDoc.pi;
    if (_canvasDocType === 'epic') genBody.parentEpic = _canvasEpicFilename ?? undefined;
    if (_canvasDocType === 'feature') genBody.parentFeature = _canvasEpicFilename ?? undefined;
    const genRes = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(genBody),
    });
    if (!genRes.ok) {
      const body = (await genRes.json()) as ApiErrorBody;
      throw new Error(body.error?.message || 'Generate failed');
    }
    const { filename: newFilename } = (await genRes.json()) as { filename: string };

    stream.textContent = `✓ Created ${newFilename}\n⚙ Linking…`;

    const linkRes = await fetch('/api/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: type,
        sourceFilename: newFilename,
        targetType: _canvasDocType,
        targetFilename: _canvasEpicFilename,
      }),
    });
    if (!linkRes.ok) throw new Error('Link failed');

    stream.textContent += '\n✓ Linked successfully.';

    await loadDocs();
    await buildCanvasGraph(_canvasEpicFilename ?? '', _canvasDocType ?? '');

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
