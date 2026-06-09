export function loadDocs(): void;
export function loadPiSettings(): Promise<void>;
export function loadJiraVersions(): Promise<void>;
export function contextSplitItem(filename: string, docType: string): void;
export function closeIssueSplitModal(): void;
export function executeSplitIssue(): void;
