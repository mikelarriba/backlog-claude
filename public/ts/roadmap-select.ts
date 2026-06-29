// ── Roadmap multi-select ──────────────────────────────────────
// Cmd+Click: toggle individual items in/out of selection
// Shift+Click: range-select from last selected item to clicked item
// Plain click: clear selection, then perform default action
//   (openDoc for story cards, focusEpic for epic cards)
//
// Selection is panel-aware for Shift+Click range (story cards range
// within the flat DOM order across all sprint columns; epic cards
// range within the visible epic list). Cmd+Click can freely mix
// items from both panels into the same selection set.

interface LastClicked {
  filename: string;
  docType: string;
  panel: 'story' | 'epic';
}

let _rmSelectedItems = new Set<string>(); // "docType:filename" keys
let _rmLastClicked: LastClicked | null = null;

function _rmKey(filename: string, docType: string): string {
  return `${docType}:${filename}`;
}

function _getVisibleStoryCards(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.roadmap-card[data-filename]')].filter(
    (c) => c.dataset['filename']
  );
}

function _getVisibleEpicCards(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.rm-epic-card[data-filename]')].filter(
    (c) => c.dataset['filename'] && c.style.display !== 'none'
  );
}

export function clearRoadmapSelection(): void {
  _rmSelectedItems.clear();
  _rmLastClicked = null;
  syncRoadmapSelectionUI();
}

export function syncRoadmapSelectionUI(): void {
  document
    .querySelectorAll<HTMLElement>('.roadmap-card[data-filename], .rm-epic-card[data-filename]')
    .forEach((el) => {
      if (!el.dataset['filename']) return;
      const key = _rmKey(el.dataset['filename'], el.dataset['doctype'] ?? '');
      el.classList.toggle('rm-multi-selected', _rmSelectedItems.has(key));
    });
  _rmUpdateSelectionBadge();
}

function _rmUpdateSelectionBadge(): void {
  const badge = document.getElementById('rm-selection-badge');
  if (!badge) return;
  const count = _rmSelectedItems.size;
  if (count > 0) {
    badge.textContent = `${count} selected`;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

export function handleRoadmapCardClick(e: MouseEvent, filename: string, docType: string): void {
  const key = _rmKey(filename, docType);
  const isMeta = e.metaKey || e.ctrlKey;
  const isShift = e.shiftKey;

  if (isMeta) {
    e.preventDefault();
    e.stopPropagation();
    if (_rmSelectedItems.has(key)) {
      _rmSelectedItems.delete(key);
    } else {
      _rmSelectedItems.add(key);
    }
    _rmLastClicked = { filename, docType, panel: 'story' };
    syncRoadmapSelectionUI();
    return;
  }

  if (isShift && _rmLastClicked) {
    e.preventDefault();
    e.stopPropagation();
    const cards = _getVisibleStoryCards();
    const lastIdx = cards.findIndex((c) => c.dataset['filename'] === _rmLastClicked!.filename);
    const curIdx = cards.findIndex((c) => c.dataset['filename'] === filename);
    if (lastIdx >= 0 && curIdx >= 0) {
      const start = Math.min(lastIdx, curIdx);
      const end = Math.max(lastIdx, curIdx);
      for (let i = start; i <= end; i++) {
        _rmSelectedItems.add(_rmKey(cards[i].dataset['filename']!, cards[i].dataset['doctype']!));
      }
    } else if (curIdx >= 0) {
      _rmSelectedItems.add(key);
    }
    _rmLastClicked = { filename, docType, panel: 'story' };
    syncRoadmapSelectionUI();
    return;
  }

  if (_rmSelectedItems.size > 0) {
    clearRoadmapSelection();
  }
  openDoc(filename, docType);
}

export function handleRoadmapEpicClick(e: MouseEvent, filename: string, docType: string): void {
  const key = _rmKey(filename, docType);
  const isMeta = e.metaKey || e.ctrlKey;
  const isShift = e.shiftKey;

  if (isMeta) {
    e.preventDefault();
    e.stopPropagation();
    if (_rmSelectedItems.has(key)) {
      _rmSelectedItems.delete(key);
    } else {
      _rmSelectedItems.add(key);
    }
    _rmLastClicked = { filename, docType, panel: 'epic' };
    syncRoadmapSelectionUI();
    return;
  }

  if (isShift && _rmLastClicked) {
    e.preventDefault();
    e.stopPropagation();
    const cards = _getVisibleEpicCards();
    const lastIdx = cards.findIndex((c) => c.dataset['filename'] === _rmLastClicked!.filename);
    const curIdx = cards.findIndex((c) => c.dataset['filename'] === filename);
    if (lastIdx >= 0 && curIdx >= 0) {
      const start = Math.min(lastIdx, curIdx);
      const end = Math.max(lastIdx, curIdx);
      for (let i = start; i <= end; i++) {
        _rmSelectedItems.add(_rmKey(cards[i].dataset['filename']!, cards[i].dataset['doctype']!));
      }
    } else if (curIdx >= 0) {
      _rmSelectedItems.add(key);
    }
    _rmLastClicked = { filename, docType, panel: 'epic' };
    syncRoadmapSelectionUI();
    return;
  }

  if (_rmSelectedItems.size > 0) {
    clearRoadmapSelection();
  }
  focusEpic(filename);
}
