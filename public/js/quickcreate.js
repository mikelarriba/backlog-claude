// ── Save Draft (no AI) ────────────────────────────────────────
import { postJSON, setStatus, setBtnState, TYPE_LABEL, showJiraToast } from './state.js';
import { loadDocs } from './list.js';
import { openDoc } from './detail.js';
import { loadHierarchy } from './detail-links.js';
export async function saveDraft() {
  const title = document.getElementById('doc-title').value.trim();
  const idea = document.getElementById('idea').value.trim();
  if (!title) {
    document.getElementById('doc-title').focus();
    setStatus('error', '❌ A title is required to save a draft');
    return;
  }
  const type = document.getElementById('doc-type').value;
  const priority = document.getElementById('priority').value;
  const team = document.getElementById('team').value || undefined;
  const workCategory = document.getElementById('work-category').value || undefined;
  const btn = document.getElementById('draft-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  setStatus('loading', 'Saving draft…');
  try {
    const data = await postJSON('/api/docs/draft', {
      title,
      idea,
      type,
      priority,
      team,
      workCategory,
    });
    clearForm();
    setStatus('success', `✅ Draft saved: ${data.filename}`);
    await loadDocs();
    openDoc(data.filename, data.docType);
  } catch (e) {
    setStatus('error', `❌ ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Draft';
  }
}
// ── Generate Doc (left panel form) ────────────────────────────
export async function generateDoc() {
  const title = document.getElementById('doc-title').value.trim();
  const idea = document.getElementById('idea').value.trim();
  // AI generate needs at least some content to work from
  const prompt = idea || title;
  if (!prompt) {
    document.getElementById('doc-title').focus();
    setStatus('error', '❌ Add a title or notes so the AI has something to work with');
    return;
  }
  const priority = document.getElementById('priority').value;
  const type = document.getElementById('doc-type').value;
  const team = document.getElementById('team').value || undefined;
  const workCategory = document.getElementById('work-category').value || undefined;
  setStatus('loading', `AI is writing your ${TYPE_LABEL[type]}…`);
  setBtnState(true);
  try {
    const data = await postJSON('/api/generate', {
      idea: prompt,
      title,
      priority,
      type,
      team,
      workCategory,
    });
    clearForm();
    setStatus('success', `✅ ${TYPE_LABEL[type]} created: ${data.filename}`);
    await loadDocs();
    openDoc(data.filename, data.docType);
  } catch (e) {
    setStatus('error', `❌ ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    setBtnState(false);
  }
}
export function clearForm() {
  document.getElementById('idea').value = '';
  document.getElementById('doc-title').value = '';
  document.getElementById('doc-type').value = 'epic';
  document.getElementById('priority').value = 'Medium';
  document.getElementById('team').value = '';
  document.getElementById('work-category').value = '';
  setStatus('hidden');
}
// ── Quick Create generation progress (estimated, timer-based) ──
// `/api/generate` is a single blocking request that sends no progress events,
// so these steps advance on a timer purely to fill the wait. The bar is capped
// below 100% and never claims real completion: the final step holds until the
// response lands (success closes the panel; failure swaps in the error text).
const QUICK_CREATE_STEPS = [
  'Analyzing your idea',
  'Drafting COVE sections',
  'Writing acceptance criteria',
  'Finalizing',
];
const QUICK_CREATE_STEP_MS = 2600;
let _quickProgressTimer = null;
function renderQuickProgress(stream, type, activeIdx) {
  // Fill up to the active step, capped at 90% so the bar never claims
  // completion before the server actually returns.
  const pct = Math.min(90, Math.round(((activeIdx + 1) / (QUICK_CREATE_STEPS.length + 1)) * 100));
  const rows = QUICK_CREATE_STEPS.map((label, i) => {
    const state = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending';
    const icon = state === 'done' ? '✔' : state === 'active' ? '▸' : '·';
    return `<div class="qc-step ${state}"><span class="qc-step-icon">${icon}</span>${label}</div>`;
  }).join('');
  stream.innerHTML =
    `<div class="qc-progress-head">⏳ Generating ${TYPE_LABEL[type] || type}…</div>` +
    `<div class="qc-steps">${rows}</div>` +
    `<div class="qc-progress-bar"><div class="qc-progress-fill" style="width:${pct}%"></div></div>` +
    `<div class="qc-progress-note">~${pct}% · estimated</div>`;
}
function startQuickProgress(stream, type) {
  stopQuickProgress();
  let idx = 0;
  renderQuickProgress(stream, type, idx);
  _quickProgressTimer = setInterval(() => {
    // Hold on the final step until the request resolves — never tick past it.
    if (idx < QUICK_CREATE_STEPS.length - 1) {
      idx += 1;
      renderQuickProgress(stream, type, idx);
    }
  }, QUICK_CREATE_STEP_MS);
}
function stopQuickProgress() {
  if (_quickProgressTimer !== null) {
    clearInterval(_quickProgressTimer);
    _quickProgressTimer = null;
  }
}
// ── Quick Create (Story / Spike / Epic from detail view) ───────
export function toggleQuickCreate(type) {
  const panel = document.getElementById('quick-create-panel');
  if (panel.classList.contains('open') && _quickCreateType === type) {
    closeQuickCreate();
    return;
  }
  _quickCreateType = type;
  panel.setAttribute('data-type', type);
  const labels = {
    epic: '＋ Create Epic',
    story: '＋ Create Story',
    spike: '＋ Create Spike',
    bug: '＋ Create Bug',
  };
  const placeholders = {
    epic: 'Describe the epic — what capability should this deliver?…',
    story: 'Describe the story — what should the user be able to do?…',
    spike: 'Describe the research question or technical unknown to investigate…',
    bug: 'Describe the bug — what is broken, how to reproduce it, and what the expected behaviour is…',
  };
  document.getElementById('quick-create-label').textContent = labels[type] || `＋ Create ${type}`;
  document.getElementById('quick-create-idea').placeholder = placeholders[type] || '';
  panel.classList.add('open');
  document.getElementById('quick-create-title-input').focus();
}
export function closeQuickCreate() {
  stopQuickProgress();
  const panel = document.getElementById('quick-create-panel');
  if (panel) panel.classList.remove('open');
  const titleInput = document.getElementById('quick-create-title-input');
  const ideaInput = document.getElementById('quick-create-idea');
  const stream = document.getElementById('quick-create-stream');
  const btn = document.getElementById('quick-run-btn');
  if (titleInput) titleInput.value = '';
  if (ideaInput) ideaInput.value = '';
  if (stream) {
    stream.style.display = 'none';
    stream.textContent = '';
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Generate';
  }
  _quickCreateType = null;
}
export async function executeQuickCreate() {
  if (!_quickCreateType) return;
  const ideaInput = document.getElementById('quick-create-idea');
  const idea = ideaInput.value.trim();
  if (!idea) {
    ideaInput.focus();
    return;
  }
  const title = document.getElementById('quick-create-title-input').value.trim();
  const type = _quickCreateType;
  const btn = document.getElementById('quick-run-btn');
  const stream = document.getElementById('quick-create-stream');
  btn.disabled = true;
  btn.textContent = '⏳ Generating…';
  stream.style.display = 'block';
  startQuickProgress(stream, type);
  try {
    const body = { idea, title, type, priority: 'Medium' };
    // Inherit parent link and PI from the open doc
    if (type === 'epic' && currentDocType === 'feature' && currentFilename) {
      body.parentFeature = currentFilename;
    }
    if (['story', 'spike', 'bug'].includes(type) && currentDocType === 'epic' && currentFilename) {
      body.parentEpic = currentFilename;
      const parentDoc = allDocs.find((d) => d.filename === currentFilename && d.docType === 'epic');
      if (parentDoc?.fixVersion) body.fixVersion = parentDoc.fixVersion;
    }
    const data = await postJSON('/api/generate', body);
    stopQuickProgress();
    closeQuickCreate();
    await loadDocs();
    if (currentFilename && (currentDocType === 'feature' || currentDocType === 'epic')) {
      loadHierarchy(currentFilename, currentDocType);
    }
    showJiraToast('success', `✅ ${TYPE_LABEL[type]} created: ${data.filename}`);
  } catch (e) {
    stopQuickProgress();
    stream.textContent = `❌ ${e instanceof Error ? e.message : String(e)}`;
    btn.disabled = false;
    btn.textContent = 'Generate';
  }
}
//# sourceMappingURL=quickcreate.js.map
