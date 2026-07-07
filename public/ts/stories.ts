// ── Stories: stream reset ──────────────────────────────────────
import { streamSSE } from './state.js';
import { loadDocs } from './list.js';
import { loadHierarchy } from './detail-links.js';
import { buildCanvasGraph } from './refine-canvas.js';

interface StoryFile {
  title: string;
}

interface StoriesProgressPayload {
  current: number;
  total: number;
  title: string;
}

export function resetStoriesSection(): void {
  const wrap = document.getElementById('stories-stream-wrap');
  if (wrap) wrap.classList.add('hidden');
  const stream = document.getElementById('stories-stream');
  if (stream) stream.textContent = '';
  const spinner = document.getElementById('stories-spinner');
  if (spinner) spinner.classList.add('hidden');
  const bar = document.getElementById('stories-progress');
  if (bar) bar.classList.add('hidden');
}

// ── Generate / Regenerate Stories ─────────────────────────────
export async function generateStories(): Promise<void> {
  if (!currentFilename) return;

  const btn = document.getElementById('stories-btn') as HTMLButtonElement;
  const wrap = document.getElementById('stories-stream-wrap') as HTMLElement;
  const stream = document.getElementById('stories-stream') as HTMLElement;
  const spinner = document.getElementById('stories-spinner') as HTMLElement;
  const bar = document.getElementById('stories-progress') as HTMLElement | null;
  const barFill = document.getElementById('stories-progress-fill') as HTMLElement | null;
  const barText = document.getElementById('stories-progress-text') as HTMLElement | null;

  btn.disabled = true;
  btn.textContent = '⏳ Generating…';
  stream.textContent = '';
  wrap.classList.remove('hidden');
  spinner.classList.remove('hidden');
  if (bar) bar.classList.add('hidden');
  wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    let donePayload: Record<string, unknown> | null = null;
    await streamSSE(
      `/api/epic/${encodeURIComponent(currentFilename)}/stories`,
      {},
      {
        onText: (text) => {
          stream.textContent += text;
        },
        onDone: (payload) => {
          donePayload = payload;
        },
        onProgress: (progress) => {
          const p = progress as unknown as StoriesProgressPayload;
          spinner.classList.add('hidden');
          stream.textContent = '';
          if (bar) {
            bar.classList.remove('hidden');
            const pct = Math.round((p.current / p.total) * 100);
            if (barFill) barFill.style.width = `${pct}%`;
            if (barText)
              barText.textContent = `Saving story ${p.current} of ${p.total}: ${p.title}`;
          }
        },
      }
    );

    spinner.classList.add('hidden');
    stream.textContent = '';

    const files = donePayload?.['files'] as StoryFile[] | undefined;
    if (files?.length) {
      const count = files.length;
      if (bar) bar.classList.add('hidden');
      stream.textContent =
        `✅ Created ${count} stor${count === 1 ? 'y' : 'ies'}:\n` +
        files.map((f) => `• ${f.title}`).join('\n');
      wrap.classList.remove('hidden');

      await loadDocs();
      loadHierarchy(currentFilename, currentDocType ?? '');

      if (typeof _canvasEpicFilename !== 'undefined' && _canvasEpicFilename === currentFilename) {
        await buildCanvasGraph(_canvasEpicFilename, _canvasDocType ?? '');
      }
    } else {
      wrap.classList.add('hidden');
    }

    btn.disabled = false;
    btn.textContent = 'AI Story Generation';
  } catch (e) {
    spinner.classList.add('hidden');
    if (bar) bar.classList.add('hidden');
    stream.textContent += `\n\n❌ Error: ${e instanceof Error ? e.message : String(e)}`;
    btn.disabled = false;
    btn.textContent = 'AI Story Generation';
  }
}
