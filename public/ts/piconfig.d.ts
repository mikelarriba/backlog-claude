export function togglePiConfigSection(id: string): void;
export function addSprintRow(pi: string): void;
export function removeSprintRow(pi: string, idx: number): void;
export function selectPiConfigTab(pi: string): void;
export function saveSprintConfig(pi: string): void;
export function saveSplitThreshold(): void;
export function loadAllSprintConfigs(): Promise<void>;
export function renderPiConfigTabs(): void;
export function _updatePiFromConfig(sectionKey: string, versionName: string): Promise<void>;
