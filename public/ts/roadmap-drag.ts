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

// Pure: given the DOM-rendered filename order of a single sprint column,
// returns the insertBeforeFilename to pass to executeRerankDrop for moving
// `filename` up or down by one position, or `undefined` when it's already
// at that edge of the column (no-op). Mirrors the same before/after zone
// semantics the mouse per-card drop handler below already uses.
export function computeColumnMoveTarget(
  columnFilenames: string[],
  filename: string,
  direction: 'up' | 'down'
): string | null | undefined {
  const idx = columnFilenames.indexOf(filename);
  if (idx < 0) return undefined;
  if (direction === 'up' && idx === 0) return undefined;
  if (direction === 'down' && idx === columnFilenames.length - 1) return undefined;
  return direction === 'up' ? columnFilenames[idx - 1] : (columnFilenames[idx + 2] ?? null);
}

// Pure: given the ordered list of sprint-column identifiers (sprint names,
// with '' representing the trailing Unassigned column — matching the
// data-sprint attribute used throughout this module), returns the adjacent
// column identifier for moving `currentId` left/right, or `undefined` when
// already at that edge.
export function computeAdjacentColumn(
  columnIds: string[],
  currentId: string,
  direction: 'prev' | 'next'
): string | undefined {
  const idx = columnIds.indexOf(currentId);
  if (idx < 0) return undefined;
  if (direction === 'prev' && idx === 0) return undefined;
  if (direction === 'next' && idx === columnIds.length - 1) return undefined;
  return direction === 'prev' ? columnIds[idx - 1] : columnIds[idx + 1];
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

    const handle = card.querySelector<HTMLElement>('.rm-reorder-handle');
    const filename = card.dataset['filename'] as string;
    const docType = card.dataset['doctype'] as string;
    handle?.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      if (e.key === 'ArrowUp') void moveCardWithinColumn(card, filename, docType, 'up');
      else if (e.key === 'ArrowDown') void moveCardWithinColumn(card, filename, docType, 'down');
      else if (e.key === 'ArrowLeft')
        void moveCardToAdjacentSprint(card, filename, docType, 'prev');
      else if (e.key === 'ArrowRight')
        void moveCardToAdjacentSprint(card, filename, docType, 'next');
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

        await applySprintMove(data.filename, data.docType, data.fromSprint || null, toSprint);
      } catch (err) {
        console.warn('Failed to update sprint assignment:', (err as Error).message);
      }
    });
  });
}

// Shared by the cross-sprint column drop above and the keyboard alternative
// below — updates the doc's (and, for parent types, its descendants')
// sprint assignment and patches the affected columns + epic panel in place.
async function applySprintMove(
  filename: string,
  docType: string,
  fromSprint: string | null,
  toSprint: string | null
): Promise<void> {
  await patchJSON(`/api/doc/${docType}/${encodeURIComponent(filename)}`, { sprint: toSprint });
  const doc = allDocs.find((d) => d.filename === filename && d.docType === docType);
  if (doc) doc.sprint = toSprint;

  // Cascade sprint to all descendants for parent types
  if (docType === 'epic' || docType === 'feature') {
    const childrenMap = buildChildrenMap(allDocs);
    const descendants = getDescendants(filename, childrenMap);
    for (const desc of descendants) {
      await patchJSON(`/api/doc/${desc.docType}/${encodeURIComponent(desc.filename)}`, {
        sprint: toSprint,
      });
      desc.sprint = toSprint;
    }
  }

  // Patch just the two affected columns in place. The epic panel is cheap
  // to rebuild in full (proportional to epic count, not story count) and a
  // cross-sprint move can shift an epic's timeline bar, so it still gets a
  // full (but inexpensive) re-render.
  patchStoryColumn(fromSprint);
  patchStoryColumn(toSprint);
  renderEpicPanel(getAllSprints());
}

// Focus is lost when patchStoryColumn re-renders a column's HTML, since the
// old card/handle elements are discarded — restore it to the moved item's
// (re-rendered) handle so repeated key presses keep working without
// re-tabbing, matching the same pattern used for backlog list rerank.
function refocusHandle(filename: string): void {
  setTimeout(() => {
    document
      .querySelector<HTMLElement>(
        `.roadmap-card[data-filename="${CSS.escape(filename)}"] .rm-reorder-handle`
      )
      ?.focus();
  }, 50);
}

// Keyboard-operable alternative to the in-column drag rerank above — moves
// the focused card up/down within its own sprint column by swapping it with
// its immediate DOM neighbor, calling the same executeRerankDrop() the
// mouse drag-and-drop 'before'/'after' zones already use. Purely additive:
// does not change or remove the existing mouse drag-and-drop behavior.
async function moveCardWithinColumn(
  card: HTMLElement,
  filename: string,
  docType: string,
  direction: 'up' | 'down'
): Promise<void> {
  const list = card.closest('.roadmap-card-list');
  if (!list) return;
  const columnFilenames = [
    ...list.querySelectorAll<HTMLElement>('.roadmap-card[data-filename]'),
  ].map((el) => el.dataset['filename'] as string);
  const insertBeforeFilename = computeColumnMoveTarget(columnFilenames, filename, direction);
  if (insertBeforeFilename === undefined) return;

  await executeRerankDrop(filename, docType, insertBeforeFilename);
  patchStoryColumn(card.dataset['sprint'] || null);
  refocusHandle(filename);
}

// Keyboard-operable alternative to the cross-sprint column drop above —
// moves the focused card to the previous/next sprint column (same order as
// rendered), reusing the same sprint-assignment + descendant-cascade logic
// (applySprintMove) the mouse drop handler uses. Purely additive: does not
// change or remove the existing mouse drag-and-drop behavior.
async function moveCardToAdjacentSprint(
  card: HTMLElement,
  filename: string,
  docType: string,
  direction: 'prev' | 'next'
): Promise<void> {
  const columnIds = [...getAllSprints().map((s) => s.name), ''];
  const fromId = card.dataset['sprint'] || '';
  const toId = computeAdjacentColumn(columnIds, fromId, direction);
  if (toId === undefined) return;

  try {
    await applySprintMove(filename, docType, fromId || null, toId || null);
    refocusHandle(filename);
  } catch (err) {
    console.warn('Failed to update sprint assignment:', (err as Error).message);
  }
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
