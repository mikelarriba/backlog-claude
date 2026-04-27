---
Epic_ID: 2026-04-27-tracetool-improvements.md
JIRA_ID: EAMDM-8788
JIRA_URL: https://devstack.vwgroup.com/jira/browse/EAMDM-8788
Story_Points: TBD
Status: Created in JIRA
Priority: Major
Fix_Version: 2025 2nd Half
Squad: TBD
PI: TBD
Sprint: TBD
Created: 2026-04-27
---

## Tracetool - Report not considered in PROD

Deik Schweneker is doing some tests in PROD, but he can't see the results in Opensearch.

 

+*More information:*+
 * He is using this datapool: EA211evo2 R4 1.5l TSI NAR – TraceAutomate
 * The name of the Datapool has recently changed to EA211evo2 R4 1.5l TSI NAR - TraceAutomate. So its only the "–", that has changed to "-", because it has caused some trouble in with the midas share. 
 * He uploaded a test in PROD: T2025080422083839850966, but in Nifi the process is not detecting a report for Tracetool analysis.

 

+*Pending actions:*+
 * Schedule a meeting with final users Deik Schweneker and Christopher Lueck to do a real test together and track Nifi behaviour. 
 * Reproduce the same behaviour in QS and analyse the possible root cause.
 ** Check this same behaviour with Deik in QS.
 * Apply a solution for QS and check the solution with Deik.
 * Then prepare the fix deployment to PROD.
