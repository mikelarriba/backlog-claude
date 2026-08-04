// ── Typed action-registration for data-action dispatch (spike, issue #461) ──
// Context: main.ts's delegated click handler had a single, ever-growing
// central switch, and dynamically-rendered HTML (context menus, canvas
// nodes, etc.) called back into a handler via untyped `onclick="fn(...)"`
// strings pushed onto `window` through main.ts's `_dynGlobals` bridge — a
// typo'd or renamed handler there compiles cleanly and only fails at
// runtime, on click.
//
// This module lets a view/module self-register its own action handlers
// against one shared, typed registry instead of requiring edits to
// main.ts's switch. A module adopting this pattern:
//   1. Defines its action names as a `const` object of strings, so every
//      call site — including the `data-action="..."` attribute emitted by
//      that module's own render/template code — references the same
//      TS-checked property instead of a duplicated magic string (a rename
//      of the constant's key is a compile error at every use; a typo'd
//      *string value* is still only caught at registration/dispatch time,
//      same as the existing `data-action` switch in main.ts).
//   2. Calls `registerActions({ ... })` once, at module load time (a
//      top-level call, so it runs as soon as the module is imported —
//      which main.ts already does for every view module it wires up).
//
// main.ts's delegated click handler calls `dispatchAction(action, el, e)`
// before falling into its (still-present, only-growing-for-unmigrated-views)
// switch. Registering the same action name twice throws immediately, at
// module-load time — a copy-pasted or colliding action name is caught the
// moment the app boots, not silently overwritten and not deferred until
// someone clicks the button.
//
// This is a proof-of-concept covering ONE view so far: the list
// multi-select context menu in list-filters.ts (see `CTX_ACTIONS` there for
// a concrete example of the two steps above). Future views should follow
// the same pattern rather than adding cases to main.ts's switch or entries
// to its `_dynGlobals` bridge — see the design note above `_dynGlobals` in
// main.ts for the incremental migration plan.

export type ActionHandler = (el: HTMLElement, e: MouseEvent) => void;

const registry = new Map<string, ActionHandler>();

/**
 * Registers one or more `{ actionName: handler }` pairs against the shared
 * dispatch table. Call this once at module load time from the module that
 * owns the action (typically right after the handler functions are
 * defined). Throws synchronously if an action name is already registered,
 * so a duplicate/typo'd name fails loudly at import time instead of
 * silently shadowing another module's handler.
 */
export function registerActions(actions: Record<string, ActionHandler>): void {
  for (const [name, handler] of Object.entries(actions)) {
    if (registry.has(name)) {
      throw new Error(
        `registerActions: action "${name}" is already registered — action names must be ` +
          'unique across all modules. Check for a copy-pasted key or a duplicate registerActions() call.'
      );
    }
    registry.set(name, handler);
  }
}

/**
 * Looks up `name` in the registry and invokes its handler with the
 * triggering element and event. Returns `true` if a handler ran, `false`
 * if nothing is registered under that name (the caller — main.ts's click
 * handler — falls back to its legacy switch in that case, so this stays
 * safe to call for actions not yet migrated to this pattern).
 */
export function dispatchAction(name: string, el: HTMLElement, e: MouseEvent): boolean {
  const handler = registry.get(name);
  if (!handler) return false;
  handler(el, e);
  return true;
}
