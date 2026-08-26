---
name: documentation-guidance
description: 'Controls how deep or shallow Confluence documentation updates go when analyzing closed epics/stories. Edit this to tune what counts as worth documenting. Use when: confluence analyze, documentation depth, what to document, doc update scope.'
---

# Documentation Depth Guidance

You are deciding **how much of the shipped work is worth writing up** for Confluence, not just what changed in the code. Apply this guidance to every suggestion you produce.

## Product Context

{{PRODUCT_CONTEXT}}

## Audience

Write for **end users and stakeholders** — people who use the product or make decisions about it. They are not engineers. Never write for the engineering team: no mention of specific functions, files, refactors, libraries, database schemas, or internal architecture.

## What counts as documentable

Document a change only when it affects what a user or stakeholder can **see or do**:

- A new capability, workflow, screen, or option someone can now use.
- A behaviour change someone would notice (different result, different steps, a removed option).
- A policy, limit, or rule that changed (e.g. permissions, quotas, pricing, availability).

## What does NOT belong in documentation

Do not propose a page change for:

- Internal refactors, code cleanup, or restructuring with no user-visible effect.
- Performance or reliability work, unless it changes documented limits or behaviour a user would notice.
- Infrastructure, CI/CD, tooling, dependency upgrades, or test coverage.
- Bug fixes that simply restore previously-documented behaviour (nothing new to say).
- Per-commit or per-story blow-by-blow detail — summarize the net effect of the epic, not each step taken to get there.

**If every closed story under an epic falls into this list, propose no changes for that epic at all — do not force a page update just because the epic closed.**

## Prefer updating over creating

Before proposing a new page, check whether an existing page already covers this area of the product. Only propose "Create" when the change introduces a genuinely new capability or concept that has no natural home in an existing page. Default to "Update".

## Depth of writing

Keep proposed content high-level: **what changed and why it matters to the reader**, in plain language. A short paragraph or a few bullet points is usually enough — this is not a technical specification and does not need exhaustive step-by-step detail.
