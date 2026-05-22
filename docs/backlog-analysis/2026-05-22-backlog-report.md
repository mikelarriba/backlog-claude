---
Generated: 2026-05-22
Files_Reviewed: 0
Status: Draft
---

# Backlog Analysis Report — 2026-05-22

## Executive Summary

- **Critical: Backlog is empty.** No epics, stories, features, spikes, or bugs exist in `docs/`. The entire `docs/` tree is listed in `.gitignore`, meaning all generated backlog content is ephemeral and lost when the container restarts. The team has no durable, version-controlled backlog.
- **Critical: CLAUDE.md is gitignored.** The PO Agent persona and MIDAS product context (V1/V2, NiFi→RabbitMQ, KIRA/LDAP, sprint length, PI structure) live in `CLAUDE.md`, which is also gitignored. Every new session or deployment starts with no product context, making consistent AI generation impossible.
- **High: No reference documents found.** The skill prompt references `docs/architecture.md`, `docs/api.md`, and `docs/definition-of-done.md` as grounding documents for backlog analysis and generation. None of these exist. Without a Definition of Done, acceptance criteria on any future story cannot be verified against a shared standard.
- **Medium: Inbox is present but contains only `.gitkeep`.** The auto-processing pipeline (`inbox/` → Claude → `docs/`) is wired up in code but has never been exercised in this environment. No historical artifacts exist to validate the pipeline is working correctly.
- **Medium: No sprint configuration exists.** The `.pi-settings.json` and `.model-settings.json` files are gitignored. Sprint capacity, PI names, and the split-threshold SP value are unknown, making any future sprint distribution or dependency-ordering analysis impossible to run.

---

## Findings by Epic

No epic files were found in `docs/epics/`. The section below documents findings about the **project setup itself**, which is the only analyzable artifact in this environment.

### Project Setup — `.gitignore`

- **Vulnerabilities:** The `.gitignore` pattern `docs/` silently discards the entire product backlog on every environment reset or CI run. If the container restarts (which it will, as this is an ephemeral cloud environment), all generated epics, stories, spikes, features, and bugs are permanently lost. There is no backup or export path.
- **Dependencies:** A durable backlog storage backend (e.g., JIRA sync with `JIRA_BASE_URL`/`JIRA_API_TOKEN` configured, or a mounted volume) is a prerequisite for any meaningful backlog work. The JIRA integration exists in code but is not configured in this environment (`.env` variables are unset — confirmed by `.env.example` being present but no `.env`).
- **Refinement proposals:** Decide on one of two durable backlog strategies before creating any content:
  1. **Git-tracked:** Remove `docs/` from `.gitignore` (or add `!docs/` exception), commit backlog files directly.
  2. **JIRA-as-source-of-truth:** Configure `JIRA_BASE_URL`, `JIRA_API_TOKEN`, `JIRA_PROJECT`, `JIRA_LABEL` in the deployment environment; use JIRA push/pull as the persistence layer; keep `docs/` gitignored.
  The current setup is neither — it creates content that immediately disappears.
- **Technical issues:** The `inboxWatcher.js` uses `fs.watch`, which is not reliable across container restarts and NFS-mounted volumes. If the `docs/` directory does not persist, any work done via the inbox auto-processing pipeline is also lost.

### Project Setup — Missing Reference Documents

- **Refinement proposals:** Three documents referenced by the analysis agent prompt are missing and should be created before any backlog refinement work begins:
  - `docs/architecture.md` — should document the V1/V2 architecture boundary, NiFi vs RabbitMQ flows, OpenSearch index naming conventions, Isilon/S3 storage tiers, and KIRA/LDAP integration points.
  - `docs/api.md` — should document the Python backend API contracts that epics must conform to (request/response shapes, auth mechanisms, error codes).
  - `docs/definition-of-done.md` — should state the minimum acceptance criteria for a story to be considered done (unit test coverage, integration test, JIRA status, PO sign-off, etc.). Without this, the "Readiness traffic light" in the UI is based on story-point coverage alone, which is insufficient.
- **Estimation concerns:** Without a Definition of Done, any story-point estimate attached to a future story cannot be validated against a shared completion standard.

### Project Setup — CLAUDE.md Missing

- **Vulnerabilities:** All AI-generated backlog content (epics, stories, spikes, features, bugs) depends on the system prompt in `CLAUDE.md` to inject MIDAS product context (tech stack, persona definitions, V1/V2 rules, sprint structure). This file is gitignored. Every new container or collaborator gets a blank context, producing generic output with no MIDAS grounding.
- **Refinement proposals:** Either:
  1. Remove `CLAUDE.md` from `.gitignore` and commit it. The risk of exposing internal product detail in a public repo should be evaluated, but the file contains no secrets — only product context.
  2. Inject the MIDAS context via environment variable or a committed `docs/midas-context.md` file that is referenced by the skill prompts.

---

## Cross-cutting Findings

- **Persistence is the root cause of all findings.** Every other issue (missing epics, missing context, missing reference docs) flows from the fact that the persistence strategy for backlog content has not been decided. Once resolved, the toolchain (COVE skills, inbox pipeline, JIRA integration) is fully functional.
- **The skill prompts in `.claude/commands/` are well-structured** and faithfully encode the COVE framework, MIDAS context, and INVEST criteria. They are the strongest asset in the current setup. They reference an absolute path (`/Users/srj9o5d/Development/backlog-claude/docs/`) in `backlog-analysis-agent.md` that is hard-coded to a developer's local machine — this will silently fail in any other environment, including this one.
- **JIRA integration is code-complete but unconfigured.** The push/pull/sync routes exist and are tested. The blocker is environment variables. Once configured, this becomes the recommended persistence layer for the backlog.

---

## Recommended Next Actions

**P1 — Before any backlog work starts**

1. **Decide and implement a persistence strategy** (see Project Setup → `.gitignore` finding above). Recommended: configure JIRA credentials so push/pull is the persistence layer, and treat the `docs/` folder as a local working cache.
2. **Commit or inject `CLAUDE.md`** so all AI generation sessions have consistent MIDAS context. If committing, remove it from `.gitignore`. If not committing, inject MIDAS context via `ANTHROPIC_SYSTEM_PROMPT` or an equivalent mechanism.
3. **Fix the hardcoded path in `backlog-analysis-agent.md`** — replace `/Users/srj9o5d/Development/backlog-claude/docs/` with a relative path (`./docs/`) so the agent works in any environment.

**P2 — Within the first sprint**

4. **Create `docs/definition-of-done.md`** covering: acceptance criteria reviewed by PO, unit + integration tests passing, JIRA status set to Done, no open high-severity bugs.
5. **Create `docs/architecture.md`** documenting: V1 vs V2 boundary, RabbitMQ message flows, OpenSearch index names, KIRA/LDAP split for access control, Isilon/S3 storage tiers.
6. **Create `docs/api.md`** with the Python backend's primary endpoint contracts so epics have a concrete integration surface to refer to.

**P3 — Ongoing hygiene**

7. **Run this analysis agent weekly** (or after every sprint planning session) once backlog items exist. The current report cannot assess epic-level risks, story estimation, or dependency ordering because there are no items to assess.
8. **Configure sprint capacity** in the app's PI settings panel so the sprint distribution feature can be used for planning.
