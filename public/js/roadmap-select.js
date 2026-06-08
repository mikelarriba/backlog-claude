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

let _rmSelectedItems = new Set(); // "docType:filename" keys
let _rmLastClicked = null; // { filename, docType, panel: 'story'|'epic' }

function _rmKey(filename, docType) {
  return `${docType}:${filename}`;
}

function _getVisibleStoryCards() {
  return [...document.querySelectorAll('.roadmap-card[data-filename]')].filter(
    (c) => c.dataset.filename
  );
}

function _getVisibleEpicCards() {
  return [...document.querySelectorAll('.rm-epic-card[data-filename]')].filter(
    (c) => c.dataset.filename && c.style.display !== 'none'
  );
}

export function clearRoadmapSelection() {
  _rmSelectedItems.clear();
  _rmLastClicked = null;
  syncRoadmapSelectionUI();
}

export function syncRoadmapSelectionUI() {
  document
    .querySelectorAll('.roadmap-card[data-filename], .rm-epic-card[data-filename]')
    .forEach((el) => {
      if (!el.dataset.filename) return;
      const key = _rmKey(el.dataset.filename, el.dataset.doctype);
      el.classList.toggle('rm-multi-selected', _rmSelectedItems.has(key));
    });
  _rmUpdateSelectionBadge();
}

function _rmUpdateSelectionBadge() {
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

export function handleRoadmapCardClick(e, filename, docType) {
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
    const lastIdx = cards.findIndex((c) => c.dataset.filename === _rmLastClicked.filename);
    const curIdx = cards.findIndex((c) => c.dataset.filename === filename);
    if (lastIdx >= 0 && curIdx >= 0) {
      const start = Math.min(lastIdx, curIdx);
      const end = Math.max(lastIdx, curIdx);
      for (let i = start; i <= end; i++) {
        _rmSelectedItems.add(_rmKey(cards[i].dataset.filename, cards[i].dataset.doctype));
      }
    } else if (curIdx >= 0) {
      _rmSelectedItems.add(key);
    }
    _rmLastClicked = { filename, docType, panel: 'story' };
    syncRoadmapSelectionUI();
    return;
  }

  // Plain click: clear selection and open the doc
  if (_rmSelectedItems.size > 0) {
    clearRoadmapSelection();
  }
  openDoc(filename, docType);
}

export function handleRoadmapEpicClick(e, filename, docType) {
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
    const lastIdx = cards.findIndex((c) => c.dataset.filename === _rmLastClicked.filename);
    const curIdx = cards.findIndex((c) => c.dataset.filename === filename);
    if (lastIdx >= 0 && curIdx >= 0) {
      const start = Math.min(lastIdx, curIdx);
      const end = Math.max(lastIdx, curIdx);
      for (let i = start; i <= end; i++) {
        _rmSelectedItems.add(_rmKey(cards[i].dataset.filename, cards[i].dataset.doctype));
      }
    } else if (curIdx >= 0) {
      _rmSelectedItems.add(key);
    }
    _rmLastClicked = { filename, docType, panel: 'epic' };
    syncRoadmapSelectionUI();
    return;
  }

  // Plain click: clear selection and use the default focus-toggle behaviour
  if (_rmSelectedItems.size > 0) {
    clearRoadmapSelection();
  }
  focusEpic(filename);
}
