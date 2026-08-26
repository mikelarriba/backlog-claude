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

// An epic plus its closed children (#556): grouping used in epic mode so the
// prompt reasons over what actually shipped under each epic, not just the
// epic's own summary/description.
export interface ConfluenceAnalysisEpicGroup {
  epic: ConfluenceAnalysisIssue;
  children: ConfluenceAnalysisIssue[];
}

// A single existing Confluence page, passed in by the route (#557) once it
// has looked up the space's real page tree — grounds Update/Delete
// suggestions in actual titles instead of the AI guessing at them.
export interface ConfluenceExistingPage {
  title: string;
  hierarchyPath: string;
}

function renderIssueSection(i: ConfluenceAnalysisIssue, headingLevel: '###' | '####'): string {
  return `${headingLevel} ${i.key}: ${i.summary || '(no summary)'}\n${i.description.trim() || '_No description provided._'}`;
}

function renderEpicGroup(group: ConfluenceAnalysisEpicGroup): string {
  const epicSection = renderIssueSection(group.epic, '###');
  const childrenSection =
    group.children.length > 0
      ? group.children.map((c) => renderIssueSection(c, '####')).join('\n\n')
      : '_No closed child stories — this epic has no shipped work in scope._';
  return `${epicSection}\n\nClosed child stories (what actually shipped under this epic):\n${childrenSection}`;
}

// `epics` (epic mode, #556) takes precedence over the flat `issues` list
// (search mode, unchanged since #371) when both are present — callers should
// only ever pass one or the other. When `epics` is omitted/empty, this
// renders identically to the pre-#556 flat-issues prompt.
export function buildConfluenceAnalysisPrompt(opts: {
  issues?: ConfluenceAnalysisIssue[];
  epics?: ConfluenceAnalysisEpicGroup[];
  existingPages?: ConfluenceExistingPage[];
  documentationGuidance?: string;
}): string {
  const { issues, epics, existingPages, documentationGuidance } = opts;
  const useEpics = Boolean(epics && epics.length > 0);
  const hasExistingPages = Boolean(existingPages && existingPages.length > 0);
  const hasGuidance = Boolean(documentationGuidance && documentationGuidance.trim());

  const contextLabel = useEpics ? 'Epics and their closed stories' : 'JIRA issues';
  const contextBlock = useEpics
    ? (epics as ConfluenceAnalysisEpicGroup[]).map(renderEpicGroup).join('\n\n---\n\n')
    : (issues ?? []).map((i) => renderIssueSection(i, '###')).join('\n\n');

  const epicGuidance = useEpics
    ? "\n\nFor each epic, base your analysis on the actual shipped work described in its closed child stories — not just the epic's own summary. If an epic's closed children represent only internal/technical work with no user-facing or documentable change, propose no changes for that epic."
    : '';

  // #557: when the route has looked up the space's real page tree, ground
  // Update/Delete suggestions in it and drop the "not yet implemented"
  // disclaimer. Without a page list (Confluence unconfigured, listing
  // failed, or an empty space) this renders identically to the pre-#557
  // prompt, preserving back-compat for the epics-mode/flat-issues-mode
  // prompts introduced in #556.
  const readAccessBlock = hasExistingPages
    ? `Here is the current Confluence page tree in this space (existing pages you may target with "Update" or "Delete"):
${(existingPages as ConfluenceExistingPage[])
  .map((p) => `- ${p.title}${p.hierarchyPath ? ` (${p.hierarchyPath})` : ''}`)
  .join('\n')}

For "Update" or "Delete" actions, "pageTitle" MUST be an EXACT existing title from the list above (and "hierarchyPath" its listed path) — do not invent or rename an existing page. Only use "Create" for pages that genuinely do not exist in the list above. You do not have each page's body, only its title and location, so set "currentContent" to an empty string (or a short note that current content is unavailable) — do not invent existing content. Put your effort into "proposedContent": your best proposal for what the page should contain (or, for "Delete", why it should be removed) after this change.`
    : `Confluence read access is not yet implemented, so you cannot see existing page content. For "Update" or "Delete" actions, set "currentContent" to an empty string (or a short note that current content is unavailable) — do not invent existing content. Put your effort into "proposedContent": your best proposal for what the page should contain (or, for "Delete", why it should be removed) after this change.`;

  // #558: an editable skill (documentation-guidance) controlling how deep or
  // shallow documentation updates go — e.g. "don't document internal
  // refactors", "prefer updating an existing page over creating a new one".
  // The route loads it (already frontmatter-stripped and {{PRODUCT_CONTEXT}}-
  // substituted via loadCommand) and passes it through here. Omitted entirely
  // when not supplied so every existing call site/test renders unchanged.
  const guidanceBlock = hasGuidance
    ? `\n\nDocumentation depth guidance (this governs how much to document, and whether to document at all — follow it strictly, it overrides your own judgement about what counts as worth writing up):
---
${(documentationGuidance as string).trim()}
---
If this guidance says the shipped work is too low-level, internal, or otherwise not worth documenting, return an empty JSON array: [].`
    : '';

  return `You are a documentation analyst for the MIDAS product team. Given the JIRA issues below, identify which Confluence documentation pages need to change as a result of this work.

${contextLabel}:
---
${contextBlock}
---

${readAccessBlock}${guidanceBlock}

For each impacted Confluence page, decide one action:
- "Create" — a new page is needed that does not exist yet
- "Update" — an existing page's content needs to change
- "Delete" — an existing page is no longer needed and should be removed${epicGuidance}

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
