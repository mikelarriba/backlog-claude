---
Epic_ID: 2026-05-05-new-download-api---resumable-large-file-downloads-.md
JIRA_ID: EAMDM-10302
JIRA_URL: https://devstack.vwgroup.com/jira/browse/EAMDM-10302
Story_Points: TBD
Status: Created in JIRA
Priority: Major
Fix_Version: Release 2.7.0
Squad: TBD
PI: TBD
Sprint: TBD
Created: 2026-05-15
---

## [Bug] Single file Local Download is incorrectly compressed (compress_single is true)

**Situation:** When a user exports a single file via Local Download, the frontend is incorrectly passing the `compress_single: true` parameter in the API payload. This forces the backend to zip the file instead of downloading it in its raw format.

**Expected result:** A single file export should be downloaded in its original format without compression (the frontend should send compress_single: false{}}}). Compression should only be applied when multiple files are selected.

**Actual result:** The single file is downloaded as a compressed `.zip` file.

**Further information:**
 * 
 *** **Payload sent by FE:* `
