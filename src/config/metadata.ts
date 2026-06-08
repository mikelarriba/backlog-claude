// ── Centralized team and work category definitions ────────────────────────────
// Single source of truth for allowed Team and Work_Category field values.
// Adding a new team/category requires a change only here.

export const TEAMS = ['Backend', 'Frontend', 'Platform', 'Testing', 'UX'];

export const WORK_CATEGORIES = [
  'User Features',
  'Platform Features',
  'Testing Features',
  'Platform Maintenance',
  'Technical Debt',
];

// ── Team → JIRA label mapping ─────────────────────────────────────────────────
// Maps local Team names to the corresponding JIRA label.
// Note: Platform maps to MIDAS_DevOps (not MIDAS_Platform) by convention.
export const TEAM_TO_JIRA_LABEL: Record<string, string> = {
  Backend: 'MIDAS_Backend',
  Frontend: 'MIDAS_Frontend',
  UX: 'MIDAS_UX',
  Platform: 'MIDAS_DevOps',
  Testing: 'MIDAS_Testing',
};

// All possible MIDAS team label values (used to strip old team labels)
export const ALL_TEAM_JIRA_LABELS = new Set(Object.values(TEAM_TO_JIRA_LABEL));

// Reverse mapping: JIRA label → local Team name
export const JIRA_LABEL_TO_TEAM: Record<string, string> = Object.fromEntries(
  Object.entries(TEAM_TO_JIRA_LABEL).map(([team, label]) => [label, team])
);
