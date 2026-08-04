# ADR 0003: Family-plan entitlements and user-owned private data

- Status: accepted
- Date: 2026-07-11
- Decision owner: baseline application
- Issue: [R-019C / #84](https://github.com/smallwiselabs/swl-step-by-step/issues/84)
- Partially supersedes: [ADR 0002](0002-better-auth-organization-workspace-authority.md)
- Pre-release database amendment: [ADR 0008](0008-pre-release-database-rebaseline.md) supersedes this ADR's project-slug and active-migration-chain/predecessor decisions; user-owned private data remains accepted
- Search-removal amendment: [ADR 0010](0010-remove-local-search-and-fts.md) supersedes this ADR's Search projection and Search-authorization decisions; user-owned project authorization remains accepted

## Context

The baseline targets small personal and family applications, not business multi-tenant workspaces. One person may pay and invite family members so they can use paid features, but that relationship does not normally mean everyone should see one another's projects, files, prompts, or history. Some forks may later share a specific resource, such as a baby-name list, without making every record collaborative.

ADR 0002 correctly selected Better Auth Organization `1.6.23` as the maintained organization, membership, invitation, and role authority. R-019 then secured project CRUD by assigning projects to an organization. That resource-ownership choice conflated two different questions:

1. Does this user receive a plan entitlement through a current family membership?
2. Does this user own or have explicit feature-specific access to this record?

Better Auth's Organization schema defines organizations, members, invitations, and optional active-session selection. It does not require application tables to be owned by an organization.

## Decision

- Keep Better Auth Organization as the sole family-plan membership and invitation authority. Every user retains one automatically provisioned, normally invisible personal organization and may be accepted into at most one other user's organization under ADR 0009's one-paid-authority rule.
- Treat `organization`, `member`, and future organization subscription data as entitlement inputs only. Membership never grants access to another member's private application records.
- Make private records user-owned by default. Project rows use a restrictive `owner_user_id` foreign key to Better Auth `user.id`; every project query includes the authenticated user ID.
- Exclude project actions from Better Auth Organization access-control statements and workspace capability hints. Project authorization is the authenticated user/resource predicate.
- Use clean `/api/projects` collection and resource routes. Organization slugs and `session.activeOrganizationId` do not participate in project lookup, ownership, or search authorization.
- Keep project DTOs strict and ownership-free. The server derives the owner from the authenticated session; callers cannot submit `ownerId`, `ownerUserId`, or `organizationId`.
- Authorize project search from the relational source row's `owner_user_id` and require matching `metadata.ownerId`; never infer visibility from organization membership.
- Add append-only migration `0010`: rebuild the SQLite project table using the referenced organization's unique `personal_owner_user_id`, preserve row fields, update project search metadata, and fail atomically when the referenced organization is missing or unmarked. Multiple family members do not make a marked organization ambiguous.
- Add feature-specific collaboration only in a fork that needs it, using a typed resource-specific table and tests. Do not add a universal ACL or an unused collaborator subsystem to the baseline.

## Authorization boundary

Plan and data checks remain separate:

```text
May the user use a paid capability?
  -> current persisted family-plan membership and subscription

May the user access this project?
  -> authenticated user ID equals projects.owner_user_id
```

`activeOrganizationId`, URL state, a member role, and a generated organization slug answer neither question by themselves.

## Rejected alternatives

### Organization-owned private records by default

Rejected because joining a family plan would silently expose every organization-owned record to every member and make simple personal forks carry business-workspace tenancy semantics.

### Membership plus per-user exceptions

Rejected because default-shared data with privacy exceptions is harder to reason about and test than private ownership with explicit feature-specific sharing.

### A generic polymorphic ACL

Rejected because it weakens foreign-key/type safety and creates a cross-feature subsystem before any concrete shared feature requires it.

### Inferring a project owner from organization members

Rejected because the pre-migration project row contains no creator. Only the organization's existing unique `personal_owner_user_id` is deterministic. Member count, role, slug, timestamps, or active selection are not ownership evidence.

## Consequences

- R-019's organization-owned project decision is preserved as history but superseded by R-019C/#84.
- A person joining a paid family group receives entitlements without seeing the payer's private data.
- A future collaborative feature adds its own collaborator table and authorization tests without re-keying all existing private data.
- Account deletion in R-018C/#80 must delete user-owned projects before deleting the user because the foreign key is deliberately restrictive.
- [ADR 0004](0004-owner-member-family-plan-boundary.md) narrows invitations and roles to the approved owner/member family-plan surface. It does not become a private-resource authority.
- Existing custom CI receives only mechanical route/migration bookkeeping updates; focused HTTP and actual SQLite migration tests are the primary evidence.

## Evidence and official sources

- [Pinned Better Auth Organization guide](https://github.com/better-auth/better-auth/blob/v1.6.23/docs/content/docs/plugins/organization.mdx)
- [Pinned Better Auth Organization schema](https://github.com/better-auth/better-auth/blob/v1.6.23/packages/better-auth/src/plugins/organization/schema.ts)
- [Drizzle migrations](https://orm.drizzle.team/docs/migrations)
- [SQLite ALTER TABLE and table-rebuild procedure](https://www.sqlite.org/lang_altertable.html#making_other_kinds_of_table_schema_changes)
- [SQLite transactions](https://www.sqlite.org/lang_transaction.html)
- [SQLite foreign keys](https://www.sqlite.org/foreignkeys.html)
