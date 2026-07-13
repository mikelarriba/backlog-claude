// ── Roadmap View coordinator (Two-Panel: Epics + Stories) ──────
import { escHtml, postJSON, showJiraToast, fetchJSON, getErrorMessage, openModal, closeModal } from './state.js';
import type { SprintConfig } from './state.js';
import { renderRoadmapBoard } from './roadmap-render.js';
import { clearRoadmapSelection } from './roadmap-select.js';
import { on, upsertDoc } from './store.js';

export interface RoadmapSprint {
  name: string;
  capacity: number;
  [key: string]: unknown;
}

// _roadmapVisiblePis is in state.js as a _storeVar global
let _roadmapPanelState: Record<string, boolean> = { epics: true, stories: true }; // expanded/collapsed
let _roadmapFocusedEpic: string | null = null; // filename of clicked feature (focus mode)

// Re-render PI filter when piSettings arrives (may load after roadmap opens)
on('piSettings:changed', () => {
  if (isRoadmapOpen()) populateRoadmapPiFilter();
});

// ── Open / Close ─────────────────────────────────────────────
export function openRoadmapView(): void {
  // Hide other views
  (document.getElementById('list-view') as HTMLElement).style.display = 'none';
  document.getElementById('refine-view')?.classList.remove('show');
  document.getElementById('detail-view')!.classList.remove('show');
  document.querySelector('.right')!.classList.remove('has-selection');
  currentFilename = null;
  currentDocType = null;

  // Show roadmap
  document.getElementById('roadmap-view')!.classList.add('show');
  document.querySelector('.right')!.classList.add('roadmap-mode');

  // Populate PI filter checkboxes
  populateRoadmapPiFilter();

  // Reset focus, search and multi-selection
  _roadmapFocusedEpic = null;
  clearRoadmapSelection();
  const searchInput = document.getElementById('rm-epic-search') as HTMLInputElement | null;
  if (searchInput) searchInput.value = '';

  renderRoadmapBoard();
}

export function closeRoadmapView(): void {
  document.getElementById('roadmap-view')!.classList.remove('show');
  document.querySelector('.right')!.classList.remove('roadmap-mode');
  document.querySelector('.right')!.classList.remove('has-selection');
  document.getElementById('detail-view')!.classList.remove('show');
  currentFilename = null;
  currentDocType = null;
  (document.getElementById('list-view') as HTMLElement).style.display = '';
  _roadmapVisiblePis.clear();
  _roadmapFocusedEpic = null;
  clearRoadmapSelection();
}

export function isRoadmapOpen(): boolean {
  return document.getElementById('roadmap-view')!.classList.contains('show');
}

export function refreshRoadmapView(): void {
  if (isRoadmapOpen()) renderRoadmapBoard();
}

// ── PI Filter (checkboxes) ───────────────────────────────────
function populateRoadmapPiFilter(): void {
  const container = document.getElementById('roadmap-pi-filter');
  if (!container) return;
  const pis = [piSettings.currentPi, piSettings.nextPi].filter(Boolean) as string[];
  // On first open, check all PIs
  if (!_roadmapVisiblePis.size) pis.forEach((p) => _roadmapVisiblePis.add(p));
  let html = '';
  for (const pi of pis) {
    const checked = _roadmapVisiblePis.has(pi) ? ' checked' : '';
    html += `<label class="rm-pi-checkbox"><input type="checkbox"${checked} onchange="toggleRoadmapPi('${escHtml(pi)}', this.checked)"><span>${escHtml(pi)}</span></label>`;
  }
  container.innerHTML = html;
}

export function toggleRoadmapPi(piName: string, checked: boolean): void {
  if (checked) _roadmapVisiblePis.add(piName);
  else _roadmapVisiblePis.delete(piName);
  renderRoadmapBoard();
}

// ── Panel collapse ───────────────────────────────────────────
export function toggleRoadmapPanel(panel: string): void {
  _roadmapPanelState[panel] = !_roadmapPanelState[panel];
  const body = document.getElementById(`rm-body-${panel}`)!;
  const chevron = document.getElementById(`rm-chevron-${panel}`)!;
  if (_roadmapPanelState[panel]) {
    body.classList.remove('collapsed');
    chevron.textContent = '▼';
  } else {
    body.classList.add('collapsed');
    chevron.textContent = '▶';
  }
}

// ── Epic search filter ──────────────────────────────────────
export function filterRoadmapEpics(query: string): void {
  const q = query.trim().toLowerCase();
  document.querySelectorAll<HTMLElement>('.rm-epic-card').forEach((card) => {
    const title = (card.querySelector('.rm-epic-title')?.textContent || '').toLowerCase();
    card.style.display = !q || title.includes(q) ? '' : 'none';
  });
  // Update visible count
  const visible = document.querySelectorAll('.rm-epic-card:not([style*="display: none"])').length;
  document.getElementById('rm-count-epics')!.textContent = String(visible);
}

// ── Epic focus (click on epic card) ──────────────────────────
export function focusEpic(filename: string): void {
  if (_roadmapFocusedEpic === filename) {
    _roadmapFocusedEpic = null; // toggle off
  } else {
    _roadmapFocusedEpic = filename;
  }
  applyEpicFocus();
}

export function applyEpicFocus(): void {
  // Epic panel: highlight focused epic
  document.querySelectorAll<HTMLElement>('.rm-epic-card').forEach((card) => {
    card.classList.toggle('rm-focused', card.dataset['filename'] === _roadmapFocusedEpic);
    card.classList.toggle(
      'rm-dimmed',
      !!_roadmapFocusedEpic && card.dataset['filename'] !== _roadmapFocusedEpic
    );
  });

  // Story panel: dim non-matching stories
  const focusNone = _roadmapFocusedEpic === '__none__';
  document.querySelectorAll<HTMLElement>('.roadmap-card').forEach((card) => {
    if (!_roadmapFocusedEpic) {
      card.classList.remove('rm-dimmed');
      return;
    }
    const parent = card.dataset['parent'] || '';
    const matches = focusNone ? parent === '' : parent === _roadmapFocusedEpic;
    card.classList.toggle('rm-dimmed', !matches);
  });
}

// ── Gather all sprints across visible PIs ────────────────────
export function getAllSprints(): RoadmapSprint[] {
  const all: RoadmapSprint[] = [];
  const seen = new Set<string>();
  const pis = [piSettings.currentPi, piSettings.nextPi].filter(Boolean) as string[];
  for (const pi of pis) {
    if (!_roadmapVisiblePis.has(pi)) continue; // skip unchecked PIs
    for (const s of ((sprintConfig as SprintConfig)[pi] as RoadmapSprint[] | undefined) || []) {
      if (!seen.has(s.name)) {
        seen.add(s.name);
        all.push(s);
      }
    }
  }
  return all;
}

// ── Dependency modal ─────────────────────────────────────────
let _depModalFilename: string | null = null;
let _depModalDocType: string | null = null;

interface DepLinkItem {
  filename: string;
  title?: string;
  docType?: string;
}

interface DepLinksData {
  blocks?: DepLinkItem[];
  blockedBy?: DepLinkItem[];
  parallel?: DepLinkItem[];
}

export async function openDepModal(filename: string, docType: string): Promise<void> {
  _depModalFilename = filename;
  _depModalDocType = docType;

  const doc = allDocs.find((d) => d.filename === filename);
  document.getElementById('dep-modal-subtitle')!.textContent = doc?.title || filename;

  // Reset state
  document.getElementById('dep-blocks-list')!.innerHTML = '<div class="dep-loading">Loading…</div>';
  document.getElementById('dep-blockedby-list')!.innerHTML = '';

  openModal('dep-overlay');

  try {
    const data = (await fetchJSON(
      `/api/links/${encodeURIComponent(docType)}/${encodeURIComponent(filename)}`
    )) as DepLinksData;
    renderDepLists(data);
    populateDepTargetSelect(filename, data);
  } catch (e) {
    document.getElementById('dep-blocks-list')!.innerHTML =
      `<div class="dep-error">${escHtml(getErrorMessage(e))}</div>`;
  }
}

function renderDepLists(data: DepLinksData): void {
  function depItemHtml(item: DepLinkItem, direction: string): string {
    return `
      <div class="dep-item">
        <span class="dep-item-title">${escHtml(item.title || item.filename)}</span>
        <button class="btn-ghost btn-xs dep-remove-btn"
                onclick="removeDepLink('${escHtml(item.filename)}','${escHtml(item.docType || _depModalDocType || '')}','${direction}')"
                title="Remove">&times;</button>
      </div>`;
  }

  const blocksList = document.getElementById('dep-blocks-list')!;
  const blockedByList = document.getElementById('dep-blockedby-list')!;

  blocksList.innerHTML = (data.blocks || []).length
    ? (data.blocks || []).map((item) => depItemHtml(item, 'blocks')).join('')
    : '<div class="dep-empty">None</div>';

  blockedByList.innerHTML = (data.blockedBy || []).length
    ? (data.blockedBy || []).map((item) => depItemHtml(item, 'blockedBy')).join('')
    : '<div class="dep-empty">None</div>';

  const parallelList = document.getElementById('dep-parallel-list');
  if (parallelList) {
    parallelList.innerHTML = (data.parallel || []).length
      ? (data.parallel || []).map((item) => depItemHtml(item, 'parallel')).join('')
      : '<div class="dep-empty">None</div>';
  }
}

function populateDepTargetSelect(excludeFilename: string, currentData: DepLinksData): void {
  const leafTypes = new Set(['story', 'spike', 'bug']);
  const alreadyBlocks = new Set((currentData.blocks || []).map((b) => b.filename));
  const alreadyParallel = new Set((currentData.parallel || []).map((p) => p.filename));
  alreadyBlocks.add(excludeFilename);
  alreadyParallel.add(excludeFilename);

  const allCandidates = allDocs
    .filter((d) => leafTypes.has(d.docType))
    .sort((a, b) => (a.title || a.filename).localeCompare(b.title || b.filename));

  const blockCandidates = allCandidates.filter((d) => !alreadyBlocks.has(d.filename));
  const parallelCandidates = allCandidates.filter((d) => !alreadyParallel.has(d.filename));

  const select = document.getElementById('dep-target-select') as HTMLSelectElement | null;
  if (select) {
    select.innerHTML = blockCandidates.length
      ? blockCandidates
          .map(
            (d) =>
              `<option value="${escHtml(d.filename)}" data-doctype="${d.docType}">${escHtml(d.title || d.filename)}</option>`
          )
          .join('')
      : '<option value="" disabled>No candidates</option>';
  }

  const parallelSelect = document.getElementById('dep-parallel-select') as HTMLSelectElement | null;
  if (parallelSelect) {
    parallelSelect.innerHTML = parallelCandidates.length
      ? parallelCandidates
          .map(
            (d) =>
              `<option value="${escHtml(d.filename)}" data-doctype="${d.docType}">${escHtml(d.title || d.filename)}</option>`
          )
          .join('')
      : '<option value="" disabled>No candidates</option>';
  }
}

export async function addDepLink(): Promise<void> {
  const select = document.getElementById('dep-target-select') as HTMLSelectElement | null;
  if (!select) return;
  const targetFilename = select.value;
  if (!targetFilename) return;
  const targetDocType =
    (select.selectedOptions[0] as HTMLOptionElement | undefined)?.dataset['doctype'] || 'story';

  try {
    await postJSON('/api/link', {
      linkType: 'blocks',
      sourceType: _depModalDocType,
      sourceFilename: _depModalFilename,
      targetType: targetDocType,
      targetFilename,
    });
    // Refresh modal
    const data = (await fetchJSON(
      `/api/links/${encodeURIComponent(_depModalDocType!)}/${encodeURIComponent(_depModalFilename!)}`
    )) as DepLinksData;
    renderDepLists(data);
    populateDepTargetSelect(_depModalFilename!, data);
    // Update allDocs entry
    const srcDoc = allDocs.find((d) => d.filename === _depModalFilename);
    if (srcDoc) {
      const blocks = srcDoc.blocks || [];
      if (!blocks.includes(targetFilename))
        upsertDoc({ ...srcDoc, blocks: [...blocks, targetFilename] });
    }
    const tgtDoc = allDocs.find((d) => d.filename === targetFilename);
    if (tgtDoc) {
      const blockedBy = tgtDoc.blockedBy || [];
      if (!blockedBy.includes(_depModalFilename!))
        upsertDoc({ ...tgtDoc, blockedBy: [...blockedBy, _depModalFilename!] });
    }
    renderRoadmapBoard();
  } catch (e) {
    showJiraToast('error', getErrorMessage(e));
  }
}

export async function addParallelLink(): Promise<void> {
  const select = document.getElementById('dep-parallel-select') as HTMLSelectElement | null;
  if (!select) return;
  const targetFilename = select.value;
  if (!targetFilename) return;
  const targetDocType =
    (select.selectedOptions[0] as HTMLOptionElement | undefined)?.dataset['doctype'] || 'story';

  try {
    await postJSON('/api/link', {
      linkType: 'parallel',
      sourceType: _depModalDocType,
      sourceFilename: _depModalFilename,
      targetType: targetDocType,
      targetFilename,
    });
    const data = (await fetchJSON(
      `/api/links/${encodeURIComponent(_depModalDocType!)}/${encodeURIComponent(_depModalFilename!)}`
    )) as DepLinksData;
    renderDepLists(data);
    populateDepTargetSelect(_depModalFilename!, data);
    renderRoadmapBoard();
  } catch (e) {
    showJiraToast('error', getErrorMessage(e));
  }
}

export async function removeDepLink(
  targetFilename: string,
  targetDocType: string,
  direction: string
): Promise<void> {
  try {
    let srcFilename: string | null,
      srcDocType: string | null,
      tgtFilename: string,
      tgtDocType: string,
      linkType: string;
    if (direction === 'parallel') {
      linkType = 'parallel';
      srcFilename = _depModalFilename;
      srcDocType = _depModalDocType;
      tgtFilename = targetFilename;
      tgtDocType = targetDocType;
    } else if (direction === 'blocks') {
      linkType = 'blocks';
      srcFilename = _depModalFilename;
      srcDocType = _depModalDocType;
      tgtFilename = targetFilename;
      tgtDocType = targetDocType;
    } else {
      linkType = 'blocks';
      srcFilename = targetFilename;
      srcDocType = targetDocType;
      tgtFilename = _depModalFilename!;
      tgtDocType = _depModalDocType!;
    }
    // fetchJSON is used directly (rather than deleteJSON) because this DELETE
    // needs a JSON request body, which deleteJSON's signature doesn't support.
    await fetchJSON('/api/link', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        linkType,
        sourceType: srcDocType,
        sourceFilename: srcFilename,
        targetType: tgtDocType,
        targetFilename: tgtFilename,
      }),
    });
    // Refresh modal
    const data = (await fetchJSON(
      `/api/links/${encodeURIComponent(_depModalDocType!)}/${encodeURIComponent(_depModalFilename!)}`
    )) as DepLinksData;
    renderDepLists(data);
    populateDepTargetSelect(_depModalFilename!, data);
    // Update allDocs entries
    const srcDoc = allDocs.find((d) => d.filename === srcFilename);
    if (srcDoc)
      upsertDoc({ ...srcDoc, blocks: (srcDoc.blocks || []).filter((f) => f !== tgtFilename) });
    const tgtDoc = allDocs.find((d) => d.filename === tgtFilename);
    if (tgtDoc)
      upsertDoc({
        ...tgtDoc,
        blockedBy: (tgtDoc.blockedBy || []).filter((f) => f !== srcFilename),
      });
    renderRoadmapBoard();
  } catch (e) {
    showJiraToast('error', getErrorMessage(e));
  }
}

export function closeDepModal(): void {
  closeModal('dep-overlay');
  _depModalFilename = null;
  _depModalDocType = null;
}

// ── Split modal (kept from old roadmap) ──────────────────────
let _splitModalFilename: string | null = null;
let _splitModalDocType: string | null = null;
let _splitModalSprint1: string | null = null;
let _splitModalSprint2: string | null = null;

export function openSplitModal(
  filename: string,
  docType: string,
  sprint1?: string | null,
  sprint2?: string | null
): void {
  _splitModalFilename = filename;
  _splitModalDocType = docType;
  _splitModalSprint1 = sprint1 || null;
  _splitModalSprint2 = sprint2 || null;

  const doc = allDocs.find((d) => d.filename === filename && d.docType === docType);
  const sp = Number(doc?.storyPoints) || 0;
  const sprints = getAllSprints();

  const sprintOptions = sprints
    .map((s) => `<option value="${escHtml(s.name)}">${escHtml(s.name)}</option>`)
    .join('');

  const sel1 = sprint1
    ? `<option value="${escHtml(sprint1)}" selected>${escHtml(sprint1)}</option>${sprintOptions}`
    : sprintOptions;
  const sel2 = sprint2
    ? `<option value="${escHtml(sprint2)}" selected>${escHtml(sprint2)}</option>${sprintOptions}`
    : sprintOptions;

  document.getElementById('split-modal-title')!.textContent = doc?.title || filename;
  document.getElementById('split-modal-sp')!.textContent = sp
    ? `${sp} SP → ~${Math.round(sp / 2)} SP each`
    : 'No SP estimate';
  document.getElementById('split-sprint-1')!.innerHTML = sel1;
  document.getElementById('split-sprint-2')!.innerHTML = sel2;
  document.getElementById('split-modal-output')!.innerHTML = '';
  document.getElementById('split-modal-status')!.className = 'split-modal-status';

  const applyBtn = document.getElementById('split-apply-btn') as HTMLButtonElement;
  applyBtn.disabled = false;
  applyBtn.textContent = 'Split with AI';

  openModal('split-overlay');
}

export function closeSplitModal(): void {
  closeModal('split-overlay');
  _splitModalFilename = null;
  _splitModalDocType = null;
}

export async function executeSplit(): Promise<void> {
  if (!_splitModalFilename) return;

  const sprint1 = (document.getElementById('split-sprint-1') as HTMLSelectElement).value;
  const sprint2 = (document.getElementById('split-sprint-2') as HTMLSelectElement).value;
  const btn = document.getElementById('split-apply-btn') as HTMLButtonElement;
  const output = document.getElementById('split-modal-output')!;
  const status = document.getElementById('split-modal-status')!;

  btn.disabled = true;
  btn.textContent = 'Splitting…';
  output.textContent = '';
  status.className = 'split-modal-status';

  try {
    // Raw fetch: this streams SSE progress/text events, not a single JSON response —
    // the shared fetchJSON/postJSON helpers don't apply here.
    const res = await fetch('/api/docs/split-story', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: _splitModalFilename,
        docType: _splitModalDocType,
        targetCount: 2,
        sprints: [sprint1, sprint2].filter(Boolean),
      }),
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;
    let result: { files: unknown[] } | null = null;

    while (!done) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const payload = JSON.parse(line.slice(6)) as {
            error?: { message?: string };
            text?: string;
            done?: boolean;
            files?: unknown[];
          };
          if (payload.error) throw new Error(payload.error.message || 'Split failed');
          if (payload.text) output.textContent += payload.text;
          if (payload.done) {
            result = payload as { files: unknown[] };
            done = true;
          }
        } catch (parseErr) {
          if ((parseErr as Error).message !== 'Split failed') continue;
          throw parseErr;
        }
      }
    }

    if (result) {
      status.className = 'split-modal-status show success';
      status.textContent = `Created ${result.files.length} stories. Original deleted.`;
      btn.textContent = 'Done';
      setTimeout(() => closeSplitModal(), 2000);
    }
  } catch (err) {
    status.className = 'split-modal-status show error';
    status.textContent = getErrorMessage(err, 'Split failed');
    btn.disabled = false;
    btn.textContent = 'Retry';
  }
}
