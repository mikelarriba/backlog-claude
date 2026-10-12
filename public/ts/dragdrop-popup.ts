// ── Drag-and-drop: drop action popup (link / dependency) ─────────────────────
// Split out of dragdrop.ts (#699). Owns the popup DOM and the link/dep requests.
import { postJSON, showJiraToast, DRAG_TARGETS } from './state.js';
import type { DocEntry } from './state.js';
import { loadHierarchy } from './detail-links.js';
import { clearSelection, itemKey, getSelectedDocs, applyFilters } from './list-filters.js';
import { computeDropPopupPosition } from './dragdrop-core.js';

// ── Drop action popup ─────────────────────────────────────────
interface DropRef {
  filename: string;
  docType: string;
}

let _dropPopup: HTMLElement | null = null;
let _pendingDropSrc: DropRef | null = null;
let _pendingDropTgt: DropRef | null = null;
let _escListener: ((e: KeyboardEvent) => void) | null = null;

// Pure: which drop actions (link-as-parent / add-dependency) are available
// for a dragged item over a target, and the target title truncated to fit
// the popup's subtitle. Returns canLink: false, canDep: false when neither
// action applies (the popup should not be shown).
export function computeDropActionOptions(
  srcFilename: string,
  srcDocType: string,
  tgtFilename: string,
  tgtDocType: string,
  tgtTitle: string
): { canLink: boolean; canDep: boolean; displayTitle: string } {
  const canLink = (DRAG_TARGETS[srcDocType] || []).includes(tgtDocType);
  const canDep = srcFilename !== tgtFilename && !canLink;
  const displayTitle = tgtTitle.length > 40 ? tgtTitle.slice(0, 38) + '…' : tgtTitle;
  return { canLink, canDep, displayTitle };
}

export function showDropActionPopup(
  srcFilename: string,
  srcDocType: string,
  targetEl: HTMLElement,
  cursorX: number,
  cursorY: number
): void {
  hideDropActionPopup();

  const tgtFilename = targetEl.dataset.filename as string;
  const tgtDocType = targetEl.dataset.doctype as string;
  const tgtTitle =
    targetEl.querySelector('.epic-title-text')?.textContent ||
    targetEl.querySelector('.roadmap-card-title')?.textContent ||
    tgtFilename;

  const { canLink, canDep, displayTitle } = computeDropActionOptions(
    srcFilename,
    srcDocType,
    tgtFilename,
    tgtDocType,
    tgtTitle
  );

  if (!canLink && !canDep) return; // nothing to offer

  _pendingDropSrc = { filename: srcFilename, docType: srcDocType };
  _pendingDropTgt = { filename: tgtFilename, docType: tgtDocType };

  const popup = document.createElement('div');
  popup.className = 'drop-action-popup';

  // Subtitle — target item title
  const subtitle = document.createElement('div');
  subtitle.className = 'drop-action-popup-title';
  subtitle.textContent = displayTitle;
  popup.appendChild(subtitle);

  if (canLink) {
    const btn = document.createElement('button');
    btn.className = 'drop-action-btn drop-link-btn';
    btn.innerHTML = '<span class="drop-action-btn-icon">🔗</span><span>Link as parent</span>';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      executeDropLink();
    });
    popup.appendChild(btn);
  }

  if (canDep) {
    const btn = document.createElement('button');
    btn.className = 'drop-action-btn drop-dep-btn';
    btn.innerHTML = '<span class="drop-action-btn-icon">🔒</span><span>Add dependency</span>';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      executeDropDep();
    });
    popup.appendChild(btn);
  }

  document.body.appendChild(popup);
  _dropPopup = popup;

  // Position near cursor, clamped to viewport
  const pw = popup.offsetWidth || 220;
  const ph = popup.offsetHeight || 90;
  const { left, top } = computeDropPopupPosition(
    cursorX,
    cursorY,
    pw,
    ph,
    window.innerWidth,
    window.innerHeight
  );
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;

  // Dismiss on outside click
  setTimeout(() => {
    document.addEventListener('click', hideDropActionPopup, { once: true });
  }, 0);

  // Dismiss on Escape
  _escListener = (e: KeyboardEvent) => {
    if (e.key === 'Escape') hideDropActionPopup();
  };
  document.addEventListener('keydown', _escListener);
}

export function hideDropActionPopup(): void {
  if (_dropPopup) {
    _dropPopup.remove();
    _dropPopup = null;
  }
  if (_escListener) {
    document.removeEventListener('keydown', _escListener);
    _escListener = null;
  }
  _pendingDropSrc = null;
  _pendingDropTgt = null;
}

async function executeDropLink(): Promise<void> {
  if (!_pendingDropSrc || !_pendingDropTgt) return;
  const src = _pendingDropSrc;
  const tgt = _pendingDropTgt;
  hideDropActionPopup();

  const tgtEl = document.querySelector(`#epic-list [data-filename="${CSS.escape(tgt.filename)}"]`);
  const tgtTitle = tgtEl?.querySelector('.epic-title-text')?.textContent || tgt.filename;
  const dragDocs = getDragDocs(src.filename, src.docType);

  try {
    let linked = 0;
    for (const d of dragDocs) {
      const valid = DRAG_TARGETS[d.docType] || [];
      if (!valid.includes(tgt.docType)) continue;
      await postJSON('/api/link', {
        sourceType: d.docType,
        sourceFilename: d.filename,
        targetType: tgt.docType,
        targetFilename: tgt.filename,
      });
      linked++;
    }
    const msg = linked > 1 ? `Linked ${linked} items to "${tgtTitle}"` : `Linked to "${tgtTitle}"`;
    showJiraToast('success', msg);
    clearSelection();
    if (currentFilename === src.filename || currentFilename === tgt.filename) {
      loadHierarchy(currentFilename as string, currentDocType as string);
    }
  } catch (err) {
    showJiraToast('error', (err as Error).message);
  }
}

async function executeDropDep(): Promise<void> {
  if (!_pendingDropSrc || !_pendingDropTgt) return;
  const src = _pendingDropSrc;
  const tgt = _pendingDropTgt;
  hideDropActionPopup();

  const tgtEl = document.querySelector(`#epic-list [data-filename="${CSS.escape(tgt.filename)}"]`);
  const tgtTitle = tgtEl?.querySelector('.epic-title-text')?.textContent || tgt.filename;

  try {
    await postJSON('/api/link', {
      linkType: 'blocks',
      sourceType: src.docType,
      sourceFilename: src.filename,
      targetType: tgt.docType,
      targetFilename: tgt.filename,
    });
    // Update allDocs entries optimistically
    const srcDoc = allDocs.find((d) => d.filename === src.filename);
    if (srcDoc) {
      srcDoc.blocks = srcDoc.blocks || [];
      if (!srcDoc.blocks.includes(tgt.filename)) srcDoc.blocks.push(tgt.filename);
    }
    const tgtDoc = allDocs.find((d) => d.filename === tgt.filename);
    if (tgtDoc) {
      tgtDoc.blockedBy = tgtDoc.blockedBy || [];
      if (!tgtDoc.blockedBy.includes(src.filename)) tgtDoc.blockedBy.push(src.filename);
    }
    applyFilters();
    showJiraToast(
      'success',
      `"${allDocs.find((d) => d.filename === src.filename)?.title || src.filename}" now blocks "${tgtTitle}"`
    );
  } catch (err) {
    showJiraToast('error', (err as Error).message);
  }
}

// Returns whether the move actually happened (false on a missing-PI-version
// precondition failure or a request error) — used by the keyboard-operable
// alternative below so it only announces "Moved" via aria-live when the move
// really succeeded, instead of duplicating this function's own precondition

// Returns the docs being dragged — either the multi-selection or just the single item
export function getDragDocs(srcFilename: string, srcDocType: string): DocEntry[] {
  const key = itemKey(srcFilename, srcDocType);
  if (selectedItems.size > 1 && selectedItems.has(key)) {
    return getSelectedDocs();
  }
  const doc = allDocs.find((d) => d.filename === srcFilename && d.docType === srcDocType);
  return doc ? [doc] : [];
}
