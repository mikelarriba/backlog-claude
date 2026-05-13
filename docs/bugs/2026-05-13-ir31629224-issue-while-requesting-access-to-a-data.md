---
JIRA_URL: https://devstack.vwgroup.com/jira/browse/EAMDM-10533
JIRA_ID: EAMDM-10533
Story_Points: TBD
Status: Created in JIRA
Priority: Medium
Created: 2026-05-13
---

## IR31629224 Issue while requesting access to a datapool in MIDAS

### Description

Hello Team,

We have a user ticket where, he is getting error when trying to request access datapool through frontend.

From the management datapool pod we have below error (log attached).

DATAPOOLS MGMT SERVICE - 2026-05-13 09:15:14,192 eamdmmidas.utils.rr_internal_calls_svc ERROR: received status code 404, Service returned code 404 You have requested this URI [/i_authentication/internal_validate/datapool_access/72] but did you mean /i_authentication/internal_validate/datapool_access/<int:datapool_id> or /i_authentication/internal_info/datapools_list/<data_right_keys> or /i_authentication/internal_info/datapool_rights/<int:datapool_id> ?

Could you please check if the uri is correct? 

Thanks

### Attachments

- [IR31629224 Midas datapool request issue.pdf](attachments/ir31629224-issue-while-requesting-access-to-a-data/IR31629224_Midas_datapool_request_issue.pdf)
- [error_log.txt](attachments/ir31629224-issue-while-requesting-access-to-a-data/error_log.txt)
