// ── Bug Report Creation (in-panel sub-view) ────────────────────
import { fetchJSON, escHtml, showJiraToast } from './state.js';
import { loadDocs } from './list.js';
import { openDoc } from './detail.js';
import { logAiSaving } from './ai-savings.js';

interface BugCreateResponse {
  filename: string;
  title: string;
}

let _bugFiles: File[] = [];

export function openBugForm(): void {
  _bugFiles = [];
  (document.getElementById('bug-id') as HTMLInputElement).value = '';
  (document.getElementById('bug-title') as HTMLInputElement).value = '';
  (document.getElementById('bug-description') as HTMLTextAreaElement).value = '';
  (document.getElementById('bug-team') as HTMLSelectElement).value = '';
  (document.getElementById('bug-work-category') as HTMLSelectElement).value = '';
  (document.getElementById('bug-files') as HTMLInputElement).value = '';
  (document.getElementById('bug-file-list') as HTMLElement).innerHTML = '';
  (document.getElementById('bug-dropzone-label') as HTMLElement).textContent =
    'Drop files here or click to browse';
  (document.getElementById('bug-submit-btn') as HTMLButtonElement).disabled = false;
  (document.getElementById('bug-submit-label') as HTMLElement).textContent = 'Create Bug';
  setBugStatus('hidden');
  document.getElementById('fab-view-main')!.classList.add('hidden');
  document.getElementById('fab-view-bug')!.classList.add('open');
  (document.getElementById('bug-id') as HTMLInputElement).focus();
}

export function closeBugForm(): void {
  document.getElementById('fab-view-bug')!.classList.remove('open');
  document.getElementById('fab-view-main')!.classList.remove('hidden');
  _bugFiles = [];
}

function setBugStatus(type: string, message?: string): void {
  const el = document.getElementById('bug-status');
  if (!el) return;
  el.className = `status ${type === 'hidden' ? '' : type + ' show'}`;
  el.textContent = message || '';
}

// ── File handling ─────────────────────────────────────────────
export function onBugFilesSelected(fileList: FileList): void {
  addBugFiles(Array.from(fileList));
}

export function addBugFiles(files: File[]): void {
  for (const file of files) {
    if (_bugFiles.length >= 5) break;
    if (_bugFiles.some((f) => f.name === file.name && f.size === file.size)) continue;
    _bugFiles.push(file);
  }
  renderBugFileList();
}

export function removeBugFile(index: number): void {
  _bugFiles.splice(index, 1);
  renderBugFileList();
}

export function renderBugFileList(): void {
  const el = document.getElementById('bug-file-list') as HTMLElement;
  if (!_bugFiles.length) {
    el.innerHTML = '';
    (document.getElementById('bug-dropzone-label') as HTMLElement).textContent =
      'Drop files here or click to browse';
    return;
  }
  (document.getElementById('bug-dropzone-label') as HTMLElement).textContent =
    `${_bugFiles.length}/5 file(s) selected — click to add more`;
  el.innerHTML = _bugFiles
    .map(
      (f, i) => `
    <div class="bug-file-item">
      <span class="bug-file-name" title="${escHtml(f.name)}">${escHtml(f.name)}</span>
      <span class="bug-file-size">${formatBytes(f.size)}</span>
      <button class="bug-file-remove" onclick="removeBugFile(${i})" title="Remove">&times;</button>
    </div>
  `
    )
    .join('');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── Drag & drop on dropzone ───────────────────────────────────
(function initBugDropzone() {
  document.addEventListener('DOMContentLoaded', () => {
    const dz = document.getElementById('bug-dropzone');
    if (!dz) return;
    dz.addEventListener('dragover', (e: Event) => {
      e.preventDefault();
      dz.classList.add('dragover');
    });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', (e: Event) => {
      e.preventDefault();
      dz.classList.remove('dragover');
      const dragEvent = e as DragEvent;
      if (dragEvent.dataTransfer?.files.length)
        addBugFiles(Array.from(dragEvent.dataTransfer.files));
    });
  });
})();

// ── Submit ────────────────────────────────────────────────────
export async function submitBugReport(): Promise<void> {
  const id = (document.getElementById('bug-id') as HTMLInputElement).value.trim();
  const title = (document.getElementById('bug-title') as HTMLInputElement).value.trim();
  const desc = (document.getElementById('bug-description') as HTMLTextAreaElement).value.trim();

  if (!id) {
    setBugStatus('error', '❌ An ID is required');
    (document.getElementById('bug-id') as HTMLInputElement).focus();
    return;
  }
  if (!title) {
    setBugStatus('error', '❌ A title is required');
    (document.getElementById('bug-title') as HTMLInputElement).focus();
    return;
  }

  setBugStatus('hidden');
  const btn = document.getElementById('bug-submit-btn') as HTMLButtonElement;
  const label = document.getElementById('bug-submit-label') as HTMLElement;
  btn.disabled = true;
  label.textContent = 'Creating…';

  try {
    const team = (document.getElementById('bug-team') as HTMLSelectElement).value;
    const workCategory = (document.getElementById('bug-work-category') as HTMLSelectElement).value;

    const formData = new FormData();
    formData.append('id', id);
    formData.append('title', title);
    formData.append('description', desc);
    if (team) formData.append('team', team);
    if (workCategory) formData.append('workCategory', workCategory);
    for (const file of _bugFiles) {
      formData.append('attachments', file);
    }

    const data = (await fetchJSON('/api/bugs/create', {
      method: 'POST',
      body: formData,
    })) as BugCreateResponse;

    closeBugForm();
    showJiraToast('success', `✅ Bug created: ${data.title}`);
    void logAiSaving('bug_create', 1);
    await loadDocs();
    openDoc(data.filename, 'bug');
  } catch (e) {
    showJiraToast('error', `❌ ${e instanceof Error ? e.message : String(e)}`);
    btn.disabled = false;
    label.textContent = 'Create Bug';
  }
}
