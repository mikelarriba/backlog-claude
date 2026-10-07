// ── Split-panel mode (wide-viewport list + detail layout) ──────────
const SPLIT_MIN_WIDTH = 1280;
export function isSplitMode() {
  return document.querySelector('.right')?.classList.contains('split-mode') ?? false;
}
export function updateSplitMode() {
  const wide = window.innerWidth >= SPLIT_MIN_WIDTH;
  const right = document.querySelector('.right');
  if (!right) return;
  const wasOn = right.classList.contains('split-mode');
  if (wide === wasOn) return;
  right.classList.toggle('split-mode', wide);
  const _cf = currentFilename;
  const _cdt = currentDocType;
  if (!wide && _cf) {
    const listView = document.getElementById('list-view');
    if (listView) listView.style.display = 'none';
  } else if (wide && _cf) {
    const listView = document.getElementById('list-view');
    if (listView) listView.style.display = '';
    highlightSelectedItem(_cf, _cdt ?? '');
  }
}
export function highlightSelectedItem(filename, docType) {
  document
    .querySelectorAll('.epic-item, .roadmap-card')
    .forEach((el) => el.classList.remove('selected'));
  if (filename) {
    document
      .querySelector(
        `.epic-item[data-filename="${CSS.escape(filename)}"][data-doctype="${docType}"]`
      )
      ?.classList.add('selected');
    document
      .querySelector(
        `.roadmap-card[data-filename="${CSS.escape(filename)}"][data-doctype="${docType}"]`
      )
      ?.classList.add('selected');
  }
}
//# sourceMappingURL=split-mode.js.map
