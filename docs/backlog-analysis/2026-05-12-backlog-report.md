---
Generated: 2026-05-12
Files_Reviewed: 32
Status: Draft
---

# Backlog Analysis Report — 2026-05-12

Delta-style report. Three meaningful changes since `2026-05-11-backlog-report.md`:

1. **New story:** `stories/2026-05-11-update-endpoint-for-v2-unified-experience.md` (EAMDM-10522).
2. **Story-to-story dependency links added** between `stories/2026-04-29-upload-api-v2---support-mdp-update.md` and `stories/2026-04-29-upload-api-v2---update-internal-partner-processing.md` — first use of `Blocks` / `Blocked_By` frontmatter in the backlog.
3. No epics, features, or bugs changed. Cleanup items from 2026-05-09 remain untouched (3 test fixtures + 1 mis-filed epic still in `docs/bugs/`).

## Executive Summary

- **First use of `Blocks` / `Blocked_By` frontmatter — small but real progress on dependency tracking.** The two linked stories are correctly paired. Recommend extending this pattern: at least the Download API epic's 14 spikes and the new Download UI story (EAMDM-10519) should declare blocking relationships explicitly.
- **New story is well-formed but unlinked to a parent epic.** EAMDM-10522 has full COVE + Gherkin AC + Out of Scope, but `Epic_ID` is missing. From its Context, it almost certainly belongs under `epics/2026-04-29-promote-and-streamline-user-adoption-of-upload-v2.md` ("V2 Unified Experience"). Set the link.
- **The two newly-linked stories are themselves stubs.** `support-mdp-update.md` and `update-internal-partner-processing.md` have JIRA paste artefacts (`(on)`, `(+)`, `(/)`, `(!)`) and no COVE structure — adding a dependency link to two stub stories preserves the sequencing but defers the real refinement.
- **Carry-over cleanup still open from 2026-05-09 P1.** Five days now without the four-item mechanical pass.

## Findings by New / Changed File

### Update GET /query/attributes endpoint — `stories/2026-05-11-update-endpoint-for-v2-unified-experience.md`
- **Dependencies:** `Epic_ID` not set. Context names "V2 Unified Experience" — set `Epic_ID: 2026-04-29-promote-and-streamline-user-adoption-of-upload-v2.md` unless a more specific parent is intended.
- **Refinement proposals:** AC2 lists "all fields: id, name, attribute_name, data_type, category" — but AC2's Given/Then implies the response *must* contain these exact 5 fields. Confirm whether other fields may exist (the Execution step 3 says "and any others"). Either tighten AC2 to "at minimum these fields" or remove the "and any others" hedge from Execution.
- **Technical issues:** Out of Scope says "Impact to search/query functionality or OpenSearch indexes" — that's an exclusion, but if `attribute_name` becomes a queryable field in the future, OpenSearch mapping will need updating. Note this as a future-work consideration.
- **Estimation concerns:** Small, single-endpoint change with FE+BE coupling. Estimable now — likely 2–3 SP. Should not be `TBD`.

### Upload API V2 — MDP Update & Internal Partner Processing (now linked) — `stories/2026-04-29-upload-api-v2---support-mdp-update.md` + `stories/2026-04-29-upload-api-v2---update-internal-partner-processing.md`
- **Dependencies:** Correctly paired via `Blocks` / `Blocked_By` — the partner-processing update waits for the MDP/API documentation update. Good sequencing.
- **Refinement proposals:** Both stories use JIRA wiki-markup leftovers (`(on)`, `(+)`, `(/)`, `(!)`) instead of Markdown. Convert to COVE: Context (why migrate IAV / partner processing now), Objective (what specifically), Value (faster + more stable processing — already stated), Execution (V2 work, list of integration touchpoints), Gherkin AC, Out of Scope. Currently neither has Gherkin AC or Out of Scope.
- **Technical issues:** `support-mdp-update.md` says "ensure that upload api v1 and v2 work in parallel" — this is a real V1/V2 coexistence requirement and should be a top-level AC, not a bullet inside an unsstructured story body. Likely also needs a feature-flag or version-routing AC.

## Cross-cutting Findings

- **Linking discipline is starting to appear.** Two stories now use `Blocks`/`Blocked_By`. Apply the same pattern to (a) Download API epic ↔ its 14 spikes, (b) Download UI story (EAMDM-10519) ↔ Download API epic, (c) the three export-pipeline bugs ↔ the still-to-open Export Pipeline epic.
- **No progress on any carry-over item.** Six daily reports now; the 2026-05-06 P1 list is 6 days old, the 2026-05-09 mechanical cleanup is 3 days old. If the backlog is the source of truth, this stasis is a real signal — escalate at next PO/TL sync rather than restating the list again.

## Recommended Next Actions

**P1 — today**
1. Set `Epic_ID: 2026-04-29-promote-and-streamline-user-adoption-of-upload-v2.md` on the new EAMDM-10522 story.
2. (Carry-over) Run the four-item mechanical triage: delete 3 test-fixture bugs, move mis-filed datapool-rename epic to `docs/epics/`, dedupe `check-impersonation-role.md`, set `Epic_ID` on the four orphan bugs.

**P2 — at refinement**
3. Convert the two newly-linked Upload V2 stories (EAMDM-7372, EAMDM-7370) to COVE format with Gherkin AC and Out of Scope.
4. Promote "ensure upload api v1 and v2 work in parallel" from a bullet to a top-level AC in `support-mdp-update.md`.
5. Estimate SP on the new EAMDM-10522 story (likely 2–3).
6. Carry forward all unaddressed items from prior reports (2026-05-06 onward).

**P3 — open spikes**
7. (No new spike needed today.) Carry-over spike list unchanged.
