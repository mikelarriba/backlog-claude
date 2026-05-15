---
Epic_ID: 2026-05-05-new-download-api---resumable-large-file-downloads-.md
JIRA_ID: EAMDM-10324
JIRA_URL: https://devstack.vwgroup.com/jira/browse/EAMDM-10324
Story_Points: TBD
Status: Created in JIRA
Priority: Major
Fix_Version: Release 2.7.0
Squad: TBD
PI: TBD
Sprint: TBD
Created: 2026-05-15
---

## [Bug] Isilon export is creating a metadata file (midas_folder_structure is true)

**Situation:** When a user exports a single file via Isialon, the frontend is incorrectly passing the midas_folder_structure: true{}}} parameter in the API payload. This forces the backend to create a metadata file on the fly and appending it in the resulting zip file. 

**Expected result:** No metadata file is created inside the zip file.

**Actual result:** A metadata file is created inside the zip file.

**Further information:**
 * 
 *** **Payload sent by FE:* }}
