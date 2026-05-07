---
Epic_ID: 2026-05-05-new-download-api---resumable-large-file-downloads-.md
JIRA_ID: EAMDM-9821
JIRA_URL: https://devstack.vwgroup.com/jira/browse/EAMDM-9821
Story_Points: TBD
Status: Created in JIRA
Priority: Major
Fix_Version: Release 2.7.1
Squad: TBD
PI: TBD
Sprint: TBD
Created: 2026-05-05
---

## Download API crashes when running 5-7 downloads in parallel

Issue reported by Jannes Schareitz (09.12.2025, Teams/API Development)

Download API Performance PROD

Hi MIDAS Team, 

I tested the download api on QS and Prod for the last weeks and first of all, it seems to be a great improvement on download speed in comparison to the collections/s3_translation api. From a running container in the midas-a-app-main, I was able to download files with up to 1000Mbit/s and therefore was able to download up to 150GB in 20min (current timeout setting). If I remember correctly, thats twice as fast as with the s3_translation api and with the s3_translation size limit was 10GB I think.

However, I think the performance needs to be improved especially when multiple users/systems download files at the same time.

When running 5-7 downloads in parallel, the pod crashed because of memory limits. 

I'm not entirely sure, but I also think that requesting the same file twice in parallel caused the download time to double.

I think we might not have provided enough requirements, so I understand that it wasn’t tested in depth. 

I would really appreciate it if someone could have a look at it. !https://statics.teams.cdn.office.net/evergreen-assets/personal-expressions/v2/assets/emoticons/smile/default/20_f.png!

Thanks and kind regards,

Jannes
