// ── Upgrade panel ─────────────────────────────────────────────
import { streamSSE, stripFrontmatter, TYPE_LABEL, renderMarkdown } from './state.js';

export function toggleUpgradePanel(): void {
  const panel = document.getElementById('upgrade-panel');
  const isOpen = panel!.classList.toggle('open');
  if (isOpen) {
    _prefillUpgradeIfDraft();
    (document.getElementById('upgrade-feedback') as HTMLElement).focus();
  } else {
    resetUpgradePanel();
  }
}

// When the current doc is a minimal draft, pre-fill a helpful default prompt
function _prefillUpgradeIfDraft(): void {
  const textarea = document.getElementById('upgrade-feedback') as HTMLTextAreaElement | null;
  if (!textarea || textarea.value.trim()) return;
  const body = document.getElementById('detail-content')?.textContent?.trim() || '';
  if (body.length < 250) {
    const label = TYPE_LABEL[currentDocType ?? ''] || currentDocType;
    textarea.value = `Generate a complete ${label} using the COVE framework (Context, Objective, Value, Execution) with Acceptance Criteria. Use the title and any notes above as context.`;
  }
}

export function resetUpgradePanel(): void {
  (document.getElementById('upgrade-feedback') as HTMLTextAreaElement).value = '';
  (document.getElementById('upgrade-stream') as HTMLElement).style.display = 'none';
  (document.getElementById('upgrade-stream') as HTMLElement).textContent = '';
  const btn = document.getElementById('upgrade-run-btn') as HTMLButtonElement;
  btn.disabled = false;
  btn.textContent = 'Regenerate';
}

export async function executeUpgrade(): Promise<void> {
  if (!currentFilename || !currentDocType) return;
  const feedback = (
    document.getElementById('upgrade-feedback') as HTMLTextAreaElement
  ).value.trim();
  if (!feedback) {
    (document.getElementById('upgrade-feedback') as HTMLElement).focus();
    return;
  }

  const btn = document.getElementById('upgrade-run-btn') as HTMLButtonElement;
  const stream = document.getElementById('upgrade-stream') as HTMLElement;

  btn.disabled = true;
  btn.textContent = '⏳ Regenerating…';
  stream.textContent = '';
  stream.style.display = 'none';

  try {
    let finalContent: string | null = null;
    await streamSSE(
      `/api/doc/${currentDocType}/${encodeURIComponent(currentFilename)}/upgrade`,
      { feedback },
      {
        onText: (text) => {
          stream.style.display = 'block';
          stream.textContent += text;
        },
        onDone: (payload) => {
          finalContent = payload['content'] as string;
        },
        onError: (e) => {
          throw e;
        },
      }
    );

    if (finalContent) {
      (document.getElementById('detail-content') as HTMLElement).innerHTML = renderMarkdown(
        stripFrontmatter(finalContent)
      );
    }
    document.getElementById('upgrade-panel')!.classList.remove('open');
    resetUpgradePanel();
    btn.textContent = 'Regenerate';
  } catch (e) {
    stream.textContent += `\n\n❌ Error: ${e instanceof Error ? e.message : String(e)}`;
    btn.disabled = false;
    btn.textContent = 'Regenerate';
  }
}
