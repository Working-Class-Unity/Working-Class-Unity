# ADR 0002: Better Auth Organization as workspace authority

- Status: accepted; private-resource ownership partially superseded by [ADR 0003](0003-family-plan-entitlements-and-user-owned-data.md), roles/invitation management partially superseded by [ADR 0004](0004-owner-member-family-plan-boundary.md), visible workspace routing superseded by [ADR 0006](0006-personal-app-shell-and-invisible-family-plan-routing.md), and family billing/member self-leave narrowed by [ADR 0009](0009-direct-stripe-family-plan-authority.md)
- Date: 2026-07-11
- Decision owner: baseline application
- Issue: [R-017 / #19](https://github.com/smallwiselabs/swl-step-by-step/issues/19)
- Invitation amendment: [R-017I / #64](https://github.com/smallwiselabs/swl-step-by-step/issues/64)
- Private-data amendment: [R-019C / #84](https://github.com/smallwiselabs/swl-step-by-step/issues/84)
- Family-plan amendment: [R-018A / #78](https://github.com/smallwiselabs/swl-step-by-step/issues/78)
- Route amendment: [R-020B / #114](https://github.com/smallwiselabs/swl-step-by-step/issues/114)
- Pre-release database amendment: [ADR 0008](0008-pre-release-database-rebaseline.md) supersedes this ADR's active-migration-chain and predecessor-compatibility decisions; Better Auth Organization authority remains accepted
- Supersedes: [ADR 0001](0001-app-owned-workspace-and-url-scope.md)

## Context

The baseline must support shared accounts: an owner can pay for a family or team workspace and invite other people, while every person keeps an independent login. Better Auth `1.6.23` already owns identity and sessions, and its Organization plugin supplies organizations, memberships, invitations, roles, and a maintained invitation lifecycle. Continuing with the custom workspace layer would duplicate that collaboration authority in every fork.

The product still needs explicit request scope. Better Auth documents that `activeOrganizationId` starts as `null` and that client-only selection can allow different tabs to use different organizations. A selected session value is therefore a convenience, not proof that a request may access an application resource.

## Decision

Better Auth Organization `1.6.23` is the sole organization, membership, invitation-record, and organization-role authority. The UI continues to call an organization a **workspace**.

- Use the plugin's default `organization`, `member`, and `invitation` fields plus nullable `session.activeOrganizationId`, then add baseline-owned personal-owner, unique-membership, and single-role constraints. Do not retain or recreate a parallel `workspace`/`workspace_membership` authority.
- Every user receives one shareable personal organization. A private unique `personal_owner_user_id` marker identifies it. Migration `0008` repairs a supported predecessor missing that organization, its owner membership, or the owner's role before enforcing the invariant. It also installs an SQLite `AFTER INSERT` user trigger that inserts the organization and owner member as part of the same user statement, so a constraint failure rolls back all three rows.
- Keep the Drizzle adapter's optional transaction wrapper disabled for the synchronous `better-sqlite3` driver. Better Auth supplies an asynchronous callback, while pinned `better-sqlite3` explicitly states that its transaction functions do not work with async functions. Client-created additional organizations remain disabled initially.
- The original implementation persisted one static `owner`, `admin`, or `member` role. [ADR 0004](0004-owner-member-family-plan-boundary.md) supersedes that product matrix with `owner` and `member` only, retaining a hidden no-authority `admin` definition solely for pinned Better Auth compatibility. Teams and dynamic roles remain disabled. Billing actions extend the access statements; ADR 0003 removes private project actions because family membership is not project authority.
- Keep canonical `/w/:workspaceSlug/...` routes for organization-specific collaboration surfaces. The automatically generated opaque slug is stable and non-editable, but remains only a route candidate. ADR 0003 uses clean user-scoped routes for private projects instead of passing organization scope into them. ADR 0006 later supersedes the visible `/w` route hierarchy for this personal-app baseline while retaining the immutable organization ID, generated slug, and server-derived membership authority internally.
- `activeOrganizationId` may help client UX, but application authorization never depends on it alone. Ordinary navigation does not mutate it; pinned Better Auth invitation acceptance does. Two tabs keep independent workspace URLs because every request reauthorizes the URL-selected organization rather than trusting shared session selection.
- Public Organization HTTP endpoints for deletion, leave/transfer, invitation mutation, and broad member/invitation reads remain unavailable. R-017I invokes the pinned invitation server APIs only behind application routes that authenticate, minimize output, and preserve verified-recipient concealment. ADR 0004 supersedes the original URL-selected manager scope: manager routes now derive the authenticated owner's uniquely marked organization and never accept caller-selected scope or role. Trusted server APIs are not an authorization shortcut.
- Invitation delivery runs after Better Auth creates or reuses the pending record and is awaited through the application email adapter. The plugin's `sendInvitationEmail` callback is not configured because pinned Better Auth catches that callback's rejection. A generic delivery failure leaves the pending record available for explicit same-ID resend rather than reporting false success or creating a parallel invitation table.
- Migrate forward from the already-shipped custom tables in one append-only migration: create the plugin models, preserve existing organization and membership identities and roles, validate the copy, then remove the superseded tables. Existing migrations remain immutable.

## Permission policy (as amended by ADRs 0003 and 0004)

The original R-017 implementation deliberately narrowed the plugin's extensibility to three single roles. ADR 0004 now narrows the product-facing live state further:

- `member`: no organization-administration authority;
- `owner`: invitation management and billing read/manage for the owner's marked family-plan group only while the person is not an accepted member elsewhere, as narrowed by ADR 0009;
- hidden compatibility `admin`: no application authority and prohibited from new live membership or pending-invitation state.

Private project permissions are intentionally absent. Family membership may later contribute an entitlement, but it never authorizes private records.

Native or caller-scoped organization deletion, leave/transfer, member-directory, member-management, and role-mutation endpoints remain disabled. R-018C/#80 implements owner-account deletion. ADR 0009/R-024A2 adds one narrower app-owned exception: an accepted member may remove only their own derived external membership through `POST /api/account/family/leave`; an owner cannot leave or transfer. Staff privilege, onboarding state, and billing entitlement remain separate axes.

## Rejected alternatives

### Custom workspaces beside Better Auth Organization

Rejected because two organization, membership, role, invitation, and lifecycle authorities can disagree. The migration replaces the custom authority rather than mapping both models onto the same tables.

### Session-selected organization as authorization

Rejected because selection is mutable shared session state and Better Auth explicitly permits client-only selection. Persisted membership plus an immutable organization ID is the server boundary.

### Clean `/app/...` routes with hidden workspace selection (later adopted by ADR 0006)

Originally rejected because preserving the existing `/w/:opaqueSlug` hierarchy required less custom selection state and kept concurrent tabs explicit. The later product clarification that organizations are invisible family-plan groups, not general application-data scopes, removed the need for visible workspace selection. ADR 0006 therefore adopts a personal `/app` shell without introducing hidden client selection state: owner-derived family-plan operations still resolve the immutable organization ID on the server.

### Better Auth's Stripe plugin as billing authority

Rejected for the future billing slice because the pinned route implementation does not supply the application's required durable event receipt/order ledger or seat-policy boundary. Billing will use the official Stripe Node SDK and immutable organization IDs; this ADR installs no Stripe integration.

## Consequences

- Better Auth owns collaboration records, but it does not authorize arbitrary application tables. ADR 0003 makes projects user-owned and requires the authenticated user ID in every project query. Future resources must choose individual ownership or explicit feature-specific collaboration rather than inheriting organization membership implicitly.
- R-017 owns the authority replacement, migration, static permissions, personal provisioning, and request-context evidence.
- R-017I owns truthful invitation delivery and privacy-minimized application routes on top of Better Auth invitation records. The selected `transaction: false` SQLite adapter means Better Auth's invitation acceptance is not internally all-or-nothing across member insertion and the later active-session update. #169 keeps the application command inside `BEGIN IMMEDIATE`, verifies the exact persisted member after either Better Auth outcome, repairs the invitation to accepted before commit, and treats nullable `activeOrganizationId` as non-authoritative. App-owned reject/cancel commands use pending-to-terminal compare-and-set updates inside the same database boundary. Process-local queues still order async work on one synchronous connection and same-ID resend delivery in the documented one-replica topology, but terminal membership and capacity correctness no longer rely only on that process-local lock.
- R-018A/#78 implements the narrowed owner/member family-plan and invitation surface recorded in ADR 0004. R-018C/#80 implements immediate account deletion; export and ownership transfer are canceled by product decision.
- Mobile framework selection remains deferred. A native client must carry or resolve an organization ID, reauthorize server-side, partition caches by user and organization, and clear them on logout or membership loss.

## Evidence and official sources

- [Pinned Better Auth Organization guide](https://github.com/better-auth/better-auth/blob/v1.6.23/docs/content/docs/plugins/organization.mdx)
- [Pinned Better Auth invitation implementation](https://github.com/better-auth/better-auth/blob/v1.6.23/packages/better-auth/src/plugins/organization/routes/crud-invites.ts)
- [Pinned Better Auth background-callback handling](https://github.com/better-auth/better-auth/blob/v1.6.23/packages/better-auth/src/context/create-context.ts#L403-L425)
- [Better Auth Organization invitation advisory](https://github.com/better-auth/better-auth/security/advisories/GHSA-fmh4-wcc4-5jm3)
- [Pinned default Organization access statements](https://github.com/better-auth/better-auth/blob/v1.6.23/packages/better-auth/src/plugins/organization/access/statement.ts)
- [Pinned Better Auth post-transaction hook implementation](https://github.com/better-auth/better-auth/blob/v1.6.23/packages/core/src/context/transaction.ts)
- [Better Auth's post-commit hook correction](https://github.com/better-auth/better-auth/pull/7345)
- [Pinned `better-sqlite3` transaction caveat](https://github.com/WiseLibs/better-sqlite3/blob/v12.10.0/docs/api.md#transactionfunction---function)
- [Pinned Better Auth Drizzle schema generator](https://github.com/better-auth/better-auth/blob/v1.6.23/packages/cli/src/generators/drizzle.ts)
- [Better Auth Drizzle field-name mapping](https://better-auth.com/docs/adapters/drizzle#modifying-field-names)
- [Pinned Better Auth Stripe route implementation](https://github.com/better-auth/better-auth/blob/v1.6.23/packages/stripe/src/routes.ts#L1988-L2087)
- [SQLite trigger contract](https://www.sqlite.org/lang_createtrigger.html)
- [Better Auth June 2026 Organization security update](https://better-auth.com/blog/security-update-june-2026#organization)
