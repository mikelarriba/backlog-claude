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
