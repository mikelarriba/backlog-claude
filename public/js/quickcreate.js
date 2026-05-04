// ── Save Draft (no AI) ────────────────────────────────────────
async function saveDraft() {
  const title = document.getElementById('doc-title').value.trim();
  const idea  = document.getElementById('idea').value.trim();

  if (!title) {
    document.getElementById('doc-title').focus();
    setStatus('error', '❌ A title is required to save a draft');
    return;
  }

  const type     = document.getElementById('doc-type').value;
  const priority = document.getElementById('priority').value;

  const btn = document.getElementById('draft-btn');
  btn.disabled    = true;
  btn.textContent = 'Saving…';
  setStatus('loading', 'Saving draft…');

  try {
    const res = await fetch('/api/docs/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, idea, type, priority }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(getErrorMessage(data.error, 'Save failed'));

    clearForm();
    setStatus('success', `✅ Draft saved: ${data.filename}`);
    await loadDocs();
    openDoc(data.filename, data.docType);
  } catch (e) {
    setStatus('error', `❌ ${e.message}`);
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Save Draft';
  }
}

// ── Generate Doc (left panel form) ────────────────────────────
async function generateDoc() {
  const title = document.getElementById('doc-title').value.trim();
  const idea  = document.getElementById('idea').value.trim();
  // AI generate needs at least some content to work from
  const prompt = idea || title;
  if (!prompt) {
    document.getElementById('doc-title').focus();
    setStatus('error', '❌ Add a title or notes so Claude has something to work with');
    return;
  }
  const priority = document.getElementById('priority').value;
  const type     = document.getElementById('doc-type').value;

  setStatus('loading', `Claude is writing your ${TYPE_LABEL[type]}…`);
  setBtnState(true);

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idea: prompt, title, priority, type })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(getErrorMessage(data.error, 'Request failed'));

    clearForm();
    setStatus('success', `✅ ${TYPE_LABEL[type]} created: ${data.filename}`);
    await loadDocs();
    openDoc(data.filename, data.docType);
  } catch (e) {
    setStatus('error', `❌ ${e.message}`);
  } finally {
    setBtnState(false);
  }
}

function clearForm() {
  document.getElementById('idea').value = '';
  document.getElementById('doc-title').value = '';
  document.getElementById('doc-type').value = 'epic';
  document.getElementById('priority').value = 'Medium';
  setStatus('hidden');
}

// ── Quick Create (Story / Spike / Epic from detail view) ───────
function toggleQuickCreate(type) {
  const panel = document.getElementById('quick-create-panel');
  if (panel.classList.contains('open') && _quickCreateType === type) {
    closeQuickCreate();
    return;
  }
  _quickCreateType = type;
  panel.setAttribute('data-type', type);
  const labels = { epic: '＋ Create Epic', story: '＋ Create Story', spike: '＋ Create Spike', bug: '＋ Create Bug' };
  const placeholders = {
    epic:  'Describe the epic — what capability should this deliver?…',
    story: 'Describe the story — what should the user be able to do?…',
    spike: 'Describe the research question or technical unknown to investigate…',
    bug:   'Describe the bug — what is broken, how to reproduce it, and what the expected behaviour is…',
  };
  document.getElementById('quick-create-label').textContent = labels[type] || `＋ Create ${type}`;
  document.getElementById('quick-create-idea').placeholder  = placeholders[type] || '';
  panel.classList.add('open');
  document.getElementById('quick-create-title-input').focus();
}

function closeQuickCreate() {
  const panel = document.getElementById('quick-create-panel');
  if (panel) panel.classList.remove('open');
  const titleInput = document.getElementById('quick-create-title-input');
  const ideaInput  = document.getElementById('quick-create-idea');
  const stream     = document.getElementById('quick-create-stream');
  const btn        = document.getElementById('quick-run-btn');
  if (titleInput) titleInput.value = '';
  if (ideaInput)  ideaInput.value = '';
  if (stream)     { stream.style.display = 'none'; stream.textContent = ''; }
  if (btn)        { btn.disabled = false; btn.textContent = 'Generate'; }
  _quickCreateType = null;
}

async function executeQuickCreate() {
  if (!_quickCreateType) return;
  const idea = document.getElementById('quick-create-idea').value.trim();
  if (!idea) { document.getElementById('quick-create-idea').focus(); return; }

  const title  = document.getElementById('quick-create-title-input').value.trim();
  const type   = _quickCreateType;
  const btn    = document.getElementById('quick-run-btn');
  const stream = document.getElementById('quick-create-stream');

  btn.disabled = true;
  btn.textContent = '⏳ Generating…';
  stream.textContent = '';
  stream.style.display = 'block';

  try {
    const body = { idea, title, type, priority: 'Medium' };
    // Pass parentFeature when creating an Epic from within a Feature view
    if (type === 'epic' && currentDocType === 'feature' && currentFilename) {
      body.parentFeature = currentFilename;
    }
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(getErrorMessage(data.error, 'Generation failed'));

    closeQuickCreate();
    await loadDocs();
    if (type === 'epic' && currentDocType === 'feature' && currentFilename) {
      loadHierarchy(currentFilename, 'feature');
    }
    showJiraToast('success', `✅ ${TYPE_LABEL[type]} created: ${data.filename}`);
  } catch (e) {
    stream.textContent += `\n\n❌ ${e.message}`;
    btn.disabled = false;
    btn.textContent = 'Generate';
  }
}
