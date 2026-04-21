# Definition of Done — Prompt & Command Updates

This document defines what "done" means when adding or modifying a Claude skill prompt (`.claude/commands/*.md`) or any AI-generated content flow. It is aimed at the PM/PO and dev team collaborating on this tool.

---

## Why this matters

The prompts in `.claude/commands/` are part of the product. A broken prompt produces subtly wrong output — missing acceptance criteria, wrong V1/V2 labelling, incorrect frontmatter — without raising any error. Changes to prompts need the same discipline as changes to code.

---

## Checklist: adding or modifying a command prompt

### 1. Purpose is clear
- [ ] The prompt file has a YAML `description` field that explains what it does and when to trigger it (used by Claude's skill routing).
- [ ] The command name matches the filename exactly (e.g. `create-epics` → `create-epics.md`).

### 2. MIDAS context is current
- [ ] The prompt references the correct tech stack (React/TS frontend, Python backend, OpenSearch, RabbitMQ for V2).
- [ ] V1 vs. V2 distinction is explicit in the Execution section.
- [ ] Infrastructure is explicitly out of scope (no Kubernetes, no Isilon provisioning).
- [ ] Sprint and PI sizing guidance is present (3-week sprints, 4 sprints per PI).

### 3. Output format is correct
- [ ] Prompt instructs Claude to output **only** the markdown content (no prose, no file writes).
- [ ] YAML frontmatter fields match the current schema: `JIRA_ID`, `Story_Points`, `Status`, `Priority`, `Squad`, `PI`, `Sprint`, `Created`.
- [ ] Required sections are listed: Context, Objective, Value, Execution, Acceptance Criteria, Out of Scope.
- [ ] Acceptance Criteria use Gherkin format (`Given … When … Then …`).

### 4. Sample input exists
Every prompt change must include at least one sample input that validates the output. Store it as a comment block at the bottom of the `.md` file or as a dedicated fixture in `tests/fixtures/`.

**Sample input format:**
```
Title: <short title>
Idea: <2–4 sentence raw description>
Expected sections: [Context, Objective, Value, Execution, AC, Out of Scope]
Expected V1/V2 label: V2
Expected priority: High
```

### 5. Expected output documented
Describe the key properties of a correct output — not the exact text, but the invariants:

| Property | What to check |
|:---|:---|
| Frontmatter complete | All 8 fields present, `Status: Draft`, `JIRA_ID: TBD` |
| Title is action-oriented | Starts with a verb (e.g. "Add", "Migrate", "Enable") |
| V1/V2 stated | Execution section explicitly says "V1:" or "V2:" |
| Sprint-sized | Execution steps fit within 3 weeks; if not, an explicit split is noted |
| AC is Gherkin | At least 2 Given/When/Then criteria |
| Out of Scope present | Non-empty, names at least one excluded area |

### 6. Tested against the generate endpoint
Run the new/updated prompt through the UI or API and verify the output manually:

```bash
curl -s -X POST http://localhost:3000/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"idea": "<your sample idea>", "title": "<title>", "type": "epic", "priority": "High"}' \
  | jq .
```

Open the generated doc in the detail view and check:
- [ ] All sections rendered correctly in the Markdown preview.
- [ ] Status selector shows "Draft".
- [ ] JIRA push button is available.
- [ ] Upgrade panel works (enter feedback, regenerate).

### 7. Regression check
- [ ] Run `npm test` — all 57 tests must pass (unit + integration).
- [ ] Open at least one existing doc in the UI to confirm nothing regressed.

---

## Checklist: adding a new doc type

If you add a new type beyond `epic | story | spike | feature`:

- [ ] Add the type to `TYPE_CONFIG` in `server.js`.
- [ ] Create the corresponding `create-<type>.md` command prompt.
- [ ] Add the type to `TYPE_LABEL` in `public/js/state.js`.
- [ ] Add CSS badge styling in `public/css/list.css`.
- [ ] Add at least 3 integration tests in `tests/integration/api.test.js` covering: create, read, status update.
- [ ] Update `docs/architecture.md` — Document types table and data flow diagram.
- [ ] Update `README.md` — Document types table.

---

## Prompt versioning

Prompts evolve with the product. When making a significant change:

1. Record the change in the git commit message: `feat(prompt): update create-epics to require RabbitMQ event flow in V2 Execution`.
2. If the change affects what fields/sections Claude produces, run the full test suite to catch any integration test regressions.
3. If the old output format breaks existing docs (e.g. a renamed section), document a migration note in the commit body.

---

## Example: validating `create-epics.md`

**Sample input**
```
Title: Async Export Trigger
Idea: Test Engineers should be able to trigger an export that runs asynchronously. 
      Currently exports block the UI. In V2, we want to use RabbitMQ to queue the 
      export job and notify the user when it's complete via a status indicator.
```

**Expected output properties**
- `Status: Draft`, `JIRA_ID: TBD`
- Title starts with a verb: *"Enable Async Export Triggering via RabbitMQ"*
- Execution section contains: `V2:` label, references `RabbitMQ`, describes message/event flow
- At least 2 Gherkin ACs covering the async trigger and completion notification
- Out of Scope mentions infrastructure provisioning

**How to test**
```bash
# 1. Start the server
npm start

# 2. POST the idea
curl -s -X POST http://localhost:3000/api/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "idea": "Test Engineers should be able to trigger an export that runs asynchronously. Currently exports block the UI. In V2, we want to use RabbitMQ to queue the export job and notify the user when complete.",
    "title": "Async Export Trigger",
    "type": "epic",
    "priority": "High"
  }' | jq '{filename: .filename, docType: .docType}'

# 3. Open the generated file and verify
cat docs/epics/<date>-async-export-trigger.md
```

**Pass criteria**
- All 8 frontmatter fields present.
- Execution section contains "V2:" and "RabbitMQ".
- At least 2 Given/When/Then criteria.
- Out of Scope is non-empty.
