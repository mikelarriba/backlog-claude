// ── Pure line-diff algorithm + HTML rendering ────────────────────────────────
// Extracted from documentation.ts (#458) so the diff algorithm can be unit
// tested without any DOM/browser dependency. This module touches no `window`,
// `document`, or other global — it is plain string/array manipulation, safe to
// import from a Node test file directly.
// Above this many (line-count-a × line-count-b) DP cells, computing the exact
// LCS-based diff would be too slow/memory-heavy — fall back to a plain
// remove-all/add-all diff instead.
const LCS_CELL_LIMIT = 250000;
// ── Core algorithm: LCS-based line diff ───────────────────────────────────────
export function computeLineDiff(current, proposed) {
  const a = current.split('\n');
  const b = proposed.split('\n');
  const n = a.length;
  const m = b.length;
  if (n * m > LCS_CELL_LIMIT) {
    return [
      ...a.map((text) => ({ type: 'remove', text })),
      ...b.map((text) => ({ type: 'add', text })),
    ];
  }
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lines = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ type: 'context', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ type: 'remove', text: a[i] });
      i++;
    } else {
      lines.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) {
    lines.push({ type: 'remove', text: a[i] });
    i++;
  }
  while (j < m) {
    lines.push({ type: 'add', text: b[j] });
    j++;
  }
  return lines;
}
// ── Suggestion → diff lines ───────────────────────────────────────────────────
export function diffLinesForSuggestion(s) {
  if (s.action === 'Create') {
    return (s.proposedContent || '').split('\n').map((text) => ({ type: 'add', text }));
  }
  if (s.action === 'Delete') {
    return (s.currentContent || '').split('\n').map((text) => ({ type: 'remove', text }));
  }
  return computeLineDiff(s.currentContent || '', s.proposedContent || '');
}
// ── HTML rendering ─────────────────────────────────────────────────────────────
// Local, dependency-free HTML escaper (deliberately not imported from state.ts,
// which has top-level `window`/`document` references — importing it would pull
// a DOM dependency back into this otherwise-pure module).
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
export function renderDiffHtml(s) {
  const lines = diffLinesForSuggestion(s);
  if (!lines.length) return '<div class="doc-diff-empty">No content to compare.</div>';
  return lines
    .map((line) => {
      const cls =
        line.type === 'add' ? 'diff-add' : line.type === 'remove' ? 'diff-remove' : 'diff-context';
      const marker = line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' ';
      return `<div class="diff-line ${cls}"><span class="diff-marker">${marker}</span><span class="diff-text">${escapeHtml(line.text)}</span></div>`;
    })
    .join('');
}
//# sourceMappingURL=lineDiff.js.map
