---
Epic_ID: 2026-04-29-promote-and-streamline-user-adoption-of-upload-v2.md
JIRA_ID: EAMDM-10426
JIRA_URL: https://devstack.vwgroup.com/jira/browse/EAMDM-10426
Story_Points: TBD
Status: Created in JIRA
Priority: Critical
Fix_Version: Release 2.8.0
Squad: TBD
PI: TBD
Sprint: TBD
Created: 2026-04-29
---

## [FE] Fix TUS upload resume failure on network errors (ProgressEvent)

1. Context

Large file uploads (tested with a 539 GB file) fail silently after a network interruption.

The tus-js-client surfaces the error:
```
tus: failed to resume upload, caused by object ProgressEvent,
originated from request (method: HEAD, url: .../file-handler/v1/uploads/<id>)
response code: n/a, response text: n/a, request id: n/a
```
 
 * The error is a `ProgressEvent` with no HTTP response, meaning the browser aborted the HEAD at the network layer (OpenShift route timeout / connection reset).
 ** The backend trace confirms the request never reached the API.
 * The client currently gives up after one failed HEAD instead of retrying, leaving a large orphaned multipart upload in S3.

         1. Acceptance Criteria
 *   Resume after a transient network error succeeds automatically (no user action required).
 *   The user sees a clear, user-friendly message only after all automatic retries are exhausted, with a manual "Retry" button.
 *   No parallel PATCH requests are fired for the same upload (current logs show 9 of 13 PATCHes returning 409 due to lock contention).
 *   Upload works end-to-end for files ≥ 100 GB on a stable connection.

         1. Step-by-step
 # **Configure `retryDelays` in tus-js-client** with backoff suitable for large uploads:
```
retryDelays:
```

 # **Implement `onShouldRetry`** to retry on network errors (no status code) and on 5xx / 423 Locked / 409 Conflict:
```
onShouldRetry: (err, retryAttempt, options) => 
```

 # **Reduce `chunkSize`** to a safer value (e.g. `50 ** 1024 ** 1024` = 50 MB). The trace shows 5-minute PATCH requests; smaller chunks reduce exposure to route timeouts.
 # **Serialize PATCH requests** — ensure `parallelUploads: 1` (default) and never call `upload.start()` again while a request is in flight.
 # Expose upload state in the UI: show "Reconnecting…" during retries; show "Upload failed — retry" only after retries are exhausted.
 # **Persist upload URL in the browser** (fingerprint{}}} / urlStorage{}}}) so the user can resume after closing the tab.
 # **Add logging** (onError{}}}, onShouldRetry{}}}) that captures err.originalRequest{}}}, err.originalResponse?.getStatus(){}}}, and `err.message` to help future debugging.
 # QA: simulate network drops mid-upload using browser DevTools "Offline" toggle during a PATCH, verify resume succeeds.

         1. References
 * Trace: https://grafana.eamdm-app.dapc-q.ocp.vwgroup.com/explore?schemaVersion=1&panes=%7B%22mjs%22:%7B%22datasource%22:%22tempo%22,%22queries%22:%5B%7B%22query%22:%22ee91f0109f5bb849dd95293b6b407107%22,%22queryType%22:%22traceql%22,%22refId%22:%22A%22,%22limit%22:20,%22tableType%22:%22traces%22,%22metricsQueryType%22:%22range%22%7D%5D,%22range%22:%7B%22from%22:%221776743662142%22,%22to%22:%221776765262142%22%7D%7D%7D&orgId=1
 * Upload ID: `midas-backend-api-hub/2026/04/21/4ef281d8-14d1-4d7e-9ca4-915e77ee1545`
 * tus-js-client docs: https://github.com/tus/tus-js-client/blob/main/docs/api.md ng/routes/route-configuration.html(https://docs.openshift.com/container-platform/latest/networking/routes/route-configuration.html)
