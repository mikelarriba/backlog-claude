// ── Navigation hooks ─────────────────────────────────────────────
// openDoc (detail.ts) and focusEpic (roadmap.ts) are called from modules that
// detail.ts / roadmap.ts themselves import, and importing them back would
// close a cycle and pull those modules' heavy dependency graphs into
// otherwise DOM-inert code. Each owner registers its implementation here at
// load time; callers import the thin forwarders below instead of reaching
// for an ambient window global.
type OpenDocFn = (filename: string, docType: string) => unknown;
type FocusEpicFn = (filename: string) => void;

let _openDoc: OpenDocFn | null = null;
let _focusEpic: FocusEpicFn | null = null;

export function registerOpenDoc(fn: OpenDocFn): void {
  _openDoc = fn;
}

export function registerFocusEpic(fn: FocusEpicFn): void {
  _focusEpic = fn;
}

export function openDoc(filename: string, docType: string): void {
  void _openDoc?.(filename, docType);
}

export function focusEpic(filename: string): void {
  _focusEpic?.(filename);
}
