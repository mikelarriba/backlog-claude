---
JIRA_ID: TBD
Story_Points: TBD
Status: Draft
Priority: High
Squad: TBD
PI: TBD
Created: 2026-05-07
---

## Feature: KLDAP to Spectrum Identity Migration

## Context

VW Group is retiring KLDAP and migrating all users to the Spectrum identity platform as part of a corporate-mandated compliance and security initiative with a firm 2026 deadline. MIDAS currently relies on KLDAP via LDAP for user authentication and role-based access control (RBAC), governing access to datapools, test data, and export functionality. Without proactive alignment, MIDAS users will lose access at cutover. The migration also intersects with Azure cloud platform adoption, requiring identity federation and role mapping to be orchestrated across both systems before go-live.

## Objective

Migrate MIDAS authentication and authorisation from KLDAP to Spectrum so that all users can authenticate via Spectrum, existing datapool access and RBAC roles are fully preserved, and the KLDAP dependency is eliminated — with zero downtime during the cutover window.

## Value

- **For Test Engineers:** Uninterrupted access to test data, exports, and MIDAS Shares after cutover — no credential changes or re-enrolment required
- **For Data Engineers:** Automated role syncing ensures datapool access rules are preserved; no manual remediation of permissions post-migration
- **Business impact:** MIDAS achieves compliance with VW Group identity standards, removes a critical dependency on legacy KLDAP infrastructure, and unblocks the broader Azure cloud consolidation roadmap

## Execution

Planned Epics that will deliver this Feature (each will be linked via "Is Contained" in JIRA):

1. **Epic:** Audit KLDAP Usage in MIDAS — Map all authentication and authorisation touchpoints, document role hierarchy and datapool access rules, identify Azure identity federation requirements
2. **Epic:** Implement Spectrum Identity Provider — Integrate Spectrum as the OIDC/SAML provider, configure Azure AD tenant federation, establish test and staging environments
3. **Epic:** Map KLDAP Roles to Spectrum Groups — Define role equivalence matrix, implement automated role sync, validate access levels end-to-end before cutover
4. **Epic:** Test Spectrum Authentication in MIDAS — Functional and load testing with Spectrum credentials, produce cutover runbook and rollback procedures
5. **Epic:** Execute KLDAP to Spectrum Cutover — Coordinate with VW Group Identity team, activate Spectrum auth in production, monitor for failures, document lessons learned

## Out of Scope

- Infrastructure provisioning for Spectrum or Azure tenants (owned by VW Group IT/Identity team — flag as critical external dependency)
- Changes to the MIDAS user management UI or Admin workflows (access control policy logic remains unchanged; only the identity provider changes)
- Modifications to RBAC roles or datapool permission structures
- Other MIDAS V2 initiatives unrelated to identity migration
