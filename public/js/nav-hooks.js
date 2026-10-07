let _openDoc = null;
let _focusEpic = null;
export function registerOpenDoc(fn) {
  _openDoc = fn;
}
export function registerFocusEpic(fn) {
  _focusEpic = fn;
}
export function openDoc(filename, docType) {
  void _openDoc?.(filename, docType);
}
export function focusEpic(filename) {
  _focusEpic?.(filename);
}
//# sourceMappingURL=nav-hooks.js.map
