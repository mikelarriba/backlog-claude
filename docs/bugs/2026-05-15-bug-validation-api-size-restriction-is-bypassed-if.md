---
Epic_ID: 2026-05-05-new-download-api---resumable-large-file-downloads-.md
JIRA_ID: EAMDM-10304
JIRA_URL: https://devstack.vwgroup.com/jira/browse/EAMDM-10304
Story_Points: TBD
Status: Created in JIRA
Priority: Major
Fix_Version: Release 2.7.0
Squad: TBD
PI: TBD
Sprint: TBD
Created: 2026-05-15
---

## [Bug] Validation API size restriction is bypassed if frontend limits are configured higher

**Situation:** There is a critical disconnect between the frontend validation handling and the backend `/validate` endpoint. If the user selects files that exceed the backend's 2GB size limit OR the maximum file count limit (triggering `ok: false` in the API), the frontend ignores the backend's rejection if its own configured limits are artificially higher. Additionally, when exporting files to GlobalX, the frontend fails to load the proper translation text for the success popup.

**Expected result:** If the backend Validate API returns `ok: false` for any reason (size or file count), the frontend must strictly abort the download/export process and show an error. It must not proceed with the download request. Furthermore, success popups for GlobalX exports must display correctly translated text, not raw translation keys.

**Actual result:** Despite the Validate API explicitly rejecting the request, the download stream is initiated anyway (bypassing the backend's size and file count restrictions). Additionally, the GlobalX export popup displays the raw translation key `VALIDATE_FILE_ACTION.VALIDATE_SUCCESS` instead of the actual message.

**Further information:**
 ** **Validate Request Sent:* `

 ** **Validate Response Received (Ignored by FE):*

` ** **Note on File Count:* This bypass also occurs if `max_files` is exceeded (count_ok: false{}}}).

 ** **Attachments:* A screenshot is attached demonstrating the `VALIDATE_FILE_ACTION.VALIDATE_SUCCESS` translation key error on the GlobalX export popup.
