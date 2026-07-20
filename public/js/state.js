// ── Shared State ─────────────────────────────────────────────────────────────
// ES module: all shared state and utilities. Imported by every other module.
// Frontend type definitions mirror src/shared/types.ts (backend canonical copy).
// allDocs and piSettings mutations route through store.ts for domain events.
// Re-export event-driven store API so callers can import from state.js
export { getState, on, setDocs, upsertDoc, removeDoc, setPiSettings } from './store.js';
import {
  setDocs as _setDocs,
  setPiSettings as _setPiSettings,
  getState as _getState,
} from './store.js';
// ── Global state ──────────────────────────────────────────────────────────────
// Plain window globals (declared as ambient `var`s in global.d.ts), read and
// written as bare identifiers throughout public/ts/. Previously each of these
// was wired through a generic key/value store with a subscribe() API via
// Object.defineProperty, but nothing ever called store.subscribe() on any of
// them — the indirection added a layer to trace through with no behavior
// riding on it. allDocs and piSettings keep their real reactive wiring below
// since store.ts's docs/piSettings pub-sub does have real subscribers.
Object.defineProperty(window, 'allDocs', {
  get: () => _getState().docs,
  set: (docs) => {
    _setDocs(docs);
  },
  configurable: true,
  enumerable: true,
});
Object.defineProperty(window, 'piSettings', {
  get: () => _getState().piSettings,
  set: (settings) => {
    _setPiSettings(settings);
  },
  configurable: true,
  enumerable: true,
});
globalThis.jiraBase = '';
globalThis.currentFilename = null;
globalThis.currentDocType = null;
globalThis.activeTypeFilter = 'all';
globalThis.activeStatusFilter = 'all';
globalThis.activeTeamFilter = 'all';
globalThis.activeWorkCatFilter = 'all';
globalThis.currentJiraId = null;
globalThis._justDragged = false;
globalThis._quickCreateType = null;
globalThis._toastTimer = null;
globalThis.selectedItems = new Set();
globalThis._lastClickedItem = null;
globalThis.jiraSearchResults = [];
globalThis.sprintConfig = {};
globalThis.splitThreshold = 8;
globalThis._metaTeams = [];
globalThis._metaWorkCategories = [];
// List-level state (moved here from list.js so all state is centralised)
globalThis.jiraVersions = [];
globalThis._swimlanesCollapsed = {
  currentPi: false,
  nextPi: false,
  backlog: false,
};
globalThis._collapsedItems = new Set();
// Piconfig-level state referenced from HTML onclick
globalThis._piConfigActivePi = null;
// Refine cluster state (shared across refine.js and refine-*.js)
globalThis._canvasEpicFilename = null;
globalThis._canvasDocType = null;
globalThis._canvasManageLinks = false;
globalThis._canvasSelectedCards = new Set();
globalThis._activePanelState = {
  stories: [],
  layout: {},
  blocks: [],
  parallel: [],
};
globalThis._panelStates = new Map();
// Roadmap state (shared with export.js)
globalThis._roadmapVisiblePis = new Set();
// ── Shared constants ──────────────────────────────────────────────────────────
export const TYPE_LABEL = {
  epic: 'Epic',
  story: 'Story',
  spike: 'Spike',
  feature: 'Feature',
  bug: 'Bug',
};
export const STATUS_LABEL = {
  Draft: 'Draft',
  'Created in JIRA': 'In JIRA',
  Archived: 'Archived',
};
export const DRAG_TARGETS = {
  epic: ['feature'],
  story: ['epic'],
  spike: ['epic'],
  bug: ['epic'],
};
export const SECTION_LABELS = {
  currentPi: 'Current PI',
  nextPi: 'Next PI',
  backlog: 'Backlog',
};
// ── Shared helpers ────────────────────────────────────────────────────────────
export function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
export function getErrorMessage(errorValue, fallback = 'Request failed') {
  if (!errorValue) return fallback;
  if (typeof errorValue === 'string') return errorValue;
  if (typeof errorValue === 'object' && errorValue !== null && 'message' in errorValue) {
    return String(errorValue.message);
  }
  return fallback;
}
export function stripFrontmatter(content) {
  return content.replace(/^---[\s\S]*?---\n?/, '').trim();
}
// ── Safe markdown rendering (XSS-safe) ───────────────────────────────────────
// Always route marked.parse() through DOMPurify.sanitize() before writing to
// innerHTML — prevents stored XSS from JIRA-imported or AI-generated content.
export function renderMarkdown(md) {
  const raw = marked.parse(md);
  return DOMPurify.sanitize(raw);
}
export function setStatus(type, message) {
  const el = document.getElementById('status');
  if (!el) return;
  el.className = `status ${type === 'hidden' ? '' : type + ' show'}`;
  if (type === 'loading') {
    el.innerHTML = `<div class="spinner"></div><span>${message}</span>`;
  } else {
    el.textContent = message || '';
  }
}
export function setBtnState(loading) {
  const btn = document.getElementById('generate-btn');
  const label = document.getElementById('btn-label');
  if (btn) btn.disabled = loading;
  if (label) label.textContent = loading ? 'Generating…' : 'Generate';
}
export function showJiraToast(type, message) {
  const el = document.getElementById('jira-push-toast');
  if (!el) return;
  el.className = `show ${type}`;
  el.textContent = message;
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.className = '';
  }, 4000);
}
export function setJiraStatus(type, message) {
  const el = document.getElementById('jira-status');
  if (!el) return;
  el.className = `jira-status${type !== 'hidden' ? ' show ' + type : ''}`;
  el.textContent = message || '';
}
// ── Shared JSON fetch helpers ─────────────────────────────────────────────────
export async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, opts);
  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const errData = data;
    throw new Error(getErrorMessage(errData?.error, `Request failed (${res.status})`));
  }
  return data;
}
export async function postJSON(url, body) {
  return fetchJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
export async function patchJSON(url, body) {
  return fetchJSON(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
export async function putJSON(url, body) {
  return fetchJSON(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
export async function deleteJSON(url) {
  return fetchJSON(url, { method: 'DELETE' });
}
export async function streamSSE(url, body, { onText, onDone, onError, onProgress }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const payload = JSON.parse(line.slice(6));
        if (payload.error) throw new Error(getErrorMessage(payload.error, 'Request failed'));
        if (payload.text && onText) onText(payload.text);
        if (payload.progress && onProgress) onProgress(payload.progress);
        if (payload.done && onDone) onDone(payload);
      } catch (e) {
        if (e instanceof Error && e.message.includes('Unexpected token')) continue;
        if (onError) onError(e instanceof Error ? e : new Error(String(e)));
        else throw e;
      }
    }
  }
}
// ── Shared modal helpers ──────────────────────────────────────────────────────
export function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('show');
}
export function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('show');
}
// ── Shared section toggle ─────────────────────────────────────────────────────
export function toggleSection(bodyId, chevronId, rotateDeg = 90) {
  const body = document.getElementById(bodyId);
  const chevron = document.getElementById(chevronId);
  if (!body || !chevron) return;
  const isOpen = body.classList.toggle('open');
  chevron.style.transform = isOpen ? `rotate(${rotateDeg}deg)` : '';
}
// ── Debounce utility ──────────────────────────────────────────────────────────
export function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
// ── Cascade helpers for swimlane drag-drop ────────────────────────────────────
export function buildChildrenMap(docs) {
  const map = new Map();
  for (const d of docs) {
    if (d.parentFilename) {
      if (!map.has(d.parentFilename)) map.set(d.parentFilename, []);
      map.get(d.parentFilename).push(d);
    }
  }
  return map;
}
export function getDescendants(filename, childrenMap) {
  const result = [];
  const children = childrenMap.get(filename) || [];
  for (const child of children) {
    result.push(child);
    result.push(...getDescendants(child.filename, childrenMap));
  }
  return result;
}
//# sourceMappingURL=state.js.map
