---
Epic_ID: 2026-05-05-new-download-api---resumable-large-file-downloads-.md
JIRA_ID: EAMDM-10303
JIRA_URL: https://devstack.vwgroup.com/jira/browse/EAMDM-10303
Story_Points: TBD
Status: Created in JIRA
Priority: Major
Fix_Version: Release 2.7.0
Squad: TBD
PI: TBD
Sprint: TBD
Created: 2026-05-15
---

## [Bug] Exceeding download size limit triggers false success toast and silent failure

**Situation:** When a user selects files whose combined size exceeds the designated frontend limit and attempts to download them, the application does not properly block the user flow. Instead, it shows a positive confirmation to the user while the background process fails.

**Expected result:** The UI should prevent the user from attempting the download. It must display a clear error message stating that the size limit has been exceeded, or disable the Export button entirely. It must never show a success toast for a blocked action.

**Actual result:** The UI displays a success toast message, but the download never actually starts, leaving the user confused.

**Further information:**
 * This requires better error handling mapping between the validation check and the UI toast notification service.
