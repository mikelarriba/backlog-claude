// ── Stub the DOM-heavy modules roadmap-render.js imports ──────────────────────
// roadmap-render.js statically imports roadmap.js, roadmap-drag.js, and
// roadmap-select.js for its render-time DOM wiring (applyEpicFocus,
// initRoadmapDragDrop, syncRoadmapSelectionUI, etc.). Those modules transitively
// import the rest of the app (dragdrop.js -> list-filters.js -> detail.js ->
// main.js -> ...) which run DOM side effects at module-load time (e.g.
// bugcreate.js registers a DOMContentLoaded listener at the top level), which
// throws in a no-DOM test environment.
//
// The pure functions under test (topoSortCards, epicColor, spCardHeight) never
// call into that DOM-wiring, so it's safe to replace those three imports with
// no-op stubs purely so the module graph can load without a real DOM.
//
// IMPORTANT: call installRoadmapMocks() BEFORE dynamically importing
// roadmap-render.js (`await import(...)`), not before a *static* `import`.
// node:test's mock.module() intercepts module resolution from that point
// forward; a static import of roadmap-render.js gets linked/evaluated as part
// of the module graph before any of this file's plain statements run, so it
// would already be too late.
import { mock } from 'node:test';

export function installRoadmapMocks() {
  mock.module('../../public/js/roadmap.js', {
    namedExports: {
      applyEpicFocus: () => {},
      getAllSprints: () => [],
    },
  });

  mock.module('../../public/js/roadmap-drag.js', {
    namedExports: {
      initRoadmapDragDrop: () => {},
      attachRoadmapDepHoverListeners: () => {},
    },
  });

  mock.module('../../public/js/roadmap-select.js', {
    namedExports: {
      syncRoadmapSelectionUI: () => {},
    },
  });
}
