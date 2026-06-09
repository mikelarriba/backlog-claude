// ── Event-driven state store ──────────────────────────────────────────────────
// Lightweight pub/sub store for docs and piSettings. No library, no framework.
// Other modules subscribe to domain events instead of being called imperatively.

import type { DocEntry, PISettings } from './state.js';

interface AppState {
  docs: DocEntry[];
  piSettings: PISettings;
}

type AnyCallback = (payload: unknown) => void;

const _state: AppState = {
  docs: [],
  piSettings: { currentPi: null, nextPi: null },
};

const _listeners = new Map<string, Set<AnyCallback>>();

function emit(event: string, payload: unknown): void {
  _listeners.get(event)?.forEach((cb) => cb(payload));
}

export function getState(): Readonly<AppState> {
  return Object.freeze({ ..._state, docs: [..._state.docs] });
}

export function on<T = unknown>(event: string, callback: (payload: T) => void): () => void {
  if (!_listeners.has(event)) _listeners.set(event, new Set());
  _listeners.get(event)!.add(callback as AnyCallback);
  return () => _listeners.get(event)?.delete(callback as AnyCallback);
}

export function setDocs(docs: DocEntry[]): void {
  _state.docs = docs;
  emit('docs:changed', { docs: _state.docs });
}

export function upsertDoc(doc: DocEntry): void {
  const idx = _state.docs.findIndex((d) => d.filename === doc.filename);
  if (idx !== -1) _state.docs[idx] = doc;
  else _state.docs.push(doc);
  emit('doc:upserted', { doc });
  emit('docs:changed', { docs: _state.docs });
}

export function removeDoc(filename: string): void {
  _state.docs = _state.docs.filter((d) => d.filename !== filename);
  emit('doc:removed', { filename });
  emit('docs:changed', { docs: _state.docs });
}

export function setPiSettings(settings: PISettings): void {
  _state.piSettings = settings;
  emit('piSettings:changed', { settings });
}
