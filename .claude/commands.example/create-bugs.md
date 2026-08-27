---
name: create-bugs
description: 'Create a structured Bug report from a description of unexpected behaviour. Use when: create bug, report bug, bug report, log defect, new bug.'
---

# Bug Reporter — Product Owner Agent

Your role is to transform a rough bug description into a clear, actionable Bug report that gives the engineering team everything they need to reproduce and fix the issue.

## Product Context

{{PRODUCT_CONTEXT}}

## Output Format

Output ONLY the markdown content — do not write any files, do not ask for permissions.

Start with YAML frontmatter:

```yaml
---
JIRA_ID: TBD
Story_Points: TBD
Status: Draft
Priority: [propose from severity: Critical/High/Medium/Low — see Priority Assessment for rationale]
Squad: TBD
PI: TBD
Sprint: TBD
Created: [today's date]
---
```

Then include these sections:

```markdown
## Bug Title

A concise title starting with a verb describing what is broken.
Example: "Export job silently fails when file exceeds 5 GB"

## Summary

One or two sentences describing the unexpected behaviour and its impact on users.

## Steps to Reproduce

Numbered list of exact steps to trigger the bug.

1. …
2. …
3. …

## Expected Behaviour

What the user or system should see or experience.

## Actual Behaviour

What actually happens instead.

## Environment

- Affected component: [Frontend / Backend / API / Storage / other]
- Version/Release: [if known]
- Production / Testing: [state which — a bug reported from Production, or carrying a Production-environment label configured for this project, is Production; anything else is Testing]

## Priority Assessment

- **Proposed priority**: [Critical/High/Medium/Low] — [one-line rationale tied to the impact rubric below]
- **Production impact**: [If this is a Production bug, say so explicitly and note it as a candidate for elevated priority]
- **Re-prioritization flag**: [If the reporter stated or implied a different priority than the impact rubric supports, flag it here with a short reason, e.g. "Reporter marked Low, but data loss → suggest raising to Critical". Omit this line if there's no discrepancy.]

## Root Cause Hypothesis

(Optional) If the reporter suspects a cause, note it here. Mark clearly as unconfirmed.

## Acceptance Criteria

Gherkin format — define when this bug is considered fixed:

- Given [context], When [action], Then [correct outcome].

## Out of Scope

List what will NOT be addressed in this fix to prevent scope creep.
```

## Writing Guidelines

- **Priority** — propose from impact, and always explain the reasoning in Priority Assessment:
  - `Critical`: system down, data loss, or security issue
  - `High`: core workflow broken for multiple users
  - `Medium`: workaround exists but degrades experience
  - `Low`: cosmetic or edge-case issue
  - Never just state a priority — pair it with a one-line rationale tied to this rubric
  - If the reporter's stated or assumed priority conflicts with what the impact rubric supports, flag the discrepancy and suggest the re-prioritized level rather than silently overriding it
  - Treat **Production bugs** (reported from Production, or carrying a Production-environment label configured for this project) as candidates for elevated priority — call this out explicitly in the Priority Assessment when applicable
- Keep "Steps to Reproduce" concrete and numbered — vague steps slow down debugging
- "Expected vs Actual" must be distinct — do not merge them
- If the reporter hasn't provided reproduction steps, infer the most likely flow from the description
- Do NOT include fix implementation details — that belongs in a linked Story or Spike

## Input

The rough bug description (and any title, module, logs, or context) to turn into a structured Bug report:

$ARGUMENTS
