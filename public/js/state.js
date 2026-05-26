// ── Shared State ───────────────────────────────────────────────
// All global state lives here. Other modules read/write these directly
// since all scripts share the same global scope (no ES modules).

// ── Reactive store ─────────────────────────────────────────────
// Minimal pub/sub store. Modules can subscribe to state changes via
// store.subscribe(key, fn). All global state vars below are backed
// by this store via Object.defineProperty so existing code that reads
// or writes them directly transparently goes through the store.
var store = (function () {
  var _state = {};
  var _listeners = {};
  return {
    set: function (key, value) {
      _state[key] = value;
      var fns = _listeners[key] || [];
      for (var i = 0; i < fns.length; i++) fns[i](value);
    },
    get: function (key) { return _state[key]; },
    subscribe: function (key, fn) {
      if (!_listeners[key]) _listeners[key] = [];
      _listeners[key].push(fn);
      // returns an unsubscribe function
      return function () {
        _listeners[key] = _listeners[key].filter(function (f) { return f !== fn; });
      };
    },
  };
})();

// Declare a store-backed global variable.  Existing code that reads or writes
// the named global transparently routes through the store, enabling
// store.subscribe(key, fn) callbacks to fire on every write.
function _storeVar(name, initial) {
  store.set(name, initial);
  Object.defineProperty(window, name, {
    get: function () { return store.get(name); },
    set: function (v) { store.set(name, v); },
    configurable: true,
    enumerable: true,
  });
}

// ── Store-backed global state ──────────────────────────────────
_storeVar('allDocs',             []);
_storeVar('jiraBase',            '');
_storeVar('currentFilename',     null);
_storeVar('currentDocType',      null);
_storeVar('activeTypeFilter',    'all');
_storeVar('activeStatusFilter',  'all');
_storeVar('activeTeamFilter',    'all');
_storeVar('activeWorkCatFilter', 'all');
_storeVar('currentJiraId',       null);
_storeVar('_justDragged',        false);
_storeVar('_quickCreateType',    null);
_storeVar('_toastTimer',         null);
_storeVar('selectedItems',       new Set());
_storeVar('_lastClickedItem',    null);
_storeVar('jiraSearchResults',   []);
_storeVar('sprintConfig',        {});
_storeVar('splitThreshold',      8);

const TYPE_LABEL  = { epic: 'Epic', story: 'Story', spike: 'Spike', feature: 'Feature', bug: 'Bug' };
const STATUS_LABEL = { Draft: 'Draft', 'Created in JIRA': 'In JIRA', Archived: 'Archived' };
const DRAG_TARGETS = { epic: ['feature'], story: ['epic'], spike: ['epic'], bug: ['epic'] };

// ── Shared Helpers ─────────────────────────────────────────────
function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getErrorMessage(errorValue, fallback = 'Request failed') {
  if (!errorValue) return fallback;
  if (typeof errorValue === 'string') return errorValue;
  if (typeof errorValue === 'object' && errorValue.message) return errorValue.message;
  return fallback;
}

function stripFrontmatter(content) {
  return content.replace(/^---[\s\S]*?---\n?/, '').trim();
}

function setStatus(type, message) {
  const el = document.getElementById('status');
  el.className = `status ${type === 'hidden' ? '' : type + ' show'}`;
  if (type === 'loading') {
    el.innerHTML = `<div class="spinner"></div><span>${message}</span>`;
  } else {
    el.textContent = message || '';
  }
}

function setBtnState(loading) {
  const btn   = document.getElementById('generate-btn');
  const label = document.getElementById('btn-label');
  btn.disabled = loading;
  label.textContent = loading ? 'Generating…' : 'Generate';
}

function showJiraToast(type, message) {
  const el = document.getElementById('jira-push-toast');
  el.className = `show ${type}`;
  el.textContent = message;
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = ''; }, 4000);
}

function setJiraStatus(type, message) {
  const el = document.getElementById('jira-status');
  el.className = `jira-status${type !== 'hidden' ? ' show ' + type : ''}`;
  el.textContent = message || '';
}

// ── Shared JSON fetch helper ─────────────────────────────────
// Replaces the 50+ copy-paste try/fetch/res.json/!res.ok blocks.
// Returns parsed JSON on success; throws a descriptive Error on failure.
async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, opts);
  let data;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new Error(getErrorMessage(data?.error, `Request failed (${res.status})`));
  return data;
}

// POST/PUT/PATCH/DELETE convenience wrappers
async function postJSON(url, body) {
  return fetchJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function patchJSON(url, body) {
  return fetchJSON(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function putJSON(url, body) {
  return fetchJSON(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function deleteJSON(url) {
  return fetchJSON(url, { method: 'DELETE' });
}

// ── Shared streaming SSE fetch helper ─────────────────────────
// Replaces duplicated streaming logic in upgrade.js, stories.js,
// refine.js, and quickcreate.js.
async function streamSSE(url, body, { onText, onDone, onError, onProgress }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const reader  = res.body.getReader();
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
        if (e.message.includes('Unexpected token')) continue;
        if (onError) onError(e);
        else throw e;
      }
    }
  }
}

// ── Shared section toggle ─────────────────────────────────────
// Toggles a collapsible section: adds/removes 'open' on the body and
// rotates the chevron. rotateDeg: degrees when open (90 or 180).
function toggleSection(bodyId, chevronId, rotateDeg = 90) {
  const body    = document.getElementById(bodyId);
  const chevron = document.getElementById(chevronId);
  const isOpen  = body.classList.toggle('open');
  chevron.style.transform = isOpen ? `rotate(${rotateDeg}deg)` : '';
}

// ── Debounce utility ──────────────────────────────────────────
function debounce(fn, ms) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

// ── Cascade helpers for swimlane drag-drop ────────────────────
function buildChildrenMap(docs) {
  const map = new Map();
  for (const d of docs) {
    if (d.parentFilename) {
      if (!map.has(d.parentFilename)) map.set(d.parentFilename, []);
      map.get(d.parentFilename).push(d);
    }
  }
  return map;
}

function getDescendants(filename, childrenMap) {
  const result = [];
  const children = childrenMap.get(filename) || [];
  for (const child of children) {
    result.push(child);
    result.push(...getDescendants(child.filename, childrenMap));
  }
  return result;
}
