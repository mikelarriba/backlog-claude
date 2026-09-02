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
  postJSON,
  fetchJSON,
  deleteJSON,
  getErrorMessage,
  renderMarkdown,
} from './state.js';
import { loadDocs } from './list.js';
import { openDoc } from './detail.js';
import { _parseComments, _renderComments } from './detail-fields.js';
import {
  buildCanvasGraph,
  renderCanvas,
  rebuildCanvasEdges,
  _renderFpCanvas,
  computeAutoLayout,
} from './refine-canvas.js';
import { toggleManageLinks } from './refine-edges.js';
import { _fpCreateChild, _showEpicContextMenu } from './refine-nodes.js';
import { registerActions, registerInputActions, registerKeydownActions } from './actions.js';
// Typed data-action names for the refine panel's (epic/story/spike/bug
// create & edit forms) buttons (issue #461 migration — see actions.ts and
// CTX_ACTIONS in list-filters.ts / EDGE_ACTIONS in refine-edges.ts for the
// established pattern). Replaces the onclick="openCreatePanel(...)" /
// onclick="closeRefinePanel()" / etc. strings previously built by
// hand-interpolating escHtml() args into the template, which reached these
// handlers through main.ts's untyped window bridge instead of a direct,
// typed call.
//
// The refine panel's title/SP inline-edit inputs' onblur (`saveRpTitle()` /
// `saveRpStoryPoints(...)`) is left as-is — the data-action dispatcher only
// covers the delegated 'click' listener in main.ts, not 'blur'. The title
// input's onkeydown is migrated below onto the registerKeydownActions
// registry (issue #461's keydown spike — see actions.ts); the SP input's
// onkeydown stays inline since both its branches just call `this.blur()`
// with no bridge function to remove.
// The priority <select>'s onchange is migrated below via a direct
// addEventListener attached right after render (matching the existing
// convention for 'change' listeners elsewhere, e.g. jira-push.ts /
// roadmap-jira-sync.ts) instead of data-action, since dispatchAction is
// wired only to the document's 'click' listener.
export const REFINE_ACTIONS = {
  openCreatePanel: 'refineOpenCreatePanel',
  toggleManageLinks: 'refineToggleManageLinks',
  toggleEpicPanel: 'refineToggleEpicPanel',
  fpCreateChild: 'refineFpCreateChild',
  openEpicPanel: 'refineOpenEpicPanel',
  closePanel: 'refineClosePanel',
  toggleUpgrade: 'refineToggleUpgrade',
  openDocAndClose: 'refineOpenDocAndClose',
  confirmDelete: 'refineConfirmDelete',
  executeUpgrade: 'refineExecuteUpgrade',
  removeDep: 'refineRemoveDep',
  executeCreate: 'refineExecuteCreate',
};
registerActions({
  [REFINE_ACTIONS.openCreatePanel]: (el) => {
    openCreatePanel(el.dataset.doctype ?? '');
  },
  [REFINE_ACTIONS.toggleManageLinks]: () => {
    toggleManageLinks();
  },
  [REFINE_ACTIONS.toggleEpicPanel]: (el) => {
    _toggleEpicPanel(el.dataset.epicFilename ?? '', el.dataset.featureFilename ?? '');
  },
  [REFINE_ACTIONS.fpCreateChild]: (el) => {
    void _fpCreateChild(
      el.dataset.doctype ?? '',
      el.dataset.epicFilename ?? '',
      el.dataset.featureFilename ?? ''
    );
  },
  [REFINE_ACTIONS.openEpicPanel]: (el) => {
    void openManualRefine(el.dataset.epicFilename ?? '', 'epic');
  },
  [REFINE_ACTIONS.closePanel]: () => {
    closeRefinePanel();
  },
  [REFINE_ACTIONS.toggleUpgrade]: () => {
    toggleRpUpgrade();
  },
  [REFINE_ACTIONS.openDocAndClose]: (el) => {
    openDoc(el.dataset.filename ?? '', el.dataset.doctype ?? '');
    closeRefineView();
  },
  [REFINE_ACTIONS.confirmDelete]: (el) => {
    void confirmRpDelete(el.dataset.filename ?? '', el.dataset.doctype ?? '');
  },
  [REFINE_ACTIONS.executeUpgrade]: (el) => {
    void executeRpUpgrade(el.dataset.filename ?? '', el.dataset.doctype ?? '');
  },
  [REFINE_ACTIONS.removeDep]: (el) => {
    void _removeCanvasLink(
      el.dataset.linkType ?? '',
      el.dataset.srcFilename ?? '',
      el.dataset.srcDoctype ?? '',
      el.dataset.tgtFilename ?? '',
      el.dataset.tgtDoctype ?? ''
    );
  },
  [REFINE_ACTIONS.executeCreate]: (el) => {
    void executeRpCreate(el.dataset.doctype ?? '');
  },
});
// Typed input-action registration (issue #461 migration — see actions.ts
// for the registerInputActions pattern, generalized from the click/change
// registries). Reuses the canvas search box's existing
// data-input-action="..." string value (index.html) as the registered
// name, same single-site convention the registerChangeActions migrations
// use.
registerInputActions({
  onCanvasSearchInput: (el) => {
    onCanvasSearch(el.value);
  },
});
// Typed data-keydown-action name for the refine panel's title-edit input
// (issue #461's keydown-registry spike — see actions.ts's "Keydown-event
// registry" section). Replaces the
// onkeydown="if(event.key==='Enter'){this.blur()} if(event.key==='Escape')
// {cancelRpTitleEdit()}" string previously built by hand. cancelRpTitleEdit
// is defined further down in this same module, so this also removes the
// last reason it needed to be reachable through main.ts's untyped window
// bridge.
const RP_TITLE_KEYDOWN_ACTION = 'refineRpTitleKeydown';
registerKeydownActions({
  [RP_TITLE_KEYDOWN_ACTION]: (el, e) => {
    if (e.key === 'Enter') {
      el.blur();
    } else if (e.key === 'Escape') {
      cancelRpTitleEdit();
    }
  },
});
// ── Card search / filter ──────────────────────────────────────
export function onCanvasSearch(query) {
  const cards = document.querySelectorAll('#refine-canvas .canvas-card');
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
export async function openManualRefine(filename, docType) {
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
  const listView = document.getElementById('list-view');
  if (listView) listView.style.display = 'none';
  document.getElementById('detail-view')?.classList.remove('show');
  document.getElementById('refine-view')?.classList.add('show');
  // Clear search
  const searchInput = document.getElementById('refine-search');
  if (searchInput) searchInput.value = '';
  // Render the correct "+ Create" buttons for this doc type
  _canvasManageLinks = false;
  const addBtns = document.getElementById('refine-add-btns');
  if (addBtns) {
    if (docType === 'feature') {
      addBtns.innerHTML = `<button class="btn-xs" data-action="${REFINE_ACTIONS.openCreatePanel}" data-doctype="epic">＋ Epic</button>`;
    } else {
      addBtns.innerHTML = `
      <button class="btn-xs green" data-action="${REFINE_ACTIONS.openCreatePanel}" data-doctype="story">＋ Story</button>
      <button class="btn-xs" data-action="${REFINE_ACTIONS.openCreatePanel}" data-doctype="spike">＋ Spike</button>
      <button class="btn-xs red" data-action="${REFINE_ACTIONS.openCreatePanel}" data-doctype="bug">＋ Bug</button>
      <button class="btn-xs" id="manage-links-btn" data-action="${REFINE_ACTIONS.toggleManageLinks}">⛓ Manage Links</button>`;
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
function _onCanvasKeydown(e) {
  if (e.key === 'Escape' && _canvasSelectedCards.size > 0) {
    _canvasSelectedCards.clear();
    document
      .querySelectorAll('.canvas-card.canvas-multi-selected')
      .forEach((el) => el.classList.remove('canvas-multi-selected'));
  }
}
// Resets canvas/refine state (selection, panel state, keydown listener) and
// hides the refine view, without touching any other view's visibility. Used
// both by closeRefineView() (explicit close, which also restores whichever
// view was open before) and by callers that are navigating away to a
// different view entirely (main.ts's navigateTo, roadmap.ts's
// openRoadmapView) and must not have a stale refine session's state leak
// into the next one, but also must not have this reach back in and re-show
// a view they're in the middle of hiding.
export function resetRefineViewState() {
  document.getElementById('refine-view')?.classList.remove('show');
  document.removeEventListener('keydown', _onCanvasKeydown);
  updateSplitMode();
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
}
export function closeRefineView() {
  resetRefineViewState();
  if (currentFilename && currentDocType) {
    document.getElementById('detail-view')?.classList.add('show');
  } else {
    const listView = document.getElementById('list-view');
    if (listView) listView.style.display = 'flex';
  }
}
// ── Feature multi-panel view ───────────────────────────────────
const _FP_COLLAPSED_KEY = (fn) => `fp:collapsed:${fn}`;
export async function renderFeatureMultiPanel(featureFilename) {
  const container = document.getElementById('refine-canvas');
  if (!container) return;
  container.innerHTML = '<div class="canvas-empty">Loading feature…</div>';
  _panelStates.clear();
  let data;
  try {
    data = await fetchJSON(`/api/links/feature/${encodeURIComponent(featureFilename)}/deep`);
  } catch (e) {
    container.innerHTML = `<div class="canvas-empty">Error: ${escHtml(getErrorMessage(e))}</div>`;
    return;
  }
  const collapsedSet = _fpLoadCollapsed(featureFilename);
  const wrapper = document.createElement('div');
  wrapper.className = 'feature-panels-container';
  for (const epic of data.epics) {
    const children = epic.children || [];
    const ps = {
      stories: children,
      layout: {},
      blocks: epic.blocks || [],
      parallel: epic.parallel || [],
    };
    _panelStates.set(epic.filename, ps);
    // Load or compute layout for this epic's panel
    try {
      const saved = await fetchJSON(`/api/canvas/layout/${encodeURIComponent(epic.filename)}`);
      if (Object.keys(saved).length) ps.layout = saved;
    } catch {
      /* no-op */
    }
    if (!Object.keys(ps.layout).length && children.length) {
      ps.layout = computeAutoLayout(children, ps.blocks, ps.parallel);
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
function _fpLoadCollapsed(featureFilename) {
  try {
    return new Set(JSON.parse(localStorage.getItem(_FP_COLLAPSED_KEY(featureFilename)) || '[]'));
  } catch {
    return new Set();
  }
}
function _fpSaveCollapsed(featureFilename) {
  const collapsed = [];
  document
    .querySelectorAll('.feature-panel.fp-collapsed')
    .forEach((p) => collapsed.push(p.dataset.epicFilename));
  try {
    localStorage.setItem(_FP_COLLAPSED_KEY(featureFilename), JSON.stringify(collapsed));
  } catch {
    /* no-op */
  }
}
export function _toggleEpicPanel(epicFilename, featureFilename) {
  const panel = document.querySelector(
    `.feature-panel[data-epic-filename="${CSS.escape(epicFilename)}"]`
  );
  if (!panel) return;
  panel.classList.toggle('fp-collapsed');
  const chevron = panel.querySelector('.fp-chevron');
  if (chevron) chevron.textContent = panel.classList.contains('fp-collapsed') ? '▶' : '▼';
  _fpSaveCollapsed(featureFilename);
}
function _renderEpicPanel(epic, ps, featureFilename, isCollapsed) {
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
    <div class="fp-header" data-action="${REFINE_ACTIONS.toggleEpicPanel}" data-epic-filename="${ef}" data-feature-filename="${ff}">
      <span class="fp-chevron">${isCollapsed ? '▶' : '▼'}</span>
      <span class="type-badge epic">Epic</span>
      <span class="fp-title">${escHtml(epic.title || epic.filename)}</span>
      <span class="fp-meta">${count} item${count !== 1 ? 's' : ''}${totalSP ? ` · ${totalSP} SP` : ''}</span>
    </div>
    <div class="fp-body">
      <div class="fp-toolbar">
        <button class="btn-xs green" data-action="${REFINE_ACTIONS.fpCreateChild}" data-doctype="story" data-epic-filename="${ef}" data-feature-filename="${ff}">＋ Story</button>
        <button class="btn-xs" data-action="${REFINE_ACTIONS.fpCreateChild}" data-doctype="spike" data-epic-filename="${ef}" data-feature-filename="${ff}">＋ Spike</button>
        <button class="btn-xs red" data-action="${REFINE_ACTIONS.fpCreateChild}" data-doctype="bug" data-epic-filename="${ef}" data-feature-filename="${ff}">＋ Bug</button>
        <button class="btn-xs" data-action="${REFINE_ACTIONS.openEpicPanel}" data-epic-filename="${ef}">↗ Open Epic</button>
      </div>
      <div class="fp-canvas" id="fp-canvas-${ef}"></div>
    </div>`;
  // Right-click on epic header → context menu with Split Epic
  const header = panel.querySelector('.fp-header');
  header?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    _showEpicContextMenu(e.clientX, e.clientY, epic.filename, featureFilename);
  });
  // Canvas rendering is deferred — called from renderFeatureMultiPanel
  // after the panel is actually inserted into the DOM.
  return panel;
}
// ── Refine Panel ───────────────────────────────────────────────
export function closeRefinePanel() {
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
export async function openRefinePanel(filename, docType) {
  const panel = document.getElementById('refine-panel');
  if (!panel) return;
  panel.innerHTML = '<div class="rp-loading">Loading…</div>';
  panel.classList.add('open');
  try {
    const { content } = await fetchJSON(`/api/doc/${docType}/${encodeURIComponent(filename)}`);
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
          <button class="rp-close" data-action="${REFINE_ACTIONS.closePanel}" title="Close">✕</button>
        </div>
        <input class="rp-title-input" id="rp-title-input" type="text"
          value="${escHtml(title)}" data-original="${escHtml(title)}"
          data-filename="${ef}" data-doctype="${et}"
          onblur="saveRpTitle()" data-keydown-action="${RP_TITLE_KEYDOWN_ACTION}" />
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
            <select class="rp-priority-select" id="rp-priority-select">
              <option value="Critical"${pri === 'Critical' ? ' selected' : ''}>Critical</option>
              <option value="High"${pri === 'High' ? ' selected' : ''}>High</option>
              <option value="Medium"${pri === 'Medium' ? ' selected' : ''}>Medium</option>
              <option value="Low"${pri === 'Low' ? ' selected' : ''}>Low</option>
            </select>
          </div>
        </div>
      </div>
      <div class="rp-toolbar">
        <button class="btn-xs" data-action="${REFINE_ACTIONS.toggleUpgrade}">↑ Upgrade</button>
        <button class="btn-xs" data-action="${REFINE_ACTIONS.openDocAndClose}" data-filename="${ef}" data-doctype="${et}">↗ Open</button>
        ${docType !== 'feature' ? `<button class="btn-xs red" data-action="${REFINE_ACTIONS.confirmDelete}" data-filename="${ef}" data-doctype="${et}">Delete</button>` : ''}
      </div>
      <div class="rp-upgrade-wrap" id="rp-upgrade-wrap" style="display:none">
        <textarea class="rp-textarea" id="rp-upgrade-text"
          placeholder="Describe what to change or improve…"></textarea>
        <div class="rp-btn-row">
          <button class="btn-xs green" id="rp-upgrade-run"
            data-action="${REFINE_ACTIONS.executeUpgrade}" data-filename="${ef}" data-doctype="${et}">Regenerate</button>
          <button class="btn-xs" data-action="${REFINE_ACTIONS.toggleUpgrade}">Cancel</button>
        </div>
        <div class="rp-stream" id="rp-upgrade-stream" style="display:none"></div>
      </div>
      <div class="rp-content markdown" id="rp-content">
        ${renderMarkdown(stripFrontmatter(content).replace(/\n## Comments\b[\s\S]*$/, ''))}
      </div>
      <div class="rp-deps-section" id="rp-deps-section">
        <div class="rp-loading">Loading dependencies…</div>
      </div>
      <div class="rp-comments-section comments-section hidden" id="rp-comments-section"></div>`;
    // Priority <select> onchange: attached directly (not via data-action)
    // since the typed dispatchAction() registry is wired only to the
    // document's delegated 'click' listener in main.ts, not 'change' — this
    // matches the existing direct-addEventListener convention for 'change'
    // listeners elsewhere (jira-push.ts, roadmap-jira-sync.ts).
    document.getElementById('rp-priority-select')?.addEventListener('change', () => {
      void saveRpPriority(filename, docType);
    });
    // Load and render dependency section and comments
    _loadRpDeps(filename, docType);
    _renderComments(
      _parseComments(content),
      filename,
      docType,
      document.getElementById('rp-comments-section')
    );
  } catch (e) {
    console.error('openRefinePanel failed for', filename, docType, e);
    panel.innerHTML = '<div class="rp-loading">Failed to load content.</div>';
  }
}
async function _loadRpDeps(filename, docType) {
  const section = document.getElementById('rp-deps-section');
  if (!section) return;
  try {
    const data = await fetchJSON(
      `/api/links/${encodeURIComponent(docType)}/${encodeURIComponent(filename)}`
    );
    function depRow(item, lType) {
      const ef = escHtml(item.filename);
      const et = escHtml(item.docType || docType);
      return `<div class="rp-dep-row">
        <span class="rp-dep-title">${escHtml(item.title || item.filename)}</span>
        <button class="btn-ghost btn-xs dep-remove-btn"
          data-action="${REFINE_ACTIONS.removeDep}" data-link-type="${lType}"
          data-src-filename="${escHtml(filename)}" data-src-doctype="${escHtml(docType)}"
          data-tgt-filename="${ef}" data-tgt-doctype="${et}">&times;</button>
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
  linkType,
  srcFilename,
  srcDocType,
  tgtFilename,
  tgtDocType
) {
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
    // fetchJSON is used directly (rather than deleteJSON) because this DELETE
    // needs a JSON request body, which deleteJSON's signature doesn't support.
    await fetchJSON('/api/link', {
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
    showJiraToast('error', getErrorMessage(e));
  }
}
// ── Inline field editing (refine panel) ───────────────────────
export async function saveRpTitle() {
  const input = document.getElementById('rp-title-input');
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
export function cancelRpTitleEdit() {
  const input = document.getElementById('rp-title-input');
  if (input) {
    input.value = input.dataset.original || '';
    input.blur();
  }
}
export async function saveRpStoryPoints(filename, docType) {
  const input = document.getElementById('rp-sp-input');
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
export async function saveRpPriority(filename, docType) {
  const sel = document.getElementById('rp-priority-select');
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
export function toggleRpUpgrade() {
  const wrap = document.getElementById('rp-upgrade-wrap');
  if (!wrap) return;
  const isOpen = wrap.style.display !== 'none';
  wrap.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) document.getElementById('rp-upgrade-text')?.focus();
}
export async function executeRpUpgrade(filename, docType) {
  const feedback = document.getElementById('rp-upgrade-text')?.value.trim();
  if (!feedback) {
    document.getElementById('rp-upgrade-text')?.focus();
    return;
  }
  const btn = document.getElementById('rp-upgrade-run');
  const stream = document.getElementById('rp-upgrade-stream');
  btn.disabled = true;
  btn.textContent = '⏳ Regenerating…';
  stream.textContent = '';
  stream.style.display = 'block';
  try {
    let result = null;
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
      const content = result.content;
      const rpContent = document.getElementById('rp-content');
      if (rpContent) rpContent.innerHTML = renderMarkdown(stripFrontmatter(content));
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
    const wrap = document.getElementById('rp-upgrade-wrap');
    if (wrap) wrap.style.display = 'none';
    const textArea = document.getElementById('rp-upgrade-text');
    if (textArea) textArea.value = '';
  } catch (e) {
    stream.textContent += `\n\n❌ ${e instanceof Error ? e.message : String(e)}`;
    btn.disabled = false;
    btn.textContent = 'Regenerate';
  }
}
export async function confirmRpDelete(filename, docType) {
  if (!confirm(`Delete "${filename}"? This cannot be undone.`)) return;
  try {
    await deleteJSON(`/api/doc/${docType}/${encodeURIComponent(filename)}`);
    closeRefinePanel();
    await buildCanvasGraph(_canvasEpicFilename ?? '', _canvasDocType ?? '');
  } catch (e) {
    alert(`Failed to delete: ${getErrorMessage(e)}`);
  }
}
// ── Create new child node ──────────────────────────────────────
export function openCreatePanel(type) {
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
      <button class="rp-close" data-action="${REFINE_ACTIONS.closePanel}" title="Close">✕</button>
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
          data-action="${REFINE_ACTIONS.executeCreate}" data-doctype="${type}">Generate &amp; Link</button>
        <button class="btn-xs" data-action="${REFINE_ACTIONS.closePanel}">Cancel</button>
      </div>
      <div class="rp-stream" id="rp-create-stream" style="display:none"></div>
    </div>`;
  document.getElementById('rp-create-idea')?.focus();
}
export async function executeRpCreate(type) {
  const title = document.getElementById('rp-create-title').value.trim();
  const idea = document.getElementById('rp-create-idea').value.trim();
  if (!idea) {
    document.getElementById('rp-create-idea')?.focus();
    return;
  }
  const btn = document.getElementById('rp-create-btn');
  const stream = document.getElementById('rp-create-stream');
  btn.disabled = true;
  btn.textContent = '⏳ Generating…';
  stream.textContent = '⚙ Generating document…';
  stream.style.display = 'block';
  try {
    const parentDoc = allDocs.find((d) => d.filename === _canvasEpicFilename);
    const genBody = { title, idea, type, priority: 'Medium' };
    if (parentDoc?.fixVersion) genBody.fixVersion = parentDoc.fixVersion;
    if (parentDoc?.pi && parentDoc.pi !== 'TBD') genBody.pi = parentDoc.pi;
    if (_canvasDocType === 'epic') genBody.parentEpic = _canvasEpicFilename ?? undefined;
    if (_canvasDocType === 'feature') genBody.parentFeature = _canvasEpicFilename ?? undefined;
    const { filename: newFilename } = await postJSON('/api/generate', genBody);
    stream.textContent = `✓ Created ${newFilename}\n⚙ Linking…`;
    await postJSON('/api/link', {
      sourceType: type,
      sourceFilename: newFilename,
      targetType: _canvasDocType,
      targetFilename: _canvasEpicFilename,
    });
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
//# sourceMappingURL=refine.js.map
