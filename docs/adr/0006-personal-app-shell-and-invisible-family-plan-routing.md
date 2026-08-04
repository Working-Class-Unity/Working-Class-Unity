# ADR 0006: Personal app shell and invisible family-plan routing

- Status: accepted
- Date: 2026-07-12
- Decision owner: baseline application
- Issue: [R-020B / #114](https://github.com/smallwiselabs/swl-step-by-step/issues/114)
- Supersedes: the visible `/w/:workspaceSlug` route decision in [ADR 0002](0002-better-auth-organization-workspace-authority.md)
- Billing implementation: [ADR 0009](0009-direct-stripe-family-plan-authority.md) implements the owner-derived backend and the role-oriented `/account/billing` page

## Context

Better Auth Organization remains useful as the sole family-plan membership and invitation authority. It is not, however, a business-workspace navigation model or the default owner of application data. Most baseline resources are private to one user, family-plan membership may supply an entitlement, and a fork that needs collaboration grants access to the specific shared resource.

The prior route decision exposed the automatically generated organization slug through `/w/:workspaceSlug`. That made an internal entitlement group look like a selectable workspace and required public workspace bootstrap and lookup endpoints even though the baseline has no workspace switcher, member administration, or organization-scoped private-resource routes.

## Decision

- `/app` is the authenticated, private, non-cacheable personal application shell. It does not redirect through an organization slug or render workspace identity, role, capability, or membership data.
- Better Auth Organization remains the sole organization, membership, invitation, and organization-role authority. The automatically provisioned organization, immutable organization ID, generated slug, personal-owner marker, and membership constraints remain in the database; this ADR changes their presentation and routing, not their authority.
- `GET /api/me` returns only the authenticated user's minimized identity plus the safe enabled-module projection. It does not return memberships, a personal default, an organization slug, `activeOrganizationId`, capabilities, or an entry target.
- Public `GET /api/workspaces` and `GET /api/workspaces/:workspaceSlug` routes are removed. A future family-plan operation derives the owner's marked organization on the server or resolves an immutable organization ID from the resource being operated on, then re-reads persisted membership. It does not trust client selection or `session.activeOrganizationId`.
- Invitation acceptance re-reads the recipient's exact persisted membership by immutable organization ID and returns `/app`. Joining a family plan never changes the invitee's private-data visibility.
- Private product routes remain user-scoped, including `/app/projects` and `/app/projects/:projectId`. Features that genuinely share data add a feature-specific collaborator relationship rather than restoring a universal workspace route hierarchy.
- The account billing screen is `/account/billing`. Billing APIs derive the paying owner's family-plan organization on the server; they do not accept a workspace slug as authority. R-024 retains the actual Stripe API and lifecycle design.
- R-020A/#115 removes the interim frontend `/auth` route. A signed-out `/app` request returns to app-owned `/login`; `/login` and `/signup` share one passwordless/social system, and authenticated `/account` owns identity and provider unlinking. R-021/#23 moves sign-out to the authenticated account menu. Better Auth's framework endpoints remain under `/api/auth/**`.

## Authorization consequences

Removing visible workspace routing does not collapse the separate authorization questions:

1. Private-resource access uses the authenticated user ID or a feature-specific collaborator record.
2. Paid capability uses current persisted family-plan membership and billing entitlement.
3. Owner invitation, billing, and lifecycle commands derive the caller's marked organization and re-read the applicable membership on the server.

Navigation state, organization slugs, and `activeOrganizationId` answer none of those questions by themselves.

## Rejected alternatives

### Keep `/w/:workspaceSlug` as a future-proof namespace

Rejected because the baseline's organization represents family-plan access, not a container for every member's application data. Keeping the visible namespace would preserve route, DTO, error-state, and switcher concepts without a current product guarantee.

### Replace Better Auth Organization with an app-owned family-plan table

Rejected because Better Auth still supplies the needed maintained organization, membership, invitation, and role authority. This route simplification does not justify recreating those records or operating two authorities.

### Use `activeOrganizationId` as hidden application scope

Rejected because it is mutable session convenience state and cannot prove persisted membership or private-resource access. The personal shell needs no selected organization.

### Put billing back under the current `/api/billing` user route indefinitely

Rejected as the canonical future direction because the paid plan belongs to the owner's family-plan group. R-024 will define owner-derived commands and provider behavior under `/account/billing`; this ADR does not implement Stripe changes.

Implementation status (2026-07-14): R-024A replaced that retired API with `GET /api/account/billing`, non-covered-owner-only checkout/portal/reconcile commands beneath it, and `POST /api/webhooks/stripe`. R-024A2 additionally exposes core `POST /api/account/family/leave` for a caller to remove only their own external membership. R-024B/#127 renders the resulting independent/manager/member projection at `/account/billing`, while the server continues to derive both authority boundaries from persisted immutable organization membership and ignores `activeOrganizationId`.

## Consequences

- The route shell becomes smaller and has no organization-selection or slug-canonicalization state.
- Existing organization rows and migrations remain valid for family-plan membership, invitations, entitlements, and immediate owner-account deletion.
- Private-resource isolation remains user-owned by default. Family membership unlocks paid capability but does not expose another member's records.
- A future fork may add an explicit collaborative route for a specific shared resource without changing identity, family-plan billing, or private-resource ownership.
- ADR 0002 remains historical authority for the Better Auth Organization migration and membership constraints, but its visible `/w` route decision no longer applies.

## Evidence and official sources

- [Pinned Better Auth Nuxt integration](https://github.com/better-auth/better-auth/blob/v1.6.23/docs/content/docs/integrations/nuxt.mdx)
- [Pinned Better Auth Organization guide](https://github.com/better-auth/better-auth/blob/v1.6.23/docs/content/docs/plugins/organization.mdx)
- [Pinned Better Auth Organization member API](https://github.com/better-auth/better-auth/blob/v1.6.23/docs/content/docs/plugins/organization.mdx#L1192-L1278)
- [Nuxt `useFetch` SSR behavior](https://nuxt.com/docs/4.x/api/composables/use-fetch)
- [ADR 0003: family-plan entitlements and user-owned data](0003-family-plan-entitlements-and-user-owned-data.md)
- [ADR 0004: owner/member family-plan boundary](0004-owner-member-family-plan-boundary.md)
