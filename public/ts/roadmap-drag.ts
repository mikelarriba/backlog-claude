// ── Roadmap drag-and-drop (sprint move + in-column rerank) ─
import { patchJSON, buildChildrenMap, getDescendants } from './state.js';
import { renderEpicPanel, patchStoryColumn } from './roadmap-render.js';
import { executeRerankDrop } from './dragdrop.js';
import { showDepConnectors, hideDepConnectors } from './list-render.js';
import { getAllSprints } from './roadmap.js';

interface RoadmapDragPayload {
  filename: string;
  docType: string;
  fromSprint: string;
}

// `root` scopes listener attachment to a single freshly-patched column
// (patchStoryColumn) instead of the whole board — pass the default
// (document) when wiring up the full board on initial render.
export function initRoadmapDragDrop(root: ParentNode = document): void {
  const cards = root.querySelectorAll<HTMLElement>('.roadmap-card[draggable]');
  const dropZones = root.querySelectorAll<HTMLElement>('.roadmap-card-list');

  function clearCardDropClasses(): void {
    document
      .querySelectorAll('.roadmap-card')
      .forEach((c) => c.classList.remove('rm-insert-before', 'rm-insert-after'));
  }

  cards.forEach((card) => {
    card.addEventListener('dragstart', (e: Event) => {
      const dragEvent = e as DragEvent;
      card.classList.add('dragging');
      dragEvent.dataTransfer!.effectAllowed = 'move';
      dragEvent.dataTransfer!.setData(
        'text/plain',
        JSON.stringify({
          filename: card.dataset['filename'],
          docType: card.dataset['doctype'],
          fromSprint: card.dataset['sprint'],
        })
      );
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      clearCardDropClasses();
      dropZones.forEach((z) => z.classList.remove('drag-over'));
    });

    // ── Per-card zone detection ──
    card.addEventListener('dragover', (e: Event) => {
      const dragEvent = e as DragEvent;
      dragEvent.preventDefault();
      dragEvent.stopPropagation();
      const rect = card.getBoundingClientRect();
      const relY = dragEvent.clientY - rect.top;
      const zone = relY < rect.height * 0.5 ? 'before' : 'after';
      card.classList.remove('rm-insert-before', 'rm-insert-after');
      if (zone === 'before') card.classList.add('rm-insert-before');
      else card.classList.add('rm-insert-after');
      dragEvent.dataTransfer!.dropEffect = 'move';
    });

    card.addEventListener('dragleave', (e: Event) => {
      const dragEvent = e as DragEvent;
      if (!card.contains(dragEvent.relatedTarget as Node))
        card.classList.remove('rm-insert-before', 'rm-insert-after');
    });

    card.addEventListener('drop', async (e: Event) => {
      const dragEvent = e as DragEvent;
      dragEvent.preventDefault();
      dragEvent.stopPropagation();
      const rect = card.getBoundingClientRect();
      const relY = dragEvent.clientY - rect.top;
      const zone = relY < rect.height * 0.5 ? 'before' : 'after';
      clearCardDropClasses();

      try {
        const data = JSON.parse(
          dragEvent.dataTransfer!.getData('text/plain')
        ) as RoadmapDragPayload;
        if (data.filename === card.dataset['filename']) return;

        // Rerank: determine insertBefore filename
        let insertBeforeFilename: string | null;
        if (zone === 'before') {
          insertBeforeFilename = card.dataset['filename'] ?? null;
        } else {
          const list = card.closest('.roadmap-card-list');
          const allCards = list
            ? [...list.querySelectorAll<HTMLElement>('.roadmap-card[data-filename]')]
            : [];
          const idx = allCards.indexOf(card);
          insertBeforeFilename =
            idx >= 0 && idx + 1 < allCards.length
              ? (allCards[idx + 1].dataset['filename'] ?? null)
              : null;
        }
        await executeRerankDrop(data.filename, data.docType, insertBeforeFilename);

        // Patch just the affected column(s) in place instead of rebuilding
        // the whole board — a rerank only ever changes ordering within a
        // sprint column, never sprint membership or epic timelines.
        const fromSprint = data.fromSprint || null;
        const toSprint = card.dataset['sprint'] || null;
        patchStoryColumn(fromSprint);
        if (toSprint !== fromSprint) patchStoryColumn(toSprint);
      } catch (err) {
        console.warn('Roadmap card drop failed:', (err as Error).message);
      }
    });
  });

  // ── Column-level drop (cross-sprint move) ────────────────────
  dropZones.forEach((zone) => {
    zone.addEventListener('dragover', (e: Event) => {
      const dragEvent = e as DragEvent;
      dragEvent.preventDefault();
      dragEvent.dataTransfer!.dropEffect = 'move';
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', (e: Event) => {
      const dragEvent = e as DragEvent;
      if (!zone.contains(dragEvent.relatedTarget as Node)) zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', async (e: Event) => {
      const dragEvent = e as DragEvent;
      dragEvent.preventDefault();
      zone.classList.remove('drag-over');
      // Card drops stop propagation so this only fires for empty-area drops
      try {
        const data = JSON.parse(
          dragEvent.dataTransfer!.getData('text/plain')
        ) as RoadmapDragPayload;
        const toSprint = zone.dataset['sprint'] || null;
        if (data.fromSprint === (toSprint || '')) return;

        await patchJSON(`/api/doc/${data.docType}/${encodeURIComponent(data.filename)}`, {
          sprint: toSprint,
        });
        const doc = allDocs.find((d) => d.filename === data.filename && d.docType === data.docType);
        if (doc) doc.sprint = toSprint;

        // Cascade sprint to all descendants for parent types
        if (data.docType === 'epic' || data.docType === 'feature') {
          const childrenMap = buildChildrenMap(allDocs);
          const descendants = getDescendants(data.filename, childrenMap);
          for (const desc of descendants) {
            await patchJSON(`/api/doc/${desc.docType}/${encodeURIComponent(desc.filename)}`, {
              sprint: toSprint,
            });
            desc.sprint = toSprint;
          }
        }

        // Patch just the two affected columns in place. The epic panel is
        // cheap to rebuild in full (proportional to epic count, not story
        // count) and a cross-sprint move can shift an epic's timeline bar,
        // so it still gets a full (but inexpensive) re-render.
        patchStoryColumn(data.fromSprint || null);
        patchStoryColumn(toSprint);
        renderEpicPanel(getAllSprints());
      } catch (err) {
        console.warn('Failed to update sprint assignment:', (err as Error).message);
      }
    });
  });
}

// ── Roadmap dep hover listeners ──────────────────────────────
export function attachRoadmapDepHoverListeners(): void {
  document.querySelectorAll<HTMLElement>('.roadmap-card[data-filename]').forEach((el) => {
    const doc = allDocs.find((d) => d.filename === el.dataset['filename']);
    if (!doc) return;
    if (!(doc.blocks || []).length && !(doc.blockedBy || []).length) return;
    el.addEventListener('mouseenter', () => showDepConnectors(doc.filename));
    el.addEventListener('mouseleave', hideDepConnectors);
  });
}
