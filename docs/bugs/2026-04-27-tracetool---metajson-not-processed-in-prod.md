---
Epic_ID: 2026-04-27-tracetool-improvements.md
JIRA_ID: EAMDM-9477
JIRA_URL: https://devstack.vwgroup.com/jira/browse/EAMDM-9477
Story_Points: TBD
Status: Created in JIRA
Priority: Major
Fix_Version: Release 2.8.0
Squad: TBD
PI: TBD
Sprint: TBD
Created: 2026-04-27
---

## Tracetool - meta.json not processed in PROD

Deik Schweneker is doing some tests in PROD, but he can't see the results in Opensearch.

 
*Context*
In the PROD environment, when uploading {{.mf4}} files along with {{{}meta.json{}}}, the tracetool does not use the {{meta.json}} to transfer metadata to Opensearch documents. This functionality works correctly in QS but fails in PROD. The issue occurs both when uploading via the internal partner and through the UI.

*Objective*
Fix the tracetool behavior in PROD so that it processes the {{meta.json}} file and transfers metadata to Opensearch documents. Objectives include: * Validate why the current PROD configuration ignores {{{}meta.json{}}}.
 * Align PROD behavior with QS for consistent metadata handling.
 * Ensure metadata is correctly indexed in Opensearch for trace analysis.


*Value*
This fix is essential to enable the tracetool in PROD. Without metadata in Opensearch, trace analysis and document search are incomplete, blocking workflows and delaying adoption.

*Example*
When a user uploads an {{.mf4}} file and a {{meta.json}} in PROD, the tracetool should read the metadata from {{meta.json}} and store it in Opensearch, just as it currently does in QS.
