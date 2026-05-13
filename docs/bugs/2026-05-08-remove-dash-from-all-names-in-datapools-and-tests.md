---
JIRA_ID: EAMDM-9805
JIRA_URL: https://devstack.vwgroup.com/jira/browse/EAMDM-9805
Story_Points: TBD
Status: Created in JIRA
Priority: Minor
Fix_Version: Digi PI2026.2
Squad: TBD
PI: TBD
Sprint: TBD
Created: 2026-05-08
---

## Fix Invalid Characters in Datapool and File Names

### Context

Isilon (the storage system backing MIDAS) does not support certain special characters in file and folder names. These characters were previously allowed by the MIDAS application, resulting in existing datapools and test files containing invalid characters: `^`, `` ` ``, `"`, `:`, `*`, `+`, `/`, `\`, `|`, `?`, `#`, `>`, `<`, `–` (U+2013), `—` (U+2014).

To maintain system stability and prevent errors during file operations, all existing datapools and files with these characters must be renamed.

### Objective

Create an automated cron job that identifies and renames all datapools and files containing invalid characters, replacing them with valid alternatives (e.g., hyphens or underscores).

### Value

- Prevents file operation failures due to Isilon character limitations
- Ensures data integrity and accessibility across the platform
- Eliminates ongoing user issues caused by invalid filenames

### Execution

**V1 work** — fixing legacy data that was created before validation was in place.

1. Audit all datapools and tests to identify those containing invalid characters
2. Build a mapping of old names → sanitized names (replace invalid chars with hyphens or underscores)
3. Create a cron job that:
   - Renames datapools at the storage level (Isilon)
   - Updates metadata references in OpenSearch indexes
   - Updates database records pointing to old names
   - Logs all renames for audit and rollback capability
4. Execute cron job with validation of successful renames
5. Remove cron job once data is fully migrated

### Acceptance Criteria

```gherkin
Given a datapool with an invalid character (e.g., "test:data")
When the cron job runs
Then the datapool is renamed to a valid name (e.g., "test-data")
And OpenSearch indexes reflect the new name
And database metadata is updated
And a rename audit log is created

Given files in a test with invalid characters
When the cron job runs
Then all files are renamed to valid names
And file paths in metadata are updated
And test queries still resolve correctly
```

### Out of Scope

- Modifying validation rules to prevent future invalid character creation (separate story)
- Manual user intervention or retaining old names as aliases
- Infrastructure changes to Isilon itself
- Notification to users about renamed files

---