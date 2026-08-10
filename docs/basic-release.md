# Current basic-release capability boundary

This document is the WCU-authoritative release boundary for inherited AI and user-file code. It
supersedes imported Baseline guides and ADRs wherever they describe those capabilities as active.

- AI chat, Files, File Search, Web Search, OpenAI resources, and user-file R2 are excluded from the
  basic release for anonymous users, authenticated nonmembers, and members.
- Exact `/api/ai` and `/api/files` path families return the same non-cacheable `404` before auth,
  request parsing, runtime provider configuration, SQLite, quota, storage, or provider work.
- Production AI/File service composition is source-blocked, the worker registers no Files handler
  or reconciliation scheduler, account deletion creates no Files job, and the OpenAI corpus CLI is
  not a package command and exits before credential or provider access.
- Application OpenAI and user-file R2 values are not deployment inputs. Compose clears stale shared
  values for every role. The separate private SQLite backup contract continues to use only
  `BACKUP_R2_*` values.
- Dormant services, lower-level deterministic tests, schema, and migrations are retained only to
  keep this change small. Their presence is not product availability or provider certification.

Later work may give authenticated nonmembers a limited quota and dues-paying members one somewhat
larger quota regardless of dues amount. That requires a separately approved vertical slice and a
substantial WCU tenant-rights, know-your-rights, and organization corpus; a generic chat experience
is not a WCU deliverable.
