// ── Minimal window shim for frontend unit tests ────────────────────────────────
// public/js/state.js defines several store-backed globals via
// `Object.defineProperty(window, ...)` so the rest of the frontend can read/write
// them as bare identifiers (e.g. `allDocs`, `piSettings`, `_collapsedItems`).
// There is no real DOM in these tests, so `window` doesn't exist by default —
// aliasing it to `globalThis` lets state.js's defineProperty calls attach to the
// same object bare identifiers resolve against, without pulling in a full DOM
// implementation.
//
// Import this module BEFORE importing anything that (transitively) imports
// state.js, e.g.:
//   import '../helpers/domGlobals.js';
//   import { buildTreeOrder } from '../../public/js/list-render.js';
// ES module imports execute in declaration order, so this shim runs first.
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}
