// ── Event-driven state store ──────────────────────────────────────────────────
// Lightweight pub/sub store for docs and piSettings. No library, no framework.
// Other modules subscribe to domain events instead of being called imperatively.
const _state = {
  docs: [],
  piSettings: { currentPi: null, nextPi: null },
};
const _listeners = new Map();
function emit(event, payload) {
  _listeners.get(event)?.forEach((cb) => cb(payload));
}
export function getState() {
  return Object.freeze({ ..._state, docs: [..._state.docs] });
}
export function on(event, callback) {
  if (!_listeners.has(event)) _listeners.set(event, new Set());
  _listeners.get(event).add(callback);
  return () => _listeners.get(event)?.delete(callback);
}
export function setDocs(docs) {
  _state.docs = docs;
  emit('docs:changed', { docs: _state.docs });
}
// Fields that affect a doc's position in the tree/swimlane it's rendered in
// (rank/order, parent, PI section, or type). A change limited to any other
// field (title, status, story points, sprint, team, ...) can be patched onto
// the existing row in place — see list-filters.ts's patchSingleDoc().
const STRUCTURAL_FIELDS = ['rank', 'parentFilename', 'fixVersion', 'docType'];
export function upsertDoc(doc) {
  const idx = _state.docs.findIndex((d) => d.filename === doc.filename);
  const prev = idx !== -1 ? _state.docs[idx] : null;
  if (idx !== -1) _state.docs[idx] = doc;
  else _state.docs.push(doc);
  emit('doc:upserted', { doc });
  const structural = !prev || STRUCTURAL_FIELDS.some((f) => prev[f] !== doc[f]);
  emit('docs:changed', { docs: _state.docs, changedFilename: doc.filename, structural });
}
export function removeDoc(filename) {
  _state.docs = _state.docs.filter((d) => d.filename !== filename);
  emit('doc:removed', { filename });
  emit('docs:changed', { docs: _state.docs });
}
export function setPiSettings(settings) {
  _state.piSettings = settings;
  emit('piSettings:changed', { settings });
}
//# sourceMappingURL=store.js.map
