# ADR 0001: App-owned workspaces with URL-authoritative scope

- Status: superseded by [ADR 0002](0002-better-auth-organization-workspace-authority.md)
- Date: 2026-07-10
- Decision owner: baseline application
- Issue: [R-012 / #10](https://github.com/smallwiselabs/swl-step-by-step/issues/10)

> This decision described the first implemented tenancy boundary. The product owner later clarified that the baseline itself must support a payer inviting family or team members with independent logins. [ADR 0002](0002-better-auth-organization-workspace-authority.md) therefore replaces this authority model while retaining URL-selected workspace scope.

## Context

The baseline needs a lightweight personal workspace for every user and a safe path to shared workspaces in later forks. Better Auth `1.6.23` already owns identity, sessions, provider accounts, and verification. Its optional Organization plugin could also own organizations, memberships, invitations, roles, and active-organization session state. The alternative is an application-owned `workspace` and `workspace_membership` domain that references Better Auth users.

This decision must also choose how a request names its workspace. The model and selector choices are independent: Better Auth Organization endpoints accept explicit organization IDs/slugs, and its official guide permits client-only selection instead of persisting an active organization. A server-session selection keeps URLs short but makes every tab sharing that session observe the same mutable selection. A URL selection gives each tab an explicit candidate scope that the server can verify independently.

## Decision

The baseline will use one **app-owned workspace layer** and **URL-authoritative workspace scope**.

- Better Auth continues to own `user`, `session`, `account`, `verification`, and authentication endpoints. The baseline will not enable `organization()` or `organizationClient()`, create Better Auth organization/member/invitation tables, or add `activeOrganizationId` to an auth session.
- The application will own `workspace` and `workspace_membership`. Membership has one persisted role: `owner`, `admin`, or `member`. Global staff privilege, onboarding state, and entitlements remain separate policy axes.
- Canonical private pages use `/w/:workspaceSlug/...`. Canonical workspace API routes likewise name a workspace route key. The route value is only a candidate: the server resolves it to an immutable workspace ID, verifies the authenticated user's membership and capability, and uses that ID in every private database predicate.
- `/app` is an authenticated entry/bootstrap route. It deterministically redirects to the canonical URL for the user's personal/default workspace; it is not a second hidden source of workspace authority.
- Switching workspaces is navigation. It changes the current tab's URL and does not mutate a session-level workspace selection, so two tabs may safely remain in different workspaces.
- Invitations, if enabled by a collaboration feature, use the same app-owned workspace domain. A fork may replace this decision with Better Auth Organization through an explicit migration, but it must remove the app-owned tenancy model rather than run both.

## Comparison spike

| Concern                      | Better Auth Organization                                                                                                                                                                                                                                        | App-owned workspace layer                                                                                                                | Result                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Schema ownership             | The plugin declares organization, member, and invitation models and extends session state with `activeOrganizationId`. Names and fields can be mapped, but the plugin retains the model and endpoint semantics.                                                 | The application declares only the workspace, membership, uniqueness, foreign-key, and lifecycle invariants required by the baseline.     | App-owned                                                                |
| Personal workspace           | Organization creation is explicit and active organization initially defaults to `null`. A user-creation database hook can add custom provisioning logic and can participate in an adapter transaction; automatic personal workspaces are not a built-in policy. | The application can idempotently ensure its exact personal-workspace and owner-membership contract after authentication.                 | App-owned                                                                |
| Roles and permissions        | The plugin supplies owner/admin/member defaults and also supports multiple and custom roles under its access-control contract.                                                                                                                                  | The baseline can persist exactly one owner/admin/member role and derive its fixed capability matrix separately.                          | App-owned                                                                |
| URL versus session selection | `setActive` persists an active organization on the auth session, but endpoints also accept explicit organization IDs/slugs and the official guide permits client-only selection. The plugin does not force a session selector.                                  | The application could also implement either selector. A workspace route key needs no mutable auth-session selection.                     | URL scope, independently of model choice                                 |
| Cross-tab behavior           | Persisted `setActive` state is shared and last-write-wins across tabs using one session. Client-only or URL selection avoids that behavior, as the official guide notes.                                                                                        | Each URL-selected tab retains its own candidate. A tab cannot silently change the candidate of an already-open mutation in another tab.  | URL scope                                                                |
| Invitations                  | The plugin provides a substantial maintained invitation lifecycle, including delivery hooks, expiry, permissions, and accept/reject/cancel operations.                                                                                                          | The application must implement and security-maintain collaboration invitations against its workspace domain when that feature is added.  | Plugin advantage acknowledged; not enough to move core tenancy into auth |
| Upgrade and migration risk   | Product tenancy schema and authorization behavior move with Better Auth. Official history includes a breaking Organization team-schema change and a later high-severity invitation-ownership fix; the pinned `1.6.23` release includes that fix.                | Better Auth upgrades remain focused on identity, but the application assumes responsibility for workspace migrations and security fixes. | App-owned                                                                |
| Better Auth coupling         | Tenancy would depend on Better Auth schema, client plugin, API routes, role semantics, invitations, and active-session fields.                                                                                                                                  | The only required link is the authenticated Better Auth user ID referenced by membership.                                                | App-owned                                                                |

The exact installed `1.6.23` plugin was also exercised in a disposable SQLite spike. Its declared schema contained `organization`, `member`, `invitation`, and `session.activeOrganizationId`. Two simulated tabs sharing one session token both read the most recently selected organization after successive `setActive` calls. This confirms the documented persisted-session selector; it does not imply that the plugin requires that selector. The result is evidence about a rejected configuration, not a permanent regression test for unused plugin behavior.

## Rejected alternatives

### Better Auth Organization as the baseline tenancy model

This option is capable, includes useful collaboration behavior, and could be paired with the same URL-authoritative selector. It was rejected because the baseline's required tenancy contract is smaller and more application-specific than the plugin contract. Moving workspace schema, roles, invitations, lifecycle, and API semantics into the auth plugin creates coupling that its current conveniences do not justify for this baseline.

### App-owned workspaces plus Better Auth Organization

Rejected. Parallel organization/workspace tables, roles, invitations, or selection state would create two authorities and ambiguous lifecycle behavior. There is no supported hybrid baseline.

### App-owned workspaces with session-selected scope

Rejected. A shared session selection permits one tab to change the server-resolved scope of another tab. Preventing stale-tab mutations would require another workspace expectation/version mechanism, while URL scope already carries stable, visible request context.

## Migration and implementation consequences

This ADR changes no schema, migration, auth configuration, or runtime route. The current fresh-database and supported maintenance/rollback gates remain regression evidence only.

- R-013 / #13 owns the app-owned workspace and membership schema, database constraints, safe forward migration, and rollback/recovery evidence.
- R-014 and R-015 / #16 and #17 own passwordless email and social identity; they do not acquire workspace ownership.
- R-016 / #18 owns idempotent personal-workspace provisioning, `/app` resolution, membership-verified URL scope, and multi-tab behavior tests.
- R-017 / #19 owns persisted capabilities and removal of fabricated session roles.
- R-018 / #20 owns export, ownership transfer, deletion, and retryable cleanup across the app-owned lifecycle registry.

A fork that later replaces this model with Better Auth Organization must design and test a one-way data migration, route/API transition, ownership/lifecycle reconciliation, and rollback before enabling the plugin. Mapping plugin table names onto app-owned tables without adopting the plugin's full invariants is not a migration plan.

## Evidence

- [Better Auth Organization guide: schema and customization](https://better-auth.com/docs/plugins/organization#schema)
- [Better Auth Organization guide: active organization and multi-tab distinction](https://better-auth.com/docs/plugins/organization#active-organization)
- [Better Auth Organization guide: access control](https://better-auth.com/docs/plugins/organization#access-control)
- [Better Auth Organization guide: invitations](https://better-auth.com/docs/plugins/organization#invitations)
- [Pinned `1.6.23` Organization documentation](https://github.com/better-auth/better-auth/blob/v1.6.23/docs/content/docs/plugins/organization.mdx#L610-L668)
- [Pinned `1.6.23` Organization schema](https://github.com/better-auth/better-auth/blob/v1.6.23/packages/better-auth/src/plugins/organization/schema.ts#L100-L204)
- [Pinned `1.6.23` organization creation and active-session source](https://github.com/better-auth/better-auth/blob/v1.6.23/packages/better-auth/src/plugins/organization/routes/crud-org.ts#L57-L303)
- [Pinned `1.6.23` transactional user-hook test](https://github.com/better-auth/better-auth/blob/v1.6.23/packages/better-auth/src/plugins/organization/organization-hook.test.ts#L5-L180)
- [Better Auth 1.3 Organization team-schema breaking change](https://better-auth.com/blog/1-3#multi-team-support)
- [Better Auth June 2026 Organization invitation security update](https://better-auth.com/blog/security-update-june-2026#organization)
- [Better Auth `1.6.23` release](https://github.com/better-auth/better-auth/releases/tag/v1.6.23)
