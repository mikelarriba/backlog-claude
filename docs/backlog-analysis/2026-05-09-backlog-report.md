---
Generated: 2026-05-09
Files_Reviewed: 31
Status: Draft
---

# Backlog Analysis Report — 2026-05-09

Delta-style report. Seven files were genuinely new since `2026-05-08-backlog-report.md`; the rest of the touched files are spurious mtime updates from a tool-side commit (verified via `git log` — no doc-content commits). All 12 epics, 1 feature, and the prior 7 bugs are unchanged. None of the carry-over P1/P2/P3 items from prior reports have been actioned in the docs yet.

## Executive Summary

- **Three test-fixture bug files have polluted the production backlog folder** (`bugs/2026-05-08-ir-00001-log-file-test.md`, `bugs/2026-05-08-ir-12345-test-bug.md`, `bugs/2026-05-08-ir-99999-no-attachment-test.md`). They have `JIRA_ID: TBD`, descriptions like "Testing" or "_No description provided._", and were clearly created while exercising the bug-creation feature of the backlog tool itself. They must be deleted before the next backlog review or they will appear in JIRA-search and skew counts.
- **One file is mis-filed as a bug but is actually a COVE Epic.** `bugs/2026-05-08-remove-dash-from-all-names-in-datapools-and-tests.md` ("Fix Invalid Characters in Datapool and File Names") has full Context/Objective/Value/Execution/AC/Out of Scope and proposes a one-shot data-migration cron job. Move it to `docs/epics/` and renaming the slug; otherwise it gets lost in bug triage.
- **Two new real export-pipeline bugs share a likely root cause and have no parent epic.** `bugs/2026-05-08-ir31599219-issues-with-manual-data-provision-reque.md` and `bugs/2026-05-08-ir31599655-error-providing-a-measurement-in-midas.md` both involve the **manual data provisioning / export pipeline** (`midas.wf.exp.smb-export-sta-…` log files in attachments). Neither has `Epic_ID` set. There is no Export-pipeline epic in the backlog at all — this is a coverage gap.
- **First properly-linked story has appeared** — `stories/2026-05-08-adapt-ui-download-file-to-new-api.md` correctly sets `Epic_ID` to the Download API epic, uses Gherkin AC, and has Out of Scope. But it likely covers more than one sprint of work (download + pause + resume + cancel + compression in one story) and makes an unverified assumption about backend pause/resume already existing.
- **Carry-over still open:** KLDAP→Spectrum child epics not created; impersonation duplication unresolved; GitHub Migration and Change-output-to-V2 stubs unchanged; bug→epic linking still inconsistent (3 of 7 production bugs lack `Epic_ID`); no SP estimates landed anywhere; 2.7.1 Download API rollback/feature-flag decision not visible in any doc.

## Findings by New File

### IR31599219 — Manual data provisioning request stuck in queue — `bugs/2026-05-08-ir31599219-issues-with-manual-data-provision-reque.md`
- **Vulnerabilities:** A queued export request that "is in the queue, but nothing is happening" with no user-visible failure mode is exactly the kind of silent partial-failure path that the V2 RabbitMQ migration is meant to fix. In V1 (NiFi-driven) it can sit forever. Add monitoring/alerting AC at the parent epic level (which doesn't exist yet — see below).
- **Dependencies:** Needs an export-pipeline epic to be linked to — none exists. Also potentially related to the NiFi→RabbitMQ migration (V2 work).
- **Refinement proposals:** Set `Epic_ID` once an Export Pipeline epic is created (P1 below). Add the static-export pod log filename to the bug body so engineering can correlate.
- **Technical issues:** The attached log filename `midas.wf.exp.smb-export-sta-bvx5t-static-export-tmpl-1406042576-main.log` strongly suggests this is a NiFi/static-export pipeline path. If V2 is meant to replace this, raise the bug's priority — fixing in V1 is throwaway work.

### IR31599655 — Error providing a measurement — `bugs/2026-05-08-ir31599655-error-providing-a-measurement-in-midas.md`
- **Dependencies:** Same family as IR31599219 (same `static-export-tmpl-…-main.log` attachment pattern). Triage these together; likely shared root cause in the V1 NiFi export pipeline.
- **Refinement proposals:** Bug body says "[Screenshot]" placeholder but no screenshot is embedded — only PDF and log are attached. Either embed the screenshot or remove the `[Screenshot]` placeholder. Capture the error message text in plain text in the body so it's grep-able.
- **Estimation concerns:** N/A until triaged jointly with IR31599219.

### Fix Invalid Characters in Datapool and File Names — `bugs/2026-05-08-remove-dash-from-all-names-in-datapools-and-tests.md` ⚠ **mis-filed**
- **Refinement proposals:** This is not a bug. It is a fully-formed COVE Epic for a one-shot data-cleanup cron job (full Context/Objective/Value/Execution/AC/Out of Scope, EAMDM-9805, Priority Minor, V1 work). **Move to `docs/epics/`** and rename the file slug accordingly so it surfaces in epic-level views and refinement.
- **Vulnerabilities:** Renaming datapools at the storage layer while updating OpenSearch and DB references is a classic source of partial-failure data drift. The Execution mentions "rollback capability" via the audit log but the AC does not cover failure modes — add: "Given a rename fails mid-flight, when the cron job retries, then no record is left referencing both the old and new name simultaneously."
- **Dependencies:** Touches OpenSearch indexes — name them. Touches the DB layer — confirm whether MIDAS V1 or V2 schema. Impacts (and could be implicitly required by) `epics/2026-05-04-migration-assessment-and-planning-for-midas-to-azu.md` if AzureLocal storage doesn't tolerate the same characters.
- **Technical issues:** The U+2013 (en dash) and U+2014 (em dash) entries imply existing data already contains characters that look identical to ASCII hyphen-minus — tests by name will silently fail to match. Add an AC that disambiguates these in audit logs.
- **Estimation concerns:** Despite the COVE structure, `Story_Points: TBD`. Sufficient detail to estimate today.

### Adapt UI Download File to New API — `stories/2026-05-08-adapt-ui-download-file-to-new-api.md`
- **Vulnerabilities:** AC4 says "the file is compressed (ZIP or equivalent) by default" — but ZIP-compressing a multi-GB binary measurement file gives near-zero size reduction and adds CPU/latency. Confirm with users whether default-on compression is desired, and whether it should be opt-in for files above a threshold. Also: the new file-size discrepancy bug (IR31591525, see `2026-05-08-backlog-report.md`) is *suspected* to be related to compressed-vs-raw downloads — implementing compression here without first resolving that bug will compound the issue.
- **Dependencies:** Correctly links to `epics/2026-05-05-new-download-api---resumable-large-file-downloads-.md` via `Epic_ID`. Step 3 of Execution says "Backend: Integrate pause/resume/cancel handlers with the new Download API endpoint (should already exist in V2)" — that "should already exist" is unverified. If it doesn't exist, this is now also a backend story. Verify before sprint.
- **Refinement proposals:** Split the story. Currently it bundles: (a) switch UI to new API, (b) pause, (c) resume, (d) cancel, (e) compression default. Each AC is a deliverable; sprint-sizing recommendation is to split into at least two stories (basic switchover + control surface). A 5-AC story with frontend+backend coupling won't fit a 3-week sprint comfortably.
- **Technical issues:** Out of Scope says "RabbitMQ queue setup (backend team responsibility)" — implying this story or its parent is async. The parent Download API epic does not describe any RabbitMQ usage. Either remove the RabbitMQ reference here or update the parent epic to declare async/queueing in Execution. They must agree.
- **Estimation concerns:** `Story_Points: TBD` with five distinct ACs spanning frontend and backend — almost certainly larger than a single sprint as written.

### Test-fixture pollution — three files
- `bugs/2026-05-08-ir-00001-log-file-test.md`, `bugs/2026-05-08-ir-12345-test-bug.md`, `bugs/2026-05-08-ir-99999-no-attachment-test.md`
- These are leftovers from exercising the bug-creation feature of the backlog tool. They are not real bugs.
- **Action:** Delete them. Going forward, run tool tests against `tests/fixtures/` or set `TEST_DOCS_ROOT` rather than writing into the live `docs/bugs/` folder.

## Cross-cutting Findings

- **Export pipeline coverage gap.** Two new production bugs, plus the carry-over IR31532952 (re-upload blocked because system says data already uploaded), all touch the **manual data provisioning / export** flow. There is no Export-pipeline epic in `docs/epics/` and no NiFi→RabbitMQ migration epic for the export path. This is now an obvious coverage hole — recommend opening one.
- **Bug→epic linking is still inconsistent.** Of the 7 production bugs in `docs/bugs/`, only 3 have `Epic_ID` set (the two attached to Promote-Upload-V2 and the parallel-download crash). Yesterday's recommendation to do a one-time sweep is still valid; today it grew by two more orphans.
- **Backlog folder hygiene.** The presence of test-fixture bugs and a mis-filed epic suggests the doc-creation flows aren't enforcing folder placement. Worth a small tool-side check (out of scope for this report, but flag it to the dev team).
- **The new story is the first one to use `Epic_ID` *and* full COVE *and* Gherkin AC.** Use it as the template when adding KLDAP→Spectrum child epics and when expanding the GitHub Migration / Change-output-to-V2 stubs.

## Recommended Next Actions

**P1 — today**
1. Delete the three test-fixture bugs (`ir-00001-log-file-test`, `ir-12345-test-bug`, `ir-99999-no-attachment-test`).
2. Move `bugs/2026-05-08-remove-dash-from-all-names-in-datapools-and-tests.md` to `docs/epics/` and rename it (e.g. `2026-05-08-fix-invalid-characters-in-datapool-and-file-names.md`). Update its body title from "Bug" framing if any.
3. Open a new Epic: **"Stabilise Manual Data Provisioning / Export Pipeline (V1 → V2)"**. Link `bugs/2026-05-08-ir31599219`, `bugs/2026-05-08-ir31599655`, and (carry-over) `bugs/2026-05-05-ir31532952` to it via `Epic_ID`. Decide whether the fixes go in V1 or are blocked on the V2 RabbitMQ-based export rewrite.
4. Set `Epic_ID` on the remaining unparented bugs once their parent epics exist.

**P2 — at refinement**
5. Split `stories/2026-05-08-adapt-ui-download-file-to-new-api.md` into at least two stories: (a) UI cutover to new endpoint + cancel; (b) pause/resume + compression. Verify backend pause/resume *actually* exists before committing the second story.
6. Reconcile RabbitMQ language between `stories/2026-05-08-adapt-ui-download-file-to-new-api.md` Out-of-Scope and the parent Download API epic Execution — either both mention async/queueing or neither does.
7. Carry forward all unaddressed items from `2026-05-06`, `2026-05-07`, and `2026-05-08` reports.

**P3 — open spikes**
8. Spike: "Triage IR31599219 + IR31599655 jointly — shared root cause in static-export pipeline?" Time-box 2 days. Outcome decides whether one or two fixes.
9. Spike: "Default-on compression for the new Download API: cost vs benefit on multi-GB measurement files." Resolves AC4 of the new download UI story before implementation.
10. Carry-over spikes still open: OIDC vs SAML for Spectrum, KLDAP→Spectrum role-equivalence diff, desktop token-refresh storage, DAPc→AzureIdentity mapping, multi-provider delivery permissions, Download API root-cause (parallel crash + size discrepancy).
