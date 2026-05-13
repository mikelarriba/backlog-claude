---
Generated: 2026-05-06
Files_Reviewed: 22
Status: Draft
---

# Backlog Analysis Report — 2026-05-06

Scope: 12 epics, 1 feature, 4 bugs, plus reference docs in `docs/`. Stories and spikes were sampled where directly relevant to a finding (full per-story review is recommended in a follow-up pass).

## Executive Summary

- **Estimation hygiene is fleet-wide broken.** Every single epic carries `Story_Points: TBD`, `Squad: TBD`, `PI: TBD`, `Sprint: TBD`. Multiple epics are detailed enough to estimate; others are too vague to size. Distinguish *can-estimate-now* from *needs-refinement-first* before next planning.
- **Two epics are stubs and will not survive PI Planning.** `epics/2026-05-05-github-migration.md` is one sentence; `epics/2026-05-04-change-output-of-midas-for-the-users-to-use-v2.md` is one line. Both must be expanded to COVE before they're brought to refinement.
- **Two impersonation epics overlap.** `epics/2026-04-29-add-optional-impersonation-header-support-for-data.md` (EAMDM-10262) already covers role validation as the first AC; `epics/2026-04-29-check-impersonation-role.md` re-states this as a standalone epic. Risk of duplicate work, conflicting AC, two JIRA threads.
- **V2 async architecture is inconsistently applied.** The MDF Trace Aggregation Pipeline (a high-volume pipeline) and the new Download API never mention RabbitMQ; only File Alias Management does — and even there, no DLQ / retry / idempotency strategy is described.
- **AzureLocal migration is scoped as an Epic but reads like a Feature-level program.** `epics/2026-05-04-migration-assessment-and-planning-for-midas-to-azu.md` enumerates 7+ analysis tracks across the entire stack — won't fit in one PI. Either re-classify as a Feature (parent of multiple epics) or split.
- **Cross-team dependency on infra/CI-CD migration is a hidden risk.** Several stories already cite OpenShift route timeouts, gateway tuning, and Bamboo→GitHub Actions transition; none of the epics explicitly call this out as a delivery risk for PI2026.2/PI2026.3.

## Findings by Epic

### Enhancement of External Development Partners (IAVF, FEV, Bosch) — `epics/2026-04-27-enhancement-of-the-list-of-external-developmant-pa.md`
- **Vulnerabilities:** The line "configuration for partners (name, paths, etc.) should no longer be hardcoded ... should be flexibly controllable via e.g. environment-variables so that we can make adjustments WITHOUT RELEASE!" introduces a runtime-mutable trust boundary. If partner paths drive S3/Isilon access or KIRA group resolution, env-var-based config without auth/audit is a privilege-escalation risk. Add an AC: "config changes are signed/auditable, and require ops approval — they do not bypass the standard security review."
- **Dependencies:** Likely depends on the impersonation epics (partner uploads via technical users) and the Upload V2 work. None of these links are noted in the epic.
- **Refinement proposals:** (1) Replace the two `!image-…!` placeholders with actual diagrams or remove them — they currently render as broken JIRA syntax. (2) Add a `## Acceptance Criteria` Gherkin section — none exists today. (3) Add `## Out of Scope` — currently missing. (4) Clarify whether "WITHOUT RELEASE" config changes are V1 or V2 — implication on RabbitMQ topic / consumer config is unclear.
- **Technical issues:** No mention of how legacy IAV/AVL connectors will be migrated to the new env-driven model — risk of dual code paths.
- **Estimation concerns:** Detailed enough to estimate the "add IAVF/FEV/Bosch" piece (likely 5–8 SP each); the config-externalization piece is a separate story.

### Add Optional Impersonation Header Support — `epics/2026-04-29-add-optional-impersonation-header-support-for-data.md`
- **Vulnerabilities:** AC says "If LDAP is unavailable during impersonation validation; normal non-impersonated requests should continue, but impersonation requests should fail closed *unless the product owner decides otherwise*." That escape hatch is dangerous — turn it into a hard rule: impersonation must fail closed when LDAP is unavailable, full stop. Anything else is a backdoor.
- **Dependencies:** Direct overlap with `check-impersonation-role.md` (see below). Also depends on KIRA role `VWAG_MIDAS_APP_QS_IMPERSONATION` being provisioned — flag as external KIRA-team dependency.
- **Refinement proposals:** (1) Convert "h3." section markers to standard Markdown headings — currently unrendered JIRA syntax. (2) Decide on 422 vs 403 for inactive users (the epic itself says "exact code depends on your API conventions" — that's a refinement question, not an AC). (3) Specify whether `X-Impersonated-User` should be cached per request lifetime to avoid repeated LDAP hits.
- **Technical issues:** No idempotency or audit-log schema specified — "Audit logs contain both the acting technical user and the effective impersonated user" is a behavioral claim; needs a story for the audit storage/retention design.
- **Estimation concerns:** Touches Engine, Search API, Download API, Upload API, and datapool management — almost certainly larger than one PI. Split per service.

### Validate Impersonation Role as First Authorization Check — `epics/2026-04-29-check-impersonation-role.md`
- **Dependencies:** **Duplicates AC of EAMDM-10262** (the optional impersonation header epic), which already includes "If the caller lacks the impersonation role, the request is rejected" as a top-line AC.
- **Refinement proposals:** Either (a) close this as a duplicate and roll its content into EAMDM-10262's first story, or (b) explicitly re-scope this as the *implementation story* (not an epic) under EAMDM-10262. Decide before sprint planning.
- **Technical issues:** The phrase "query KIRA/LDAP for the 'impersonation' role" is imprecise — the parent epic specifies the exact KIRA role name (`VWAG_MIDAS_APP_QS_IMPERSONATION`); align them or risk divergent implementations.

### MDF Trace Aggregation Pipeline — `epics/2026-04-29-mdf-trace-aggregation-pipeline.md`
- **Vulnerabilities:** Task 8 says "OpenSearch connection config externalized (env vars or config file), not hardcoded" — good. But there's no mention of credentials handling, TLS verification, or how target indices are authorized per datapool. A pipeline writing to `tta_eaae5_ea211_phev_china` with broad write rights is a blast-radius risk.
- **Dependencies:** No mention of RabbitMQ even though this is a V2-era pipeline that processes uploads. Should this be triggered by an `mdf.uploaded` event consumed from RabbitMQ? Currently reads like a synchronous batch job. Decide async vs batch in refinement.
- **Refinement proposals:** (1) Add `## Out of Scope` (currently absent — easy scope-creep target). (2) Convert the "Tasks" tables into linked Story files under `docs/stories/` with proper frontmatter; right now estimates live inside the epic body, which double-tracks against any actual story files. (3) Tasks 4 and 5 share a cache parameter — clarify whether the cache is per-file or shared across the pipeline (concurrency hazard if shared and pipeline runs in parallel).
- **Technical issues:** Task 8 says "retry logic for transient failures (connection timeout, 429 rate-limit)" but no DLQ for permanent failures. Define what happens to a document that repeatedly fails to index (silent loss, alert, side-channel?).
- **Estimation concerns:** Sums to 27 SP across 8 tasks. Plausible for one PI for one squad, but Task 5 ("Interval Aggregation Orchestrator", 5 SP) plus Task 8 (5 SP) plus integration look like sprint-sized themselves. Confirm the SP totals don't undercount integration/test work.

### Promote and Streamline User Adoption of Upload V2 — `epics/2026-04-29-promote-and-streamline-user-adoption-of-upload-v2.md`
- **Dependencies:** Has live bugs already attached: `bugs/2026-04-29-be-further-action-is-required-after-delete-file-re.md` and `bugs/2026-04-29-fe-fix-tus-upload-resume-failure-on-network-errors.md`. Plus stories under `docs/stories/2026-04-29-fe-*` and `2026-04-29-be-bah-*`. This epic is in flight but has no explicit list of in-scope stories.
- **Refinement proposals:** (1) No `## Context / Objective / Value / Execution / Acceptance Criteria / Out of Scope` headings — uses `Context: / Outcome: / Value: / Expectations:` instead. Re-format to COVE template. (2) Add Gherkin AC for "user is directed to V2": currently only marketing-style copy. (3) The bullet list under "Inside Epic ..." should become explicit story links with file paths.
- **Estimation concerns:** Bullet list under "Inside Epic" includes "(5)" and "(2)" annotations that look like SP estimates — surface these into the linked stories' frontmatter so the epic SP rolls up correctly.

### Change Output of MIDAS for Users to Use V2 — `epics/2026-05-04-change-output-of-midas-for-the-users-to-use-v2.md`
- **Refinement proposals:** Single line of body — not refinement-ready. Cannot tell what "Change V1 from V2 to Single upload for users using the new version when is ready" means operationally. Open a refinement session to decide: is this a feature flag flip? A redirect? A removal of the V1 upload UI? Each has different scope. Do not bring to PI planning until expanded.
- **Dependencies:** Likely depends on `promote-and-streamline-user-adoption-of-upload-v2.md` reaching adoption thresholds and on `bugs/2026-04-29-fe-fix-tus-upload-resume-failure-on-network-errors.md` being fixed.
- **Estimation concerns:** Cannot estimate.

### Migration Assessment and Planning for MIDAS to AzureLocal — `epics/2026-05-04-migration-assessment-and-planning-for-midas-to-azu.md`
- **Vulnerabilities:** Mentions "DAPc authentication flow to AzureIdentity" — that mapping is a security-critical re-architecture (KIRA/LDAP integration patterns differ from AzureAD/EntraID). Treat as a discrete spike.
- **Dependencies:** External: E2 team, Cariad, local Azure team — flagged but not scoped. Internal: every other V2 epic, because async pipelines (RabbitMQ) and storage (Isilon → ?) move under it.
- **Refinement proposals:** (1) Re-classify as a **Feature** (parent of several epics: assessment spike, sizing spike, target-architecture design, migration plan, hybrid-mode evaluation). The sister file `features/2026-05-04-design-the-target-architecture-based-on-azurelocal.md` already exists — is this Epic actually a child of that Feature? Verify and link via `Feature_ID` (currently set, good). (2) Convert the seven bullets into linked Spikes, since each is an analysis activity, not delivery work.
- **Technical issues:** OpenShift workloads + MySQL + React UI all need different migration treatments; bundling them risks coupled go/no-go decisions.
- **Estimation concerns:** Cannot fit in a single PI as written. Will need at least PI2026.3 for assessment + PI2026.4 for design.

### File Alias Management for Deduplicated Content in V2 — `epics/2026-05-05-file-alias-management-for-deduplicated-content-in-.md`
- **Vulnerabilities:** Aliases scoped to "a single test within a single datapool" (Out of Scope notes cross-datapool aliases are excluded) — good. But: the canonical file may have been uploaded by a user in a different datapool; ensure the alias-creation flow doesn't leak the canonical file's existence/metadata to a user who has no rights to the original datapool. Add an AC: "alias creation only succeeds if the requester has access to the canonical file's datapool, otherwise return 404 (not 409)."
- **Dependencies:** Directly relates to `bugs/2026-05-05-ir31532952-missing-measurement-data-under-test-id-.md` ("re-upload is not possible because the system reports that the data has already been uploaded"). The bug is the production manifestation of the gap this epic closes. Link them in the bug's frontmatter and in the epic body.
- **Refinement proposals:** (1) Step 4 references "the relevant search index" without naming it — name the OpenSearch index per `CLAUDE.md` writing guidelines. (2) RabbitMQ event `alias.created` is mentioned but no DLQ, retry, ordering or idempotency rules are described — add an AC.
- **Estimation concerns:** Looks like ~2 sprints (one for backend + indexer, one for FE). Confirm.

### GitHub Migration — `epics/2026-05-05-github-migration.md`
- **Vulnerabilities:** Migrating CI/CD touches secrets storage (Bamboo variables → GitHub Actions secrets). High likelihood of credential mishandling during cutover; not mentioned anywhere.
- **Dependencies:** Blocks or interacts with every other epic that has CI/CD steps (MDF Trace, Download API, Impersonation). Should be sequenced explicitly in PI Planning.
- **Refinement proposals:** Single sentence body — not refinement-ready. At minimum, expand to: (a) repo-by-repo cutover list, (b) Bamboo plan → GitHub Actions workflow mapping, (c) secrets migration plan, (d) protected-branch policy decisions, (e) rollback strategy if cutover fails. Treat as a Feature, not an Epic.
- **Technical issues:** Per `CLAUDE.md`: "If a CI/CD step is needed, note the Bitbucket→GitHub migration status as a risk." This epic is precisely that risk; until it lands, every other epic with CI work carries it as an unmanaged dependency.
- **Estimation concerns:** Cannot estimate at current detail.

### New Download API — Resumable Large File Downloads (RFC 7233) — `epics/2026-05-05-new-download-api---resumable-large-file-downloads-.md`
- **Vulnerabilities:** "Backward compatibility for legacy files via dual-database resolution" — dual DB lookup based on filename or hash is a classic source of access-control bypass (legacy DB may have weaker per-datapool checks). Add an AC: "datapool authorization is enforced on the resolved file regardless of which DB it came from."
- **Dependencies:** Linked to bug `bugs/2026-05-05-download-api-crashes-when-running-5-7-downloads-in.md` (the production OOM at 5–7 parallel downloads is the proximate motivation) — link in epic body. Also overlaps with the impersonation epic since `X-Impersonated-User` must be honored on the new endpoint.
- **Refinement proposals:** (1) The epic has 14 `be-buh-*` spikes attached under `docs/spikes/`; none are listed in the epic body. Add a "Linked Spikes" or "Decomposition" section so the relationship is explicit. (2) State V1 vs V2 in Execution — currently implicit (it's a new API, but is it delivered under the V2 RabbitMQ-based architecture?). (3) No mention of RabbitMQ/async — confirm whether range-stream downloads are best modelled as synchronous controllers (likely yes) and document that decision.
- **Technical issues:** "Multipart byte-range responses (multipart/byteranges)" — known to be poorly supported by some clients; add an AC clarifying server fallback when client doesn't accept multipart.
- **Estimation concerns:** 14 spikes is high spike-density — suggests the team isn't yet confident on design. Resolve at least the storage/range-read spikes before SP-sizing the parent.

### Test Name Validation, Metadata Behavior, and UI Enhancements (MEST V2) — `epics/2026-05-05-test-name-validation.md`
- **Refinement proposals:** (1) No `## Context / Objective / Value / Execution / Out of Scope` — uses `As a / I want / so that` then tasks. Reformat to COVE. (2) No V1/V2 marker in Execution — title says "MEST V2" but the body doesn't anchor it. (3) Section 6 ("Future Enhancement: Multi-Provider Deliveries") is explicitly future scope but lives inside the epic — move to a separate epic or to "Out of Scope". (4) Section 2 ("Metadata Extraction Fix") has a "Pending: Check behavior and validate with business" — that's a refinement blocker, not a deliverable. Resolve before sprint.
- **Technical issues:** "Notify users or datapool owners when this occurs (UI/UX or event log)" — UI vs event log is two different implementations. Pick one in refinement.
- **Estimation concerns:** Six task groups + one future enhancement; likely too large for one sprint, possibly two sprints. Split into validation, metadata, UI subgroups.

### Desktop Uploader: Support 2TB Files — `epics/2026-05-05-upload-local-tool.md`
- **Vulnerabilities:** Phase 1 step 1 ("Token Refresh During Upload") is correct but underspecified: refreshing tokens during a 3-hour upload requires a refresh-token store on the desktop client. Add an AC for refresh-token storage (encrypted at rest, KIRA-issued) so this isn't quietly implemented as plaintext on disk.
- **Dependencies:** OneFS storage move is mentioned ("removes the part-count ceiling and enables 2 TB objects natively"). Confirm OneFS rollout is complete or sequence this epic behind it. Out of Scope correctly excludes OneFS config changes.
- **Refinement proposals:** (1) Phase 2 is labelled "V2 / Optional" — decide before PI Planning whether it is *in* the epic or split into a separate backend epic. (2) Phase 3 Documentation should be a story, not a phase, otherwise it gets dropped under sprint pressure.
- **Technical issues:** Recommendation to drop MD5 + SHA-512 (keeping only SHA-256) is correct for performance but has compliance implications if any external pipeline relies on MD5/SHA-512 manifests. Confirm with security/compliance.
- **Estimation concerns:** Phase 1 alone is sprint-plus sized. Phase 2 is multi-sprint backend work. Phase 3 is a story. Strongly recommend splitting.

## Cross-cutting Findings

- **RabbitMQ usage is sporadic.** Of the V2 epics, only File Alias Management mentions a topic. MDF Trace Aggregation, Download API, Impersonation Header, and the Upload Local Tool either don't mention messaging or treat it as out of scope. Per `CLAUDE.md`: "For async work, reference RabbitMQ explicitly and describe the message/event flow." Run a single targeted refinement session: *"For each V2 epic, is the work synchronous or async, and if async, what topic + DLQ + idempotency rule?"*.
- **OpenSearch indexes are inconsistently named.** MDF Trace Aggregation names two specific indices; File Alias Management says "the relevant search index"; the impersonation epic implies search-time filtering but doesn't name an index. Audit: every search-related epic must name the index it touches.
- **Out of Scope sections are missing on 6 of 12 epics** (`enhancement-of-…-partners`, `add-optional-impersonation-header`, `mdf-trace-aggregation`, `promote-and-streamline-…`, `change-output-of-midas-…`, `github-migration`, `test-name-validation`). Without these, scope creep at sprint planning is likely.
- **Estimation discipline is absent across the board.** Every epic carries `TBD` for SP/Squad/PI/Sprint. At minimum, the well-detailed epics (MDF Trace, File Alias, Upload Local Tool, Download API) can be SP-banded today.
- **Two stub epics (GitHub Migration, Change Output to V2) and one ambiguous-classification (AzureLocal Migration Assessment) need triage before refinement** — they will burn refinement time otherwise.
- **Suggested PI sequencing nudge:** GitHub Migration is a *prerequisite-style* dependency for any epic that adds CI/CD steps (Download API, Impersonation across services). Either land it early in PI2026.2 or accept that downstream epics carry the Bamboo-only risk.

## Recommended Next Actions

**P1 — before next refinement session**
1. Decide whether `epics/2026-04-29-check-impersonation-role.md` is a duplicate of EAMDM-10262 or a sub-story; close or re-parent.
2. Expand `epics/2026-05-05-github-migration.md` and `epics/2026-05-04-change-output-of-midas-for-the-users-to-use-v2.md` to COVE format, or remove from the upcoming PI.
3. Re-classify `epics/2026-05-04-migration-assessment-and-planning-for-midas-to-azu.md` as a Feature (or split), and convert its bullets to Spikes.
4. Link `bugs/2026-05-05-ir31532952-missing-measurement-data-under-test-id-.md` to `epics/2026-05-05-file-alias-management-for-deduplicated-content-in-.md` — they describe the same gap.

**P2 — at refinement**
5. Add Gherkin AC and `## Out of Scope` to: enhancement-of-external-partners, MDF Trace Aggregation, Promote Upload V2, Test Name Validation.
6. Run an "async or sync?" pass over every V2 epic; for async ones, add RabbitMQ topic + DLQ + idempotency AC.
7. Land SP estimates for the four well-detailed epics (MDF Trace, File Alias, Upload Local Tool, Download API).
8. Add datapool-authorization AC to File Alias Management (alias creation across datapools) and to the new Download API (legacy-file dual-DB resolution).

**P3 — open spikes**
9. Open a spike for "Token-refresh storage on the desktop uploader" tied to `epics/2026-05-05-upload-local-tool.md` Phase 1 step 1.
10. Open a spike for "DAPc auth → AzureIdentity mapping" under the AzureLocal feature/epic re-org.
11. Open a spike for "Multi-provider delivery permissions/validation" carved out of the MEST V2 epic's section 6.
