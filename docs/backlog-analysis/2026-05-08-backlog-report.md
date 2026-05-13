---
Generated: 2026-05-08
Files_Reviewed: 24
Status: Draft
---

# Backlog Analysis Report — 2026-05-08

Delta-style report. The only content change since `2026-05-07-backlog-report.md` is one new bug — `bugs/2026-05-08-ir31591525-am-bi-midas-discrepancy-of-file-sizes-b.md`. All 12 epics, 1 feature, and prior 4 bugs are unchanged on disk. None of yesterday's or 2026-05-06's P1/P2/P3 actions have been reflected in the docs yet (every epic still TBD on SP/Squad/PI/Sprint; GitHub Migration and Change-output-to-V2 stubs unchanged; duplicate impersonation epic still present; KLDAP→Spectrum still has no child epic files).

## Executive Summary

- **New production bug ties directly to the new Download API epic and is a data-integrity signal.** IR31591525 reports file-size discrepancies between direct download (the new `/files/:id/download` path) and the Isilon-link export, on Release 2.7.1 — the same release as the existing parallel-download crash bug (EAMDM-9821). Two production data-quality incidents on 2.7.1 in a fortnight is a pattern worth raising at the next quality gate.
- **The new bug has no `Epic_ID` set.** It should be linked to `epics/2026-05-05-new-download-api---resumable-large-file-downloads-.md` (sibling bug `2026-05-05-download-api-crashes-…` already is).
- **All carry-over findings remain open.** Yesterday's P1/P2/P3 list (KLDAP child epics, impersonation duplication, GitHub Migration stub, Change-output-to-V2 stub, RabbitMQ/OpenSearch/Out-of-Scope sweeps, IR31532952 ↔ File Alias linkage) is still unaddressed.

## Findings by Bug

### IR31591525 — File-size discrepancy: direct download vs. Isilon export — `bugs/2026-05-08-ir31591525-am-bi-midas-discrepancy-of-file-sizes-b.md`

- **Vulnerabilities:** A silent file-size mismatch on a primary download path is a **data-integrity** issue, not a performance issue. If users archive or analyse files downloaded via the test-detail view, they may be operating on truncated or incorrectly-buffered data without knowing it. Worst case for a VW-internal context: legal-hold/test-evidence chains relying on file integrity.
- **Dependencies:**
  - Belongs under `epics/2026-05-05-new-download-api---resumable-large-file-downloads-.md` (the new download endpoint is the proximate cause). Set `Epic_ID` accordingly.
  - May also implicate `epics/2026-05-05-file-alias-management-for-deduplicated-content-in-.md` if the canonical-vs-alias resolution returns the wrong file on the new path; rule this out as part of triage.
  - Possibly correlates with the parallel-download crash bug (`bugs/2026-05-05-download-api-crashes-when-running-5-7-downloads-in.md`) — same release, same endpoint family. If concurrent download path corrupts buffers under memory pressure, both bugs could share a root cause.
- **Refinement proposals:**
  - Set `Priority` higher than Medium — data integrity on a production endpoint typically warrants High at minimum until ruled out as cosmetic (e.g. zip wrapper vs raw bytes). Confirm during triage.
  - Capture the *exact* mismatch shape in the bug body: is the direct-download file larger, smaller, byte-identical-but-different-on-disk-due-to-zip-vs-raw? The summary doesn't say. Without that, root cause analysis is guesswork.
  - Add an explicit Acceptance Criterion to the parent Download API epic: "byte-for-byte equality between the new direct-download endpoint and the canonical Isilon export for the same file ID, verified by SHA-256 in integration tests."
- **Technical issues:**
  - Common root causes for this class of discrepancy: (a) range-read off-by-one (relevant — see the 14 `be-buh-*` range-read spikes); (b) compressed-vs-uncompressed mismatch (the `be-buh-implement-option-to-download-compressed-fil` spike is suggestive); (c) trailing-byte truncation when stream closes early; (d) text-mode vs binary-mode write on the client. Triage should explicitly check (a) and (b) first.
  - Strengthens yesterday's recommendation that the Download API epic needs a **byte-equality** AC and an integration test that catches this regression.
- **Estimation concerns:** N/A until triaged.

## Cross-cutting Findings

- **Release 2.7.1 has two production bugs (EAMDM-9821 parallel-download crash, EAMDM-10518 file-size discrepancy) — same release, same area.** Either: (a) the Download API rollout was under-tested and a 2.7.x patch is warranted, or (b) the new endpoint should be feature-flagged off until the new epic's stories land. Decide explicitly.
- **No new RabbitMQ / OpenSearch / Out-of-Scope progress.** The findings from `2026-05-06-backlog-report.md` Cross-cutting section remain valid verbatim.
- **The bug-to-epic linking gap is now systemic.** IR31532952 (2026-05-05) was flagged on day one as needing linkage to File Alias Management — still not linked. IR31591525 (today) needs linkage to the Download API epic. Recommend a one-time sweep adding `Epic_ID` to all bugs in `docs/bugs/`, then a habit of setting it on creation going forward.

## Recommended Next Actions

**P1 — today**
1. Triage `bugs/2026-05-08-ir31591525-am-bi-midas-discrepancy-of-file-sizes-b.md`: capture the exact size-difference shape (signed delta, sample file IDs, both sizes), then decide priority.
2. Set `Epic_ID: 2026-05-05-new-download-api---resumable-large-file-downloads-.md` on the new bug. While at it, set `Epic_ID: 2026-05-05-file-alias-management-for-deduplicated-content-in-.md` on `bugs/2026-05-05-ir31532952-missing-measurement-data-under-test-id-.md` (carry-over from 2026-05-06 P1).
3. Decide whether Release 2.7.1's Download API endpoint needs a feature flag / partial rollback while the two open bugs are investigated.

**P2 — at refinement**
4. Add a byte-equality Acceptance Criterion to `epics/2026-05-05-new-download-api---resumable-large-file-downloads-.md`: "the new direct-download endpoint produces byte-identical output to the legacy Isilon export, verified by SHA-256 in integration tests." Add a corresponding integration-test story.
5. Carry forward all unresolved items from `2026-05-06-backlog-report.md` and `2026-05-07-backlog-report.md` (KLDAP child epics, impersonation duplication, GitHub Migration stub, Change-output-to-V2 stub, OIDC vs SAML, RabbitMQ/OpenSearch/Out-of-Scope sweeps, estimation hygiene).

**P3 — open spikes**
6. Open a spike: "Root-cause analysis: Download API file-size discrepancy and parallel-download memory exhaustion — shared root cause?" Time-box 3 days. Outcome decides whether the two bugs are one fix or two.
7. Carry-over spikes still open: OIDC vs SAML for Spectrum, KLDAP→Spectrum role-equivalence diff, desktop token-refresh storage, DAPc→AzureIdentity mapping, multi-provider delivery permissions.
