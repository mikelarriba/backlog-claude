// ── Roadmap drag-and-drop (sprint move + in-column rerank) ─
import { patchJSON, buildChildrenMap, getDescendants } from './state.js';
import { renderRoadmapBoard } from './roadmap-render.js';
import { executeRerankDrop } from './dragdrop.js';
import { showDepConnectors, hideDepConnectors } from './list-render.js';

export function initRoadmapDragDrop() {
  const cards = document.querySelectorAll('.roadmap-card[draggable]');
  const dropZones = document.querySelectorAll('.roadmap-card-list');

  function clearCardDropClasses() {
    document
      .querySelectorAll('.roadmap-card')
      .forEach((c) => c.classList.remove('rm-insert-before', 'rm-insert-after'));
  }

  cards.forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(
        'text/plain',
        JSON.stringify({
          filename: card.dataset.filename,
          docType: card.dataset.doctype,
          fromSprint: card.dataset.sprint,
        })
      );
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      clearCardDropClasses();
      dropZones.forEach((z) => z.classList.remove('drag-over'));
    });

    // ── Per-card zone detection ──
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = card.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      const zone = relY < rect.height * 0.5 ? 'before' : 'after';
      card.classList.remove('rm-insert-before', 'rm-insert-after');
      if (zone === 'before') card.classList.add('rm-insert-before');
      else card.classList.add('rm-insert-after');
      e.dataTransfer.dropEffect = 'move';
    });

    card.addEventListener('dragleave', (e) => {
      if (!card.contains(e.relatedTarget))
        card.classList.remove('rm-insert-before', 'rm-insert-after');
    });

    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = card.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      const zone = relY < rect.height * 0.5 ? 'before' : 'after';
      clearCardDropClasses();

      try {
        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
        if (data.filename === card.dataset.filename) return;

        // Rerank: determine insertBefore filename
        let insertBeforeFilename;
        if (zone === 'before') {
          insertBeforeFilename = card.dataset.filename;
        } else {
          const list = card.closest('.roadmap-card-list');
          const allCards = list ? [...list.querySelectorAll('.roadmap-card[data-filename]')] : [];
          const idx = allCards.indexOf(card);
          insertBeforeFilename =
            idx >= 0 && idx + 1 < allCards.length ? allCards[idx + 1].dataset.filename : null;
        }
        await executeRerankDrop(data.filename, data.docType, insertBeforeFilename);
        renderRoadmapBoard();
      } catch (err) {
        console.warn('Roadmap card drop failed:', err.message);
      }
    });
  });

  // ── Column-level drop (cross-sprint move) ────────────────────
  dropZones.forEach((zone) => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', (e) => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      // Card drops stop propagation so this only fires for empty-area drops
      try {
        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
        const toSprint = zone.dataset.sprint || null;
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

        renderRoadmapBoard();
      } catch (err) {
        console.warn('Failed to update sprint assignment:', err.message);
      }
    });
  });
}

// ── Roadmap dep hover listeners ──────────────────────────────
export function attachRoadmapDepHoverListeners() {
  document.querySelectorAll('.roadmap-card[data-filename]').forEach((el) => {
    const doc = allDocs.find((d) => d.filename === el.dataset.filename);
    if (!doc) return;
    if (!(doc.blocks || []).length && !(doc.blockedBy || []).length) return;
    el.addEventListener('mouseenter', () => showDepConnectors(doc.filename));
    el.addEventListener('mouseleave', hideDepConnectors);
  });
}
