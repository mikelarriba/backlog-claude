// ── Shared State ───────────────────────────────────────────────
// All global state lives here. Other modules read/write these directly
// since all scripts share the same global scope (no ES modules).

var allDocs             = [];
var currentFilename     = null;
var currentDocType      = null;
var activeTypeFilter    = 'all';
var activeStatusFilter  = 'all';
var currentStoriesFilename = null;
var currentJiraId       = null;
var _justDragged        = false;
var _quickCreateType    = null;
var _toastTimer         = null;
var jiraSearchResults   = [];

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
