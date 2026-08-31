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
//
// Everything above this point is `click` only. See "Change-event registry"
// further down for the analogous (but separate) registry for `change`.

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

// ── Change-event registry (extension, issue #461) ──────────────────────────
// The click registry above covers `data-action` / delegated `click`. That
// left main.ts's *other* delegated listeners — `data-change-action` for
// `change` and `data-input-action` for `input` — as two more hand-written
// central switches, each with the same untyped-`window`-bridge smell the
// click switch used to have (see e.g. the `docSetSprint` /
// `docSetFixVersionBulk` cases this registry replaces). Status comments on
// #461 called generalizing this "a real design decision (new handler
// signature per event type) rather than a mechanical follow-the-pattern
// migration", so this section spikes that decision for `change` only —
// `input` is intentionally left as still-a-switch for a future increment to
// pick up with the same pattern once this one has proven out.
//
// Design: a second, independent registry rather than reusing the click
// `Map` above. A change action name and a click action name are allowed to
// collide (they're different attributes — `data-change-action` vs
// `data-action` — dispatched from different listeners for different DOM
// events), so sharing one map would make an unrelated collision throw at
// load time and would let a `change` handler be invoked from a stray click
// on the same element. Everything else mirrors the click registry
// deliberately: same throw-on-duplicate-registration behavior, same
// "returns `true` if a handler ran, so callers can fall back to their
// legacy switch" contract — only the handler signature differs, taking the
// native `Event` a `change` listener receives instead of `MouseEvent`.
//
// A module adopts this the same two-step way as the click registry: define
// a `const` object of change-action names (see `docSetSprint` /
// `docSetFixVersionBulk` in documentation.ts for the concrete example this
// spike migrated), then call `registerChangeActions({ ... })` once at
// module load time. main.ts's delegated `change` handler calls
// `dispatchChangeAction(changeAction, target, e)` before falling into its
// switch, exactly as the click handler already does with `dispatchAction`.

export type ChangeActionHandler = (el: HTMLElement, e: Event) => void;

const changeRegistry = new Map<string, ChangeActionHandler>();

/**
 * Registers one or more `{ actionName: handler }` pairs against the shared
 * `change`-event dispatch table. Call this once at module load time from
 * the module that owns the action. Throws synchronously if a change action
 * name is already registered, so a duplicate/typo'd name fails loudly at
 * import time instead of silently shadowing another module's handler. This
 * is a separate registry from `registerActions` above — a name registered
 * here does not collide with the same name registered for `click`.
 */
export function registerChangeActions(actions: Record<string, ChangeActionHandler>): void {
  for (const [name, handler] of Object.entries(actions)) {
    if (changeRegistry.has(name)) {
      throw new Error(
        `registerChangeActions: change action "${name}" is already registered — change action ` +
          'names must be unique across all modules. Check for a copy-pasted key or a duplicate ' +
          'registerChangeActions() call.'
      );
    }
    changeRegistry.set(name, handler);
  }
}

/**
 * Looks up `name` in the change registry and invokes its handler with the
 * triggering element and event. Returns `true` if a handler ran, `false`
 * if nothing is registered under that name (the caller — main.ts's change
 * handler — falls back to its legacy switch in that case, so this stays
 * safe to call for change actions not yet migrated to this pattern).
 */
export function dispatchChangeAction(name: string, el: HTMLElement, e: Event): boolean {
  const handler = changeRegistry.get(name);
  if (!handler) return false;
  handler(el, e);
  return true;
}

// ── Input-event registry (extension, issue #461) ────────────────────────────
// The change registry above proved the "just a Map plus a differently-typed
// handler" approach also works for `data-change-action`. `input` is the
// third and (per every status comment on #461) last of the three delegated
// listeners main.ts hand-rolls a switch for — flagged repeatedly as "still a
// switch for a future increment to pick up with the same pattern once this
// one has proven out." That increment is this one. A third, independent
// registry for the same reasons the change registry isn't merged into the
// click one: `data-input-action` is a distinct attribute dispatched from a
// distinct listener for a distinct DOM event, so an input action name is
// allowed to collide with a click or change action name without either
// throwing at load time or firing the wrong handler.

export type InputActionHandler = (el: HTMLElement, e: Event) => void;

const inputRegistry = new Map<string, InputActionHandler>();

/**
 * Registers one or more `{ actionName: handler }` pairs against the shared
 * `input`-event dispatch table. Call this once at module load time from the
 * module that owns the action. Throws synchronously if an input action name
 * is already registered, so a duplicate/typo'd name fails loudly at import
 * time instead of silently shadowing another module's handler. This is a
 * separate registry from `registerActions`/`registerChangeActions` above —
 * a name registered here does not collide with the same name registered for
 * `click` or `change`.
 */
export function registerInputActions(actions: Record<string, InputActionHandler>): void {
  for (const [name, handler] of Object.entries(actions)) {
    if (inputRegistry.has(name)) {
      throw new Error(
        `registerInputActions: input action "${name}" is already registered — input action ` +
          'names must be unique across all modules. Check for a copy-pasted key or a duplicate ' +
          'registerInputActions() call.'
      );
    }
    inputRegistry.set(name, handler);
  }
}

/**
 * Looks up `name` in the input registry and invokes its handler with the
 * triggering element and event. Returns `true` if a handler ran, `false`
 * if nothing is registered under that name (the caller — main.ts's input
 * handler — falls back to its legacy switch in that case, so this stays
 * safe to call for input actions not yet migrated to this pattern).
 */
export function dispatchInputAction(name: string, el: HTMLElement, e: Event): boolean {
  const handler = inputRegistry.get(name);
  if (!handler) return false;
  handler(el, e);
  return true;
}

// ── Context-menu-event registry (extension, issue #461) ─────────────────────
// click/change/input are now fully self-registered (see above). The one
// remaining category of hand-rolled dispatch flagged in status comments on
// this issue is `oncontextmenu="fn(event, ...)"` strings — four sites, all
// context-menu *openers* (list-render.ts's row, roadmap-render.ts's
// estimated-sprint placeholder card, epic row, and story card), reached via
// main.ts's untyped `_dynGlobals` window bridge because there has never been
// a delegated `contextmenu` listener for them to hook into. Same tradeoff
// noted for `change`/`input`: a `data-context-action` name is dispatched
// from a distinct listener for a distinct DOM event, so it's allowed to
// collide with a click/change/input action name without either throwing at
// load time or firing the wrong handler — hence a fourth independent
// registry rather than reusing one of the three above.
//
// This spikes the pattern on the simplest of the four sites (list-render.ts,
// single owner file, single handler) as proof; the three roadmap-render.ts /
// roadmap-context-menus.ts sites — flagged in prior #461 status comments as
// "the higher-risk, cross-module" case — are left for a future increment to
// migrate once this one has proven out, the same staged approach the
// change/input registries themselves followed.

export type ContextActionHandler = (el: HTMLElement, e: MouseEvent) => void;

const contextRegistry = new Map<string, ContextActionHandler>();

/**
 * Registers one or more `{ actionName: handler }` pairs against the shared
 * `contextmenu`-event dispatch table. Call this once at module load time
 * from the module that owns the action. Throws synchronously if a context
 * action name is already registered, so a duplicate/typo'd name fails
 * loudly at import time instead of silently shadowing another module's
 * handler. This is a separate registry from `registerActions` /
 * `registerChangeActions` / `registerInputActions` above — a name
 * registered here does not collide with the same name registered for
 * `click`, `change`, or `input`.
 */
export function registerContextActions(actions: Record<string, ContextActionHandler>): void {
  for (const [name, handler] of Object.entries(actions)) {
    if (contextRegistry.has(name)) {
      throw new Error(
        `registerContextActions: context action "${name}" is already registered — context ` +
          'action names must be unique across all modules. Check for a copy-pasted key or a ' +
          'duplicate registerContextActions() call.'
      );
    }
    contextRegistry.set(name, handler);
  }
}

/**
 * Looks up `name` in the context registry and invokes its handler with the
 * triggering element and event. Returns `true` if a handler ran, `false` if
 * nothing is registered under that name (the caller — main.ts's contextmenu
 * handler — no-ops in that case, since the remaining unmigrated
 * `oncontextmenu="..."` sites are plain inline attributes, not routed
 * through this delegated listener at all).
 */
export function dispatchContextAction(name: string, el: HTMLElement, e: MouseEvent): boolean {
  const handler = contextRegistry.get(name);
  if (!handler) return false;
  handler(el, e);
  return true;
}
