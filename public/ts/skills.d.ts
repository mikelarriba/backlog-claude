export function loadSkillsView(): Promise<void>;
export function toggleSkillCard(name: string): void;
export function saveSkill(name: string): Promise<void>;
export function resetSkill(name: string): Promise<void>;
export function improveSkill(name: string): Promise<void>;
export function saveProductContext(): Promise<void>;
export function resetProductContext(): Promise<void>;
export function handleSkillSSE(payload: unknown): void;
