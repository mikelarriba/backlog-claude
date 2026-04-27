// ── Bug Report Creation Modal ─────────────────────────────────
var _bugFiles = [];

function openBugModal() {
  _bugFiles = [];
  document.getElementById('bug-id').value = '';
  document.getElementById('bug-title').value = '';
  document.getElementById('bug-description').value = '';
  document.getElementById('bug-files').value = '';
  document.getElementById('bug-file-list').innerHTML = '';
  document.getElementById('bug-dropzone-label').textContent = 'Drop files here or click to browse';
  document.getElementById('bug-submit-btn').disabled = false;
  document.getElementById('bug-submit-label').textContent = 'Create Bug';
  document.getElementById('bug-modal-overlay').classList.add('show');
  document.getElementById('bug-id').focus();
}

function closeBugModal() {
  document.getElementById('bug-modal-overlay').classList.remove('show');
  _bugFiles = [];
}

// ── File handling ─────────────────────────────────────────────
function onBugFilesSelected(fileList) {
  addBugFiles(Array.from(fileList));
}

function addBugFiles(files) {
  for (const file of files) {
    if (_bugFiles.length >= 5) break;
    if (_bugFiles.some(f => f.name === file.name && f.size === file.size)) continue;
    _bugFiles.push(file);
  }
  renderBugFileList();
}

function removeBugFile(index) {
  _bugFiles.splice(index, 1);
  renderBugFileList();
}

function renderBugFileList() {
  const el = document.getElementById('bug-file-list');
  if (!_bugFiles.length) {
    el.innerHTML = '';
    document.getElementById('bug-dropzone-label').textContent = 'Drop files here or click to browse';
    return;
  }
  document.getElementById('bug-dropzone-label').textContent = `${_bugFiles.length}/5 file(s) selected — click to add more`;
  el.innerHTML = _bugFiles.map((f, i) => `
    <div class="bug-file-item">
      <span class="bug-file-name" title="${escHtml(f.name)}">${escHtml(f.name)}</span>
      <span class="bug-file-size">${formatBytes(f.size)}</span>
      <button class="bug-file-remove" onclick="removeBugFile(${i})" title="Remove">&times;</button>
    </div>
  `).join('');
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── Drag & drop on dropzone ───────────────────────────────────
(function initBugDropzone() {
  document.addEventListener('DOMContentLoaded', () => {
    const dz = document.getElementById('bug-dropzone');
    if (!dz) return;
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', e => {
      e.preventDefault();
      dz.classList.remove('dragover');
      if (e.dataTransfer.files.length) addBugFiles(Array.from(e.dataTransfer.files));
    });
  });
})();

// ── Submit ────────────────────────────────────────────────────
async function submitBugReport() {
  const id   = document.getElementById('bug-id').value.trim();
  const title = document.getElementById('bug-title').value.trim();
  const desc  = document.getElementById('bug-description').value.trim();

  if (!id)    { document.getElementById('bug-id').focus(); return; }
  if (!title) { document.getElementById('bug-title').focus(); return; }

  const btn = document.getElementById('bug-submit-btn');
  const label = document.getElementById('bug-submit-label');
  btn.disabled = true;
  label.textContent = 'Creating…';

  try {
    const formData = new FormData();
    formData.append('id', id);
    formData.append('title', title);
    formData.append('description', desc);
    for (const file of _bugFiles) {
      formData.append('attachments', file);
    }

    const res = await fetch('/api/bugs/create', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(getErrorMessage(data.error, 'Bug creation failed'));

    closeBugModal();
    showJiraToast('success', `✅ Bug created: ${data.title}`);
    await loadDocs();
    openDoc(data.filename, 'bug');
  } catch (e) {
    showJiraToast('error', `❌ ${e.message}`);
    btn.disabled = false;
    label.textContent = 'Create Bug';
  }
}
