// ── Save Draft (no AI) ────────────────────────────────────────
import { postJSON, setStatus, setBtnState, TYPE_LABEL, showJiraToast } from './state.js';
import { loadDocs } from './list.js';
import { openDoc } from './detail.js';
import { loadHierarchy } from './detail-links.js';

interface GenerateResponse {
  filename: string;
  docType: string;
}

export async function saveDraft(): Promise<void> {
  const title = (document.getElementById('doc-title') as HTMLInputElement).value.trim();
  const idea = (document.getElementById('idea') as HTMLTextAreaElement).value.trim();

  if (!title) {
    (document.getElementById('doc-title') as HTMLInputElement).focus();
    setStatus('error', '❌ A title is required to save a draft');
    return;
  }

  const type = (document.getElementById('doc-type') as HTMLSelectElement).value;
  const priority = (document.getElementById('priority') as HTMLSelectElement).value;
  const team = (document.getElementById('team') as HTMLSelectElement).value || undefined;
  const workCategory =
    (document.getElementById('work-category') as HTMLSelectElement).value || undefined;

  const btn = document.getElementById('draft-btn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Saving…';
  setStatus('loading', 'Saving draft…');

  try {
    const data = (await postJSON('/api/docs/draft', {
      title,
      idea,
      type,
      priority,
      team,
      workCategory,
    })) as GenerateResponse;

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
export async function generateDoc(): Promise<void> {
  const title = (document.getElementById('doc-title') as HTMLInputElement).value.trim();
  const idea = (document.getElementById('idea') as HTMLTextAreaElement).value.trim();
  // AI generate needs at least some content to work from
  const prompt = idea || title;
  if (!prompt) {
    (document.getElementById('doc-title') as HTMLInputElement).focus();
    setStatus('error', '❌ Add a title or notes so the AI has something to work with');
    return;
  }
  const priority = (document.getElementById('priority') as HTMLSelectElement).value;
  const type = (document.getElementById('doc-type') as HTMLSelectElement).value;
  const team = (document.getElementById('team') as HTMLSelectElement).value || undefined;
  const workCategory =
    (document.getElementById('work-category') as HTMLSelectElement).value || undefined;

  setStatus('loading', `AI is writing your ${TYPE_LABEL[type]}…`);
  setBtnState(true);

  try {
    const data = (await postJSON('/api/generate', {
      idea: prompt,
      title,
      priority,
      type,
      team,
      workCategory,
    })) as GenerateResponse;

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

export function clearForm(): void {
  (document.getElementById('idea') as HTMLTextAreaElement).value = '';
  (document.getElementById('doc-title') as HTMLInputElement).value = '';
  (document.getElementById('doc-type') as HTMLSelectElement).value = 'epic';
  (document.getElementById('priority') as HTMLSelectElement).value = 'Medium';
  (document.getElementById('team') as HTMLSelectElement).value = '';
  (document.getElementById('work-category') as HTMLSelectElement).value = '';
  setStatus('hidden');
}

// ── Quick Create (Story / Spike / Epic from detail view) ───────
export function toggleQuickCreate(type: string): void {
  const panel = document.getElementById('quick-create-panel') as HTMLElement;
  if (panel.classList.contains('open') && _quickCreateType === type) {
    closeQuickCreate();
    return;
  }
  _quickCreateType = type;
  panel.setAttribute('data-type', type);
  const labels: Record<string, string> = {
    epic: '＋ Create Epic',
    story: '＋ Create Story',
    spike: '＋ Create Spike',
    bug: '＋ Create Bug',
  };
  const placeholders: Record<string, string> = {
    epic: 'Describe the epic — what capability should this deliver?…',
    story: 'Describe the story — what should the user be able to do?…',
    spike: 'Describe the research question or technical unknown to investigate…',
    bug: 'Describe the bug — what is broken, how to reproduce it, and what the expected behaviour is…',
  };
  (document.getElementById('quick-create-label') as HTMLElement).textContent =
    labels[type] || `＋ Create ${type}`;
  (document.getElementById('quick-create-idea') as HTMLTextAreaElement).placeholder =
    placeholders[type] || '';
  panel.classList.add('open');
  (document.getElementById('quick-create-title-input') as HTMLInputElement).focus();
}

export function closeQuickCreate(): void {
  const panel = document.getElementById('quick-create-panel');
  if (panel) panel.classList.remove('open');
  const titleInput = document.getElementById('quick-create-title-input') as HTMLInputElement | null;
  const ideaInput = document.getElementById('quick-create-idea') as HTMLTextAreaElement | null;
  const stream = document.getElementById('quick-create-stream') as HTMLElement | null;
  const btn = document.getElementById('quick-run-btn') as HTMLButtonElement | null;
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

interface QuickCreateBody {
  idea: string;
  title: string;
  type: string;
  priority: string;
  parentFeature?: string;
  parentEpic?: string;
  fixVersion?: string;
}

export async function executeQuickCreate(): Promise<void> {
  if (!_quickCreateType) return;
  const ideaInput = document.getElementById('quick-create-idea') as HTMLTextAreaElement;
  const idea = ideaInput.value.trim();
  if (!idea) {
    ideaInput.focus();
    return;
  }

  const title = (
    document.getElementById('quick-create-title-input') as HTMLInputElement
  ).value.trim();
  const type = _quickCreateType;
  const btn = document.getElementById('quick-run-btn') as HTMLButtonElement;
  const stream = document.getElementById('quick-create-stream') as HTMLElement;

  btn.disabled = true;
  btn.textContent = '⏳ Generating…';
  stream.textContent = '';
  stream.style.display = 'block';

  try {
    const body: QuickCreateBody = { idea, title, type, priority: 'Medium' };

    // Inherit parent link and PI from the open doc
    if (type === 'epic' && currentDocType === 'feature' && currentFilename) {
      body.parentFeature = currentFilename;
    }
    if (['story', 'spike', 'bug'].includes(type) && currentDocType === 'epic' && currentFilename) {
      body.parentEpic = currentFilename;
      const parentDoc = allDocs.find((d) => d.filename === currentFilename && d.docType === 'epic');
      if (parentDoc?.fixVersion) body.fixVersion = parentDoc.fixVersion;
    }

    const data = (await postJSON('/api/generate', body)) as GenerateResponse;

    closeQuickCreate();
    await loadDocs();
    if (currentFilename && (currentDocType === 'feature' || currentDocType === 'epic')) {
      loadHierarchy(currentFilename, currentDocType);
    }
    showJiraToast('success', `✅ ${TYPE_LABEL[type]} created: ${data.filename}`);
  } catch (e) {
    stream.textContent += `\n\n❌ ${e instanceof Error ? e.message : String(e)}`;
    btn.disabled = false;
    btn.textContent = 'Generate';
  }
}
