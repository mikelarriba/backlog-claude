// ── Pure line-diff algorithm + HTML rendering ─────────────────────────────────
// LCS-based line diff, extracted from documentation.ts (#458) so it can be
// unit-tested in isolation without DOM mocking, and reused by future
// diff-related features. No DOM/browser APIs beyond escHtml — pure functions.
import { escHtml } from './state.js';
// Above this many (line-count-a * line-count-b) LCS table cells, the O(n*m)
// dynamic-programming table would be too large/slow to compute — fall back to
// a plain remove-all/add-all diff instead.
const LCS_CELL_LIMIT = 250000;
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
export function renderDiffLinesHtml(lines) {
  if (!lines.length) return '<div class="doc-diff-empty">No content to compare.</div>';
  return lines
    .map((line) => {
      const cls =
        line.type === 'add' ? 'diff-add' : line.type === 'remove' ? 'diff-remove' : 'diff-context';
      const marker = line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' ';
      return `<div class="diff-line ${cls}"><span class="diff-marker">${marker}</span><span class="diff-text">${escHtml(line.text)}</span></div>`;
    })
    .join('');
}
//# sourceMappingURL=lineDiff.js.map
