---
Generated: 2026-05-07
Files_Reviewed: 23
Status: Draft
---

# Backlog Analysis Report — 2026-05-07

This is a **delta-style** report. The backlog has changed by exactly one file since `2026-05-06-backlog-report.md`: a new Feature, `features/2026-05-06-migration-from-kldap-to-spectrum.md`. All 12 epics and 4 bugs are unchanged from yesterday — none of yesterday's P1/P2/P3 actions have been reflected in the docs yet (still TBD frontmatter, two impersonation epics still both present, two stub epics unchanged). Yesterday's findings remain open; this report focuses only on what's new and on the second-order impact of the new feature on the existing backlog.

## Executive Summary

- **New Feature added:** KLDAP → Spectrum Identity Migration. It is well-structured (full COVE, named Out of Scope, lists 5 child epics) but introduces a **fleet-wide blocker risk** that is not yet acknowledged anywhere else in the backlog.
- **Five-epic feature, no child epic files yet.** The 5 epics in the Execution section are described in one line each — none exist on disk under `docs/epics/`. Until they're created, this Feature is a placeholder, not a deliverable plan.
- **Two existing in-flight epics now sit on a moving identity foundation.** `epics/2026-04-29-add-optional-impersonation-header-support-for-data.md` and `epics/2026-04-29-check-impersonation-role.md` both depend on KIRA/LDAP role resolution. If KLDAP retires before they ship, they will need to be re-implemented against Spectrum mid-flight.
- **AzureLocal migration and KLDAP→Spectrum migration overlap and have no common ownership.** Both touch identity federation (`features/2026-05-04-design-the-target-architecture-based-on-azurelocal.md` mentions "DAPc authentication flow to AzureIdentity"; the new feature mentions "Azure AD tenant federation"). Without explicit coordination they will produce conflicting Azure identity designs.
- **Yesterday's P1 actions remain open.** GitHub Migration epic still one sentence; Change-output-to-V2 epic still one line; duplicate impersonation epic still present; bug IR31532952 still not linked to File Alias Management epic.

## Findings by New Feature

### KLDAP → Spectrum Identity Migration — `features/2026-05-06-migration-from-kldap-to-spectrum.md`

- **Vulnerabilities:**
  - "Zero downtime during the cutover window" is asserted as the Objective but no Acceptance Criteria, fallback, or rollback steps are defined in the Feature itself (Epic 5 mentions "rollback procedures" — surface the rollback time-window into the Feature's AC).
  - Role-mapping migrations are a classic source of silent privilege escalation/de-escalation. There is no AC like "no user gains a permission they did not have under KLDAP" or "diff report is reviewed and signed off before cutover."
  - The Feature does not mention legal-hold, datapool isolation, or audit-log continuity across the identity switch — all three are critical for VW compliance.

- **Dependencies:**
  - Direct dependency on `epics/2026-04-29-add-optional-impersonation-header-support-for-data.md` (impersonation flow uses KIRA roles via LDAP) and `epics/2026-04-29-check-impersonation-role.md`. Either the impersonation work ships under KLDAP and gets re-tested under Spectrum, or it waits for Spectrum cutover. Decide explicitly.
  - Implicit dependency on `epics/2026-05-04-migration-assessment-and-planning-for-midas-to-azu.md` (and its parent `features/2026-05-04-design-the-target-architecture-based-on-azurelocal.md`): both reference Azure identity. If both proceed independently, the Azure tenant configuration could be defined twice.
  - External dependency: VW Group Identity team — already flagged in Out of Scope as "critical external dependency", good. But no named contact, ticket, or sync cadence.
  - Search and Datapool access epics implicitly assume LDAP; any V2 epic that filters search by `KIRA roles for the impersonated user` will need re-validation against Spectrum.

- **Refinement proposals:**
  - Create the 5 child epic files under `docs/epics/` so they can be tracked, estimated, and assigned. The Feature lists them in prose only.
  - Add a Feature-level Acceptance Criteria section (Gherkin) covering: cutover success, rollback success, role-equivalence audit signoff, post-cutover access continuity for at least one Test Engineer, Data Engineer, and Admin persona.
  - Add explicit "VW Group corporate deadline" date to Context — "firm 2026 deadline" is too vague for sequencing decisions.
  - Add a note clarifying whether the cutover is a feature-flag flip or a hard switch (this changes the rollback design completely).

- **Technical issues:**
  - Epic 2 says "Integrate Spectrum as the OIDC/SAML provider" — pick one. OIDC and SAML have different MIDAS-side wiring (token shape, group claim format, refresh model). Decide before Epic 2 starts.
  - Epic 3 ("Map KLDAP Roles to Spectrum Groups") has no mention of how groups will be kept in sync *after* cutover. If Spectrum is now authoritative, KLDAP→Spectrum sync becomes Spectrum→MIDAS sync — describe the new flow.
  - The Feature says "automated role syncing ensures datapool access rules are preserved" but the V2 architecture (per `CLAUDE.md`) uses RabbitMQ for async work. State whether group-sync events are pulled (polled) or pushed via a topic.

- **Estimation concerns:**
  - 5 epics for a corporate-mandated compliance migration almost certainly exceeds a single PI. Confirm sequencing across at least 2 PIs.
  - No SP estimate at the Feature level; given downstream complexity, a rough order-of-magnitude band (e.g. T-shirt size) would help PI Planning even before the child epics exist.

## Cross-cutting Findings

- **Identity work is now distributed across three places:** the two impersonation epics, the new KLDAP→Spectrum Feature, and the AzureLocal Feature/Epic. None of them link to each other. Risk: three teams design three different identity touchpoints. Recommendation: hold a single "MIDAS identity roadmap" alignment session and capture the outcome in a top-level Feature or in `docs/architecture.md` (treating the latter as the tool's docs, this likely needs a new MIDAS-architecture doc).
- **All yesterday's RabbitMQ and Out-of-Scope gaps remain.** No epic was edited overnight to add async event flow, name an OpenSearch index, or add an `Out of Scope` section.
- **The new Feature is the first doc in the backlog with a clean, full COVE structure including a meaningful Out of Scope.** Use it as a template when expanding the GitHub Migration and Change-output-to-V2 stubs.

## Recommended Next Actions

**P1 — must precede next refinement session**
1. Create the 5 child epic files for the KLDAP→Spectrum Feature under `docs/epics/`, even as drafts, so they can be tracked. Without this, the Feature cannot be planned.
2. In `epics/2026-04-29-add-optional-impersonation-header-support-for-data.md` and `epics/2026-04-29-check-impersonation-role.md`, add a Dependencies note explicitly stating: "Identity provider may change to Spectrum mid-flight (see `features/2026-05-06-migration-from-kldap-to-spectrum.md`); impersonation role lookups must be abstracted from the underlying provider." This is a refinement comment, not a re-scope.
3. Decide: is the new Feature a peer of the AzureLocal Feature, or a child? If they're peers, document the boundary; if KLDAP→Spectrum is part of the Azure consolidation, link it via `Feature_ID` or move it under `features/2026-05-04-design-the-target-architecture-based-on-azurelocal.md`.

**P2 — at refinement**
4. Add Feature-level Gherkin AC (cutover, rollback, role-equivalence audit) to `features/2026-05-06-migration-from-kldap-to-spectrum.md`.
5. Resolve OIDC vs SAML in Epic 2 of the new Feature before any implementation work begins.
6. Carry forward all unaddressed items from `docs/backlog-analysis/2026-05-06-backlog-report.md` (estimation hygiene, GitHub Migration stub, Change-output-to-V2 stub, duplicate impersonation epic, bug-to-epic linking, RabbitMQ/OpenSearch/Out-of-Scope sweeps).

**P3 — open spikes**
7. Open a spike: "OIDC vs SAML for Spectrum integration in MIDAS" — small, time-boxed, blocks Epic 2.
8. Open a spike: "Role-equivalence diff KLDAP → Spectrum (read-only audit)" — produces the artefact that Epic 3 will validate against.
9. (Carry-over) The three spikes proposed yesterday remain open: desktop token-refresh storage, DAPc→AzureIdentity mapping, multi-provider delivery permissions.
