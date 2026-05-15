---
Epic_ID: 2026-05-05-new-download-api---resumable-large-file-downloads-.md
JIRA_ID: EAMDM-10346
JIRA_URL: https://devstack.vwgroup.com/jira/browse/EAMDM-10346
Story_Points: TBD
Status: Created in JIRA
Priority: Major
Fix_Version: Release 2.7.1
Squad: TBD
PI: TBD
Sprint: TBD
Created: 2026-05-15
---

## [Bug] Legacy V1 chunked download fails with 502 "Failed to retrieve file range from storage

**Situation:** When attempting to perform a chunked download using a legacy V1 file ID via the /download}} endpoint, the system fails to fetch the chunk from the backend storage.

**Expected result:** The API should successfully locate the file in storage, retrieve the specified byte range, and return an HTTP `206 Partial Content` status along with the file chunk data.

**Actual result:** The API returns an HTTP `502 Bad Gateway` error and completely fails the download process.

**Further information:**
 ** **Endpoint:* `GET /file-handler/v1/files/legacy/107790/download`

 ** **Failed Test Step:* `verifyV1ChunkedDownload`

 ** **Response Body:*

`
