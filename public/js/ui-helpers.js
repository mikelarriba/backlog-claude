// ── Shared small DOM interaction helpers ────────────────────────────────────
// Extracted from refine-nodes.ts / roadmap-context-menus.ts, which each
// independently positioned popups via `el.style.left/top = ...px`.
export function positionPopup(el, x, y) {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}
//# sourceMappingURL=ui-helpers.js.map
