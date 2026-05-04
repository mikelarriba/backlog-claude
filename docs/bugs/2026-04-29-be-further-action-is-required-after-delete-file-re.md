---
Epic_ID: 2026-04-29-promote-and-streamline-user-adoption-of-upload-v2.md
JIRA_ID: EAMDM-10446
JIRA_URL: https://devstack.vwgroup.com/jira/browse/EAMDM-10446
Story_Points: TBD
Status: Created in JIRA
Priority: Major
Fix_Version: Release 2.8.0
Squad: TBD
PI: TBD
Sprint: TBD
Created: 2026-04-29
---

## [BE] Further action is required after delete file request

There are 2 issues on deleting file from group, which requires further action from service.

 

**Case 1:**

GIVEN user uploads 2 files, one is duplicated and the other is uploaded successfully.

WHEN user delete duplicated file

Expected Result:

THEN the group should automatically process delivery and change its status to processing.

Actual Result: 

THEN the group status is still pending_action and nothing changes.

 

**Case 2:**

GIVEN user uploads 1 file and it is duplicated

WHEN user delete the file.

Expected Result:

THEN the group should be removed as it does not contain any file.

Actual Result: 

THEN the group exists with no files and user is not allowed to do anything else.
