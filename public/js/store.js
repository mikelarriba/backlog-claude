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
    if (!_listeners.has(event))
        _listeners.set(event, new Set());
    _listeners.get(event).add(callback);
    return () => _listeners.get(event)?.delete(callback);
}
export function setDocs(docs) {
    _state.docs = docs;
    emit('docs:changed', { docs: _state.docs });
}
export function upsertDoc(doc) {
    const idx = _state.docs.findIndex((d) => d.filename === doc.filename);
    if (idx !== -1)
        _state.docs[idx] = doc;
    else
        _state.docs.push(doc);
    emit('doc:upserted', { doc });
    emit('docs:changed', { docs: _state.docs });
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
