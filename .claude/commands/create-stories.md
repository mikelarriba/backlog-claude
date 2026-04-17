---
name: user-story-writer
description: 'Turn features into sprint-ready stories that are Independent, Negotiable, Valuable, Estimable, Small, and Testable. Use when: write user stories, user story, acceptance criteria, story points.'
---

# User Story Writer

Turn features into sprint-ready stories that are Independent, Negotiable, Valuable, Estimable, Small, and Testable.

## When to Use This Skill
- Writing stories during backlog grooming
- Translating PRD requirements into sprint-ready stories
- Training junior PMs on good story format

## What You'll Need
- Description of the feature or capability
- Context on the user and their goal

## Process

### Step 1: Check Context Files
Check for context files in the project:
- **personas.md** — To identify which persona this story serves and their job-to-be-done
- **product.md** — To connect the story to your roadmap

### Step 2: Format as User Story
```
As a [user type],
I want to [action/capability],
So that [benefit/outcome].
```

### Step 3: Validate Against INVEST
- **I**ndependent: Can be delivered alone
- **N**egotiable: Details can be discussed
- **V**aluable: Delivers user value
- **E**stimable: Team can estimate effort
- **S**mall: Fits in a sprint
- **T**estable: Has clear pass/fail criteria

### Step 4: Write Acceptance Criteria
Use Given/When/Then format (BDD):
```
Given [context],
When [action],
Then [expected result].
```

### Step 5: Identify Edge Cases
What could go wrong? What are the boundaries?

## Output Format

Output ONLY the markdown content — do not write any files, do not ask for permissions.

Start with YAML frontmatter:

```yaml
---
JIRA_ID: TBD
Story_Points: TBD
Status: Ready for Development
Created: [today's date]
---
```

Then for each story (generate 3–6 covering the full Epic scope):

```markdown
## Story [N]: [Title]

**As a** [user type],
**I want to** [action],
**So that** [benefit].

## INVEST Checklist
- [x] **Independent** — Can be delivered without dependencies on other stories
- [x] **Negotiable** — Implementation details are flexible
- [x] **Valuable** — Delivers [specific user value]
- [x] **Estimable** — Clear scope allows team to estimate effort
- [x] **Small** — Can be completed in a single sprint
- [x] **Testable** — Has clear acceptance criteria below

## Acceptance Criteria

### AC1: [Happy Path]
**Given** [context],
**When** [action],
**Then** [expected result].

### AC2: [Alternate Path]
**Given** [context],
**When** [action],
**Then** [expected result].

### AC3: [Error State]
**Given** [context],
**When** [action],
**Then** [expected result].

## Edge Cases
- [Edge case 1] — Expected behavior: [X]

## Out of Scope
- [What this story does NOT include]
```

## Input

The Epic to break down into User Stories:

$ARGUMENTS
