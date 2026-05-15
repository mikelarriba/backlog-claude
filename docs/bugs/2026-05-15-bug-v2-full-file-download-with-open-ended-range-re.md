---
Epic_ID: 2026-05-05-new-download-api---resumable-large-file-downloads-.md
JIRA_ID: EAMDM-10347
JIRA_URL: https://devstack.vwgroup.com/jira/browse/EAMDM-10347
Story_Points: TBD
Status: Created in JIRA
Priority: Major
Fix_Version: Release 2.7.0
Squad: TBD
PI: TBD
Sprint: TBD
Created: 2026-05-15
---

## [Bug] V2 full file download with open-ended range returns 206 instead of 200 OK

**Situation:** When performing a V2 full file download, the frontend/client requests the entire file using an open-ended byte range header (e.g., Range: bytes=0-{}}}). The backend is processing this as a partial request rather than returning a standard successful full download response.

**Expected result:** When an open-ended range representing the entire file is requested (bytes=0-{}}}), the API should return an HTTP `200 OK` status code indicating the full file is being delivered.

**Actual result:** The API returns an HTTP `206 Partial Content` status code instead, which breaks the expected API contract for full file downloads.

**Further information:**
 ** **Failed Test Step:* `verifyFullFileDownload`

 ** **Runner Log:*

`2026-04-01 11:36:40.200 Test worker INFO  config.TestLogger - Test step FAILED: verifyFullFileDownload
Reason: java.lang.AssertionError: 
expected: 200 OK
 but was: 206 Partial Content

Expected :200 OK
Actual   :206 Partial Content`
_(Note for developers: While 206 can technically be RFC compliant for any Range request, the current system contract and frontend/test expectations require a 200 OK when the entire file boundary is fetched)._
