# ADR 0004: Owner/member family-plan boundary

- Status: accepted
- Date: 2026-07-11
- Decision owner: baseline application
- Issue: [R-018A / #78](https://github.com/smallwiselabs/swl-step-by-step/issues/78)
- Partially supersedes: [ADR 0002](0002-better-auth-organization-workspace-authority.md)
- Builds on: [ADR 0003](0003-family-plan-entitlements-and-user-owned-data.md)
- Pre-release database amendment: [ADR 0008](0008-pre-release-database-rebaseline.md) supersedes this ADR's active-migration-chain and predecessor-compatibility decisions; the owner/member product boundary remains accepted
- Strict-authority amendment: [ADR 0009](0009-direct-stripe-family-plan-authority.md)/[R-024A2 / #129](https://github.com/smallwiselabs/swl-step-by-step/issues/129) limits each person to one family billing authority and adds member-only self-leave
- Subscription amendment: [ADR 0017](0017-stripe-personal-family-subscriptions.md)/[#169](https://github.com/smallwiselabs/baseline/issues/169) supersedes this ADR's no-member-management and accepted-member-only capacity statements only as follows: a billing-current Family manager may remove one non-manager through the narrow opaque-reference command, and each pending unexpired invitation reserves one of the five non-manager seats

## Context

The baseline serves small personal and family applications rather than business-workspace administration. Each user silently receives a family-plan group. Its owner may invite another person so that person can later receive the same paid entitlement, while both people keep separate logins and private data. A fork may explicitly share one feature record, but joining a family plan must not expose every member's projects, files, prompts, or history.

ADR 0002 correctly selected Better Auth Organization `1.6.23` as the sole organization, membership, and invitation-record authority. Its original owner/admin/member role matrix and URL-selected manager surface were broader than this product needs. Pinned Better Auth still recognizes and merges its built-in role names internally, and invitation resend returns before the create-invitation hook while acceptance copies the persisted invitation role into a membership. Application code alone is therefore not a sufficient owner/member invariant.

## Decision

- Every user has exactly one automatically provisioned organization identified by the private unique `personal_owner_user_id` marker. The application may call this a family plan or account; users do not need a workspace-administration UI.
- The product roles are exactly `owner` and `member`. The marked user is the sole owner of that organization; everyone else in it is a member. A hidden Better Auth `admin` compatibility role remains configured with no application authority because the pinned plugin merges and validates its built-in role names internally. It is not an application role and may not become new live membership or pending-invitation state.
- Better Auth Organization remains the record authority. The application does not create a parallel invitation, membership, role, or workspace system.
- `GET /api/invitations` derives the authenticated user's marked organization, requires that user's current owner membership, and returns only pending, unexpired, role-free invitation summaries.
- `POST /api/invitations` accepts only an email. The server derives the same owner organization and fixes the role to `member`; callers cannot choose an organization ID, slug, role, or resend mode.
- `POST /api/invitations/:invitationId/resend` and `POST /api/invitations/:invitationId/cancel` require that exact pending invitation to belong to the authenticated owner's marked organization. Resend reuses the existing unexpired invitation ID and always supplies `member` to Better Auth.
- `GET /api/invitations/:invitationId` remains available only to the matching verified recipient and returns workspace display name and expiry, not role or member data. Acceptance and rejection remain explicit `POST` operations. Acceptance must result in a persisted `member` membership.
- There is no member-directory, admin, member-management, role-mutation, ownership-transfer, successor, export, or public organization-delete surface. Invitees cannot administer the owner's group. ADR 0009 narrows the earlier no-leave decision to one exact exception: a member may remove only their own external membership through `POST /api/account/family/leave`; owners cannot leave or transfer. While externally covered, that member's automatically marked group is dormant for new invitations and billing rather than a second family authority.
- Native Better Auth Organization HTTP paths remain disabled. Application routes normally use its public server API behind authentication, persisted owner verification, minimized DTOs, and the existing app-command origin boundary. ADR 0017 adds one narrow manager-removal exception: Better Auth `1.6.23` does not atomically clear the removed person's stale `activeOrganizationId`, so that command performs the exact membership delete and affected-session pointer cleanup together in one application-owned `BEGIN IMMEDIATE` transaction. It does not become a general member, role, or organization mutation layer.
- `activeOrganizationId` and organization slugs remain navigation conveniences, never invitation-manager or private-resource authority. Private resources stay user-owned by default under ADR 0003; family membership is an independent future entitlement input.
- R-018C/#80 implements immediate owner-account deletion and removal of the owner's family-plan group. Invitees retain their own accounts and user-owned data. ADR 0009/R-024A2 owns subscription, capacity, strict admission, and self-leave enforcement; neither UI state, invitation admission hooks alone, nor Better Auth's membership limit alone is treated as the atomic paid-authority boundary.

## Migration and persistence

Append-only migration `0011` converts shipped live state to the narrowed model:

1. the marked user becomes the sole `owner` member of that organization;
2. every other membership becomes `member`;
3. every pending invitation becomes `member`, while terminal invitation history is retained;
4. a temporary validation relation rejects a missing/duplicate marker, missing/wrong marked owner, extra owner, non-member invitee, or non-member pending invitation before the migration ledger advances; and
5. SQLite triggers guard membership inserts/updates, marked-owner removal or downgrade, pending-invitation inserts/updates, and marker mutation.

The owner-member delete guard permits deletion when the parent organization is itself being removed, so the coordinated account-deletion slice can later use the declared cascade. The migration is tested by running the actual Drizzle migrator against a temporary SQLite predecessor, proving failed validation rolls back, correction and retry succeed, constraints reject invalid live behavior, repeat execution is idempotent, and foreign-key/integrity checks remain clean.

## Invitation consistency and privacy

Truthful delivery remains application-owned. Better Auth creates or reuses the pending record first; the application then awaits its capture/SMTP adapter. A delivery failure returns one generic retryable error and leaves the exact pending record for explicit resend. Recipient address, raw token, capture path, and provider error details are not exposed.

Pinned Better Auth's reject/cancel writes do not condition the update on the prior status, so the application does not use those writes as its terminal authority. App-owned cancel and reject commands perform a pending-to-terminal compare-and-set inside `BEGIN IMMEDIATE`; create, resend, and accept also reauthorize inside application-owned SQLite transactions and preserve the database capacity constraints. Process-local queues still order async operations sharing the synchronous connection and same-ID resend delivery in the documented one-process/one-replica topology; they are not claimed as distributed coordination.

The configured synchronous SQLite adapter keeps `transaction: false`, so Better Auth can insert the member and then fail a later active-session update. #169 characterizes and repairs that result inside the application transaction: acceptance verifies the exact persisted member, restores the invitation to accepted, completes any join attempt, and commits success. `activeOrganizationId` may remain null and is never authorization. If the member is absent or the repair fails, the command fails and rolls back.

## Rejected alternatives

### Owner/admin/member administration

Rejected because the baseline needs one payer/owner who can invite members, not delegated group administration. Keeping admin as a product role would add role transitions, member-management rules, last-owner behavior, and UI/API surfaces with no approved use case.

### Caller-selected workspace, role, or resend flag

Rejected because the server already has one unambiguous owner group for the caller. Accepting these fields expands authorization and mass-assignment risk without adding product capability.

### Removing all knowledge of Better Auth's built-in `admin` name

Rejected for the pinned integration because Better Auth merges its default roles and validates invitation roles internally. The smaller compatible design keeps a hidden no-authority definition, then prevents it from being live product state through hooks, hard-coded server inputs, migration normalization, and database guards.

### Membership as private-data access

Rejected by ADR 0003. Family membership may unlock a paid feature, but access to a record still requires user ownership or a typed feature-specific collaborator relation.

## Consequences

- The family-plan group can stay invisible while retaining an immutable organization ID and generated slug for maintainable future billing or explicitly collaborative features.

Implementation status (2026-07-14): [ADR 0009](0009-direct-stripe-family-plan-authority.md)/R-024A implements organization-owned billing and the hard six-accepted-person limit; R-024A2 narrows that result to one manager-or-covered relationship per person and adds only member self-leave. Pending invitations do not reserve capacity, and membership grants paid capability without granting private-data access. This dated status is historical: ADR 0017/#169 now reserves pending unexpired invitations and adds the narrow manager-removal command described above.

- The manager API is smaller: one email-only create command, one role-free list, and ID-bound resend/cancel commands. There is no general organization administration API.
- Existing `admin` and secondary-owner live state is intentionally normalized rather than exposed forever for backward compatibility.
- Better Auth upgrades must recheck built-in role merging, invitation-hook ordering, resend behavior, acceptance role copying, and disabled-path coverage against the exact new pinned source before changing this boundary.

## Evidence and official sources

- [Pinned Better Auth Organization guide](https://github.com/better-auth/better-auth/blob/v1.6.23/docs/content/docs/plugins/organization.mdx)
- [Pinned Better Auth Organization plugin composition and role merging](https://github.com/better-auth/better-auth/blob/v1.6.23/packages/better-auth/src/plugins/organization/organization.ts)
- [Pinned Better Auth invitation implementation](https://github.com/better-auth/better-auth/blob/v1.6.23/packages/better-auth/src/plugins/organization/routes/crud-invites.ts)
- [Pinned Better Auth member implementation](https://github.com/better-auth/better-auth/blob/v1.6.23/packages/better-auth/src/plugins/organization/routes/crud-members.ts)
- [Pinned Better Auth Organization schema](https://github.com/better-auth/better-auth/blob/v1.6.23/packages/better-auth/src/plugins/organization/schema.ts)
- [Pinned Better Auth Organization access statements](https://github.com/better-auth/better-auth/blob/v1.6.23/packages/better-auth/src/plugins/organization/access/statement.ts)
- [Pinned Better Auth background-callback handling](https://github.com/better-auth/better-auth/blob/v1.6.23/packages/better-auth/src/context/create-context.ts#L403-L425)
- [Better Auth Organization invitation advisory](https://github.com/better-auth/better-auth/security/advisories/GHSA-fmh4-wcc4-5jm3)
- [Drizzle migration generation](https://orm.drizzle.team/docs/drizzle-kit-generate)
- [Drizzle migration application](https://orm.drizzle.team/docs/drizzle-kit-migrate)
- [SQLite trigger contract](https://www.sqlite.org/lang_createtrigger.html)
- [SQLite transactions](https://www.sqlite.org/lang_transaction.html)
- [SQLite foreign keys](https://www.sqlite.org/foreignkeys.html)
