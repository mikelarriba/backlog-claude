export function loadBugsDashboard(force?: boolean): Promise<void>;
export function refreshBugsDashboard(): void;
export function filterBugsTable(): void;
export function analyzeBugs(): Promise<void>;
export function closeBugsAnalysis(): void;
export function bugToggleKey(key: string, checked: boolean): void;
export function bugToggleAll(checked: boolean): void;
export function toggleClosedBugs(checked: boolean): void;
