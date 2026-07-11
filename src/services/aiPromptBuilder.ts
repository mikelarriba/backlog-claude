// ── AI prompt construction helpers ────────────────────────────────────────────
// Pure functions — no I/O.  Each returns the prompt string ready for callClaude
// or streamClaude.  Route handlers supply all needed data.

import { isoDate } from '../utils/transforms.js';

export function buildGeneratePrompt(
  docType: string,
  command: string | null,
  filename: string,
  rawContent: string
): string {
  if (command) return command.replace('$ARGUMENTS', `File: ${filename}\n\n${rawContent}`);
  return `Generate a complete ${docType} using the COVE Framework. Output ONLY the markdown content.\n\nFile: ${filename}\n\n${rawContent}`;
}

export function buildUpgradePrompt(
  docType: string,
  currentContent: string,
  feedback: string,
  inboxHistory: string
): string {
  return `Rewrite the following ${docType} document applying the feedback below. The feedback is provided — apply it directly. Do NOT ask for clarification. Do NOT ask what changes are needed. Do NOT say you cannot see feedback. Output ONLY the rewritten markdown — no commentary, no preamble, no code fences.

Current document:
---
${currentContent}
---${inboxHistory}

Feedback to apply:
${feedback.trim()}

Rewrite the complete document incorporating the feedback above. Preserve all COVE sections and YAML frontmatter structure.`;
}

export function buildImprovePrompt(content: string): string {
  return `You are a prompt engineering expert. Improve the following command template that is used to instruct an AI to generate product management documents.

Improve:
- Clarity and specificity of instructions
- Output format constraints (make them stricter where helpful)
- Edge case handling (ambiguous input, missing context)
- COVE framework usage (Context, Objective, Value, Execution) if present

Preserve exactly:
- The \`$ARGUMENTS\` placeholder — it must remain in the output
- The YAML frontmatter block (between --- markers) at the top
- The \`{{PRODUCT_CONTEXT}}\` placeholder if present
- The overall document structure and section ordering

Return ONLY the improved command template — no commentary, no preamble, no explanation.

Command template to improve:

${content}`;
}

export interface ConfluenceAnalysisIssue {
  key: string;
  summary: string;
  description: string;
}

export function buildConfluenceAnalysisPrompt(opts: { issues: ConfluenceAnalysisIssue[] }): string {
  const { issues } = opts;
  const issuesBlock = issues
    .map(
      (i) =>
        `### ${i.key}: ${i.summary || '(no summary)'}\n${i.description.trim() || '_No description provided._'}`
    )
    .join('\n\n');

  return `You are a documentation analyst for the MIDAS product team. Given the JIRA issues below, identify which Confluence documentation pages need to change as a result of this work.

JIRA issues:
---
${issuesBlock}
---

Confluence read access is not yet implemented, so you cannot see existing page content. For "Update" or "Delete" actions, set "currentContent" to an empty string (or a short note that current content is unavailable) — do not invent existing content. Put your effort into "proposedContent": your best proposal for what the page should contain (or, for "Delete", why it should be removed) after this change.

For each impacted Confluence page, decide one action:
- "Create" — a new page is needed that does not exist yet
- "Update" — an existing page's content needs to change
- "Delete" — an existing page is no longer needed and should be removed

Output ONLY a JSON array — no prose, no markdown code fences, no commentary before or after — matching exactly this schema:
[
  {
    "pageTitle": string,
    "hierarchyPath": string,
    "action": "Create" | "Update" | "Delete",
    "currentContent": string,
    "proposedContent": string
  }
]

If no Confluence changes are needed, output an empty JSON array: []`;
}

export function buildSplitStoryPrompt(opts: {
  content: string;
  count: number;
  epicId: string;
  fixVersion: string;
  priority: string;
  perStorySP: number | string;
  sprintList: string;
}): string {
  const { content, count, epicId, fixVersion, priority, perStorySP, sprintList } = opts;
  return `You are splitting a user story that is too large for a single sprint into exactly ${count} smaller, independently deliverable user stories.

Original story:
${content}

Requirements:
- Split into exactly ${count} user stories
- Each story should be independently valuable and testable
- Distribute the scope evenly across all ${count} parts
- Each part MUST start with a YAML frontmatter block in this exact format (no extra fields):
---
JIRA_ID: TBD
Story_Points: ${perStorySP}
Status: Draft
Priority: ${priority}
Epic_ID: ${epicId}
Fix_Version: ${fixVersion}
Sprint: TBD
Created: ${isoDate()}
---
- After the frontmatter, write the story title as "## Title" then COVE sections (Context, Objective, Value, Execution) and Acceptance Criteria
- Sprint assignments: ${sprintList}
- Separate each story with exactly this marker on its own line: ===SPLIT===
- Output ONLY the ${count} story files separated by ===SPLIT===, nothing else`;
}
