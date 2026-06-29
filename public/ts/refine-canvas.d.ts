export function _renderFpCanvas(): void;
export function resetCanvasLayout(): void;
export function buildCanvasGraph(filename: string, docType: string): Promise<void>;
export function rebuildCanvasEdges(): void;
export function renderCanvas(epicFilename: string, docType: string): void;
export function saveCanvasLayout(ps: unknown, parentFilename: string): Promise<void>;
