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

// ── Frontend type definitions ─────────────────────────────────────────────────
export interface DocEntry {
  filename: string;
  docType: string;
  title: string;
  date: string;
  status: string;
  fixVersion: string | null;
  jiraId: string | null;
  jiraUrl: string | null;
  storyPoints: number | null;
  sprint: string | null;
  rank: number | null;
  priority: string;
  parentFilename: string | null;
  parentType: string | null;
  blocks: string[];
  blockedBy: string[];
  parallel: string[];
  pi: string | null;
  team: string | null;
  workCategory: string | null;
  hasDescription: boolean;
  descriptionSnippet: string | null;
}

export interface PISettings {
  currentPi: string | null;
  nextPi: string | null;
}

export type SprintConfig = Record<string, unknown>;

export interface SwimlaneCollapsed {
  currentPi: boolean;
  nextPi: boolean;
  backlog: boolean;
}

export interface PanelState {
  stories: DocEntry[];
  layout: Record<string, unknown>;
  blocks: string[];
  parallel: string[];
}

// ── Reactive store ────────────────────────────────────────────────────────────
type StoreCallback = (value: unknown) => void;

interface Store {
  set(key: string, value: unknown): void;
  get(key: string): unknown;
  subscribe(key: string, fn: StoreCallback): () => void;
}

export const store: Store = (function () {
  const _state: Record<string, unknown> = {};
  const _listeners: Record<string, StoreCallback[]> = {};
  return {
    set(key: string, value: unknown): void {
      _state[key] = value;
      const fns = _listeners[key] || [];
      for (let i = 0; i < fns.length; i++) fns[i](value);
    },
    get(key: string): unknown {
      return _state[key];
    },
    subscribe(key: string, fn: StoreCallback): () => void {
      if (!_listeners[key]) _listeners[key] = [];
      _listeners[key].push(fn);
      return function () {
        _listeners[key] = _listeners[key].filter(function (f) {
          return f !== fn;
        });
      };
    },
  };
})();

// Declare a store-backed global variable. Code in other modules can read/write
// the named global (via the window object) and it routes through the store,
// enabling store.subscribe(key, fn) callbacks to fire on every write.
function _storeVar(name: string, initial: unknown): void {
  store.set(name, initial);
  Object.defineProperty(window, name, {
    get: function () {
      return store.get(name);
    },
    set: function (v: unknown) {
      store.set(name, v);
    },
    configurable: true,
    enumerable: true,
  });
}

// ── Store-backed global state ─────────────────────────────────────────────────
// allDocs and piSettings are backed by store.ts (event-driven), so any write
// via the window global also emits domain events (docs:changed / piSettings:changed).
Object.defineProperty(window, 'allDocs', {
  get: () => _getState().docs,
  set: (docs: DocEntry[]) => { _setDocs(docs); },
  configurable: true,
  enumerable: true,
});

Object.defineProperty(window, 'piSettings', {
  get: () => _getState().piSettings,
  set: (settings: PISettings) => { _setPiSettings(settings); },
  configurable: true,
  enumerable: true,
});

_storeVar('jiraBase', '');
_storeVar('currentFilename', null);
_storeVar('currentDocType', null);
_storeVar('activeTypeFilter', 'all');
_storeVar('activeStatusFilter', 'all');
_storeVar('activeTeamFilter', 'all');
_storeVar('activeWorkCatFilter', 'all');
_storeVar('currentJiraId', null);
_storeVar('_justDragged', false);
_storeVar('_quickCreateType', null);
_storeVar('_toastTimer', null);
_storeVar('selectedItems', new Set<string>());
_storeVar('_lastClickedItem', null);
_storeVar('jiraSearchResults', [] as DocEntry[]);
_storeVar('sprintConfig', {} as SprintConfig);
_storeVar('splitThreshold', 8);
_storeVar('_metaTeams', [] as string[]);
_storeVar('_metaWorkCategories', [] as string[]);
// List-level state (moved here from list.js so all state is centralised)
_storeVar('jiraVersions', [] as string[]);
_storeVar('_swimlanesCollapsed', { currentPi: false, nextPi: false, backlog: false } as SwimlaneCollapsed);
_storeVar('_collapsedItems', new Set<string>());
// Piconfig-level state referenced from HTML onclick
_storeVar('_piConfigActivePi', null);
// Refine cluster state (shared across refine.js and refine-*.js)
_storeVar('_canvasEpicFilename', null);
_storeVar('_canvasDocType', null);
_storeVar('_canvasManageLinks', false);
_storeVar('_canvasSelectedCards', new Set<string>());
_storeVar('_activePanelState', { stories: [], layout: {}, blocks: [], parallel: [] } as PanelState);
_storeVar('_panelStates', new Map<string, PanelState>());
// Roadmap state (shared with export.js)
_storeVar('_roadmapVisiblePis', new Set<string>());

// ── Shared constants ──────────────────────────────────────────────────────────
export const TYPE_LABEL: Record<string, string> = {
  epic: 'Epic',
  story: 'Story',
  spike: 'Spike',
  feature: 'Feature',
  bug: 'Bug',
};
export const STATUS_LABEL: Record<string, string> = {
  Draft: 'Draft',
  'Created in JIRA': 'In JIRA',
  Archived: 'Archived',
};
export const DRAG_TARGETS: Record<string, string[]> = {
  epic: ['feature'],
  story: ['epic'],
  spike: ['epic'],
  bug: ['epic'],
};
export const SECTION_LABELS: Record<string, string> = {
  currentPi: 'Current PI',
  nextPi: 'Next PI',
  backlog: 'Backlog',
};

// ── Shared helpers ────────────────────────────────────────────────────────────
export function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function getErrorMessage(errorValue: unknown, fallback = 'Request failed'): string {
  if (!errorValue) return fallback;
  if (typeof errorValue === 'string') return errorValue;
  if (typeof errorValue === 'object' && errorValue !== null && 'message' in errorValue) {
    return String((errorValue as { message: unknown }).message);
  }
  return fallback;
}

export function stripFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\n?/, '').trim();
}

export function setStatus(type: string, message?: string): void {
  const el = document.getElementById('status');
  if (!el) return;
  el.className = `status ${type === 'hidden' ? '' : type + ' show'}`;
  if (type === 'loading') {
    el.innerHTML = `<div class="spinner"></div><span>${message}</span>`;
  } else {
    el.textContent = message || '';
  }
}

export function setBtnState(loading: boolean): void {
  const btn = document.getElementById('generate-btn') as HTMLButtonElement | null;
  const label = document.getElementById('btn-label');
  if (btn) btn.disabled = loading;
  if (label) label.textContent = loading ? 'Generating…' : 'Generate';
}

export function showJiraToast(type: string, message: string): void {
  const el = document.getElementById('jira-push-toast');
  if (!el) return;
  el.className = `show ${type}`;
  el.textContent = message;
  if (_toastTimer) clearTimeout(_toastTimer as ReturnType<typeof setTimeout>);
  _toastTimer = setTimeout(() => {
    el.className = '';
  }, 4000);
}

export function setJiraStatus(type: string, message?: string): void {
  const el = document.getElementById('jira-status');
  if (!el) return;
  el.className = `jira-status${type !== 'hidden' ? ' show ' + type : ''}`;
  el.textContent = message || '';
}

// ── Shared JSON fetch helpers ─────────────────────────────────────────────────
export async function fetchJSON(url: string, opts: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, opts);
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const errData = data as { error?: unknown } | null;
    throw new Error(getErrorMessage(errData?.error, `Request failed (${res.status})`));
  }
  return data;
}

export async function postJSON(url: string, body: unknown): Promise<unknown> {
  return fetchJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function patchJSON(url: string, body: unknown): Promise<unknown> {
  return fetchJSON(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function putJSON(url: string, body: unknown): Promise<unknown> {
  return fetchJSON(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function deleteJSON(url: string): Promise<unknown> {
  return fetchJSON(url, { method: 'DELETE' });
}

// ── Shared streaming SSE fetch helper ─────────────────────────────────────────
export interface SSEStreamCallbacks {
  onText?: (text: string) => void;
  onDone?: (payload: Record<string, unknown>) => void;
  onError?: (e: Error) => void;
  onProgress?: (progress: string) => void;
}

interface SSEPayloadChunk {
  error?: unknown;
  text?: string;
  progress?: string;
  done?: boolean;
  [key: string]: unknown;
}

export async function streamSSE(
  url: string,
  body: unknown,
  { onText, onDone, onError, onProgress }: SSEStreamCallbacks
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const payload = JSON.parse(line.slice(6)) as SSEPayloadChunk;
        if (payload.error) throw new Error(getErrorMessage(payload.error, 'Request failed'));
        if (payload.text && onText) onText(payload.text);
        if (payload.progress && onProgress) onProgress(payload.progress);
        if (payload.done && onDone) onDone(payload as Record<string, unknown>);
      } catch (e) {
        if (e instanceof Error && e.message.includes('Unexpected token')) continue;
        if (onError) onError(e instanceof Error ? e : new Error(String(e)));
        else throw e;
      }
    }
  }
}

// ── Shared section toggle ─────────────────────────────────────────────────────
export function toggleSection(bodyId: string, chevronId: string, rotateDeg = 90): void {
  const body = document.getElementById(bodyId);
  const chevron = document.getElementById(chevronId);
  if (!body || !chevron) return;
  const isOpen = body.classList.toggle('open');
  chevron.style.transform = isOpen ? `rotate(${rotateDeg}deg)` : '';
}

// ── Debounce utility ──────────────────────────────────────────────────────────
export function debounce(fn: (...args: unknown[]) => void, ms: number): (...args: unknown[]) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return function (...args: unknown[]) {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ── Cascade helpers for swimlane drag-drop ────────────────────────────────────
export function buildChildrenMap(docs: DocEntry[]): Map<string, DocEntry[]> {
  const map = new Map<string, DocEntry[]>();
  for (const d of docs) {
    if (d.parentFilename) {
      if (!map.has(d.parentFilename)) map.set(d.parentFilename, []);
      map.get(d.parentFilename)!.push(d);
    }
  }
  return map;
}

export function getDescendants(filename: string, childrenMap: Map<string, DocEntry[]>): DocEntry[] {
  const result: DocEntry[] = [];
  const children = childrenMap.get(filename) || [];
  for (const child of children) {
    result.push(child);
    result.push(...getDescendants(child.filename, childrenMap));
  }
  return result;
}
