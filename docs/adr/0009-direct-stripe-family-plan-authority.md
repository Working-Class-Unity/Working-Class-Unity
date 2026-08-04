# ADR 0009: Direct Stripe family-plan billing authority

- Status: accepted
- Date: 2026-07-14
- Decision owner: baseline application
- Issue: [R-024A / #126](https://github.com/smallwiselabs/swl-step-by-step/issues/126)
- Strict-authority amendment: [R-024A2 / #129](https://github.com/smallwiselabs/swl-step-by-step/issues/129)
- Personal/Family subscription amendment: [ADR 0017](0017-stripe-personal-family-subscriptions.md) supersedes this ADR's one-Family-Price catalog and checkout-selection decisions; its family authority, entitlement, privacy, and deletion decisions remain accepted
- Final rebaseline: [ADR 0015](0015-final-pre-release-database-rebaseline.md) supersedes this ADR's migration numbers and predecessor/rollback mechanics; its billing, family-authority, privacy, and deletion decisions remain accepted
- Builds on: [ADR 0003](0003-family-plan-entitlements-and-user-owned-data.md), [ADR 0004](0004-owner-member-family-plan-boundary.md), [ADR 0005](0005-immediate-account-deletion-and-billing-detachment.md), and [ADR 0006](0006-personal-app-shell-and-invisible-family-plan-routing.md)
- Current migration package: [ADR 0010](0010-remove-local-search-and-fts.md) later adds forward migrations `0005` and `0006`; this ADR's five-entry references record the package at the billing decision

## Context

One payer may invite family members who each keep a separate login and private data. Better Auth Organization is the maintained membership/invitation authority, but it does not secure application resources or define this product's Stripe lifecycle. Billing must belong to the invisible family-plan organization without making organization membership a private-data permission.

The product has one paid authority per person, not independent personal billing layered beneath inherited family access. A person may be independent, manage the subscription for their own family group, or be an accepted member of one other family group. They may not hold those manager/member relationships in parallel, and a covered member's automatically provisioned personal organization remains dormant until the member leaves. Weekly, monthly, or yearly billing is cadence for the same paid capability, not a separate plan or permission.

The baseline is pre-release, but `0000`/`0001` remains its supported initialized database prefix. #169 appends `0002`/`0003`, producing the current four-entry, 30-trigger package while preserving recognized initialized state. Provider protocol and signature cryptography use Stripe's maintained SDK rather than handwritten HTTP or HMAC code.

## 2026-07-28 Personal/Family amendment

[ADR 0017](0017-stripe-personal-family-subscriptions.md) supersedes the following accepted product decisions in this ADR:

- The one-Family-Price catalog is replaced by exactly five Stripe offerings: Personal weekly/monthly/annual and Family monthly/annual. Clients still submit only stable application offering keys, never Price IDs or quantities.
- Pending, unexpired Family invitations now reserve seats. The accepted-member plus reserved-invitation total cannot exceed the six-person Family capacity.
- There are no free trials. `trialing` does not grant entitlement. Stripe `past_due` grants only the separately approved 14-day application grace period; access is suspended after that deadline unless verified current Stripe state recovers.
- Member self-leave remains caller-only, but it is no longer the sole member-removal command. A billing-current Family manager also receives the narrow server-owned removal command approved in #169.
- Billing-owner account deletion no longer performs only local detachment. The server must durably cancel and confirm the Stripe subscription before reporting local deletion success; ambiguous cancellation preserves the account and requires recovery.

The migration numbers and historical baseline facts below remain the record of this ADR's original implementation. The newer decisions above govern forward implementation.

## Decision

- Pin the official `stripe@22.3.1` server SDK and API version `2026-06-24.dahlia`. Do not install `@better-auth/stripe`: Better Auth remains membership authority while application code owns plan, entitlement, ordering, reconciliation, privacy, and deletion policy.
- Support the five stable Personal/Family application offerings and private server Price mapping defined by ADR 0017. Checkout always uses subscription mode and quantity `1`; clients cannot choose a Price, customer, quantity, organization, or provider mode.
- A Family plan covers at most six people including its owner. Accepted members and pending unexpired invitations consume that capacity under the forward reservation guard required by ADR 0017.
- Store one organization-owned Stripe customer, one durable logical Checkout attempt, and one current subscription snapshot. Do not add a subscription-history, parallel membership table, or generic entitlement framework. Checkout retries reuse the logical attempt's stable provider idempotency key.
- Enforce at most one accepted external `member` membership per person. A covered member retains the owner membership in their automatically provisioned personal organization, but that organization is commercially dormant: the member cannot start Checkout, open Portal, reconcile, change cadence, cancel billing, or otherwise manage its Stripe state, even when the manager's subscription no longer grants access. Terminal provider history or a retained customer record does not restore those commands while external membership remains.
- Grant paid capability for a verified `active` subscription or the bounded local grace period approved by ADR 0017. The product offers no trial; unrecognized `trialing` state fails closed. Membership grants entitlement only; it never grants access to another person's projects, files, AI history, or other private records. Entitlement-granting state and commercial-authority state are deliberately different: granting, chargeable, resumable, cancel-at-period-end, pending-Checkout, and reconciliation-required personal state all prevent joining another family or starting a parallel subscription. A terminal canceled or expired subscription may remain as lifecycle history but is not current billing authority.
- Billing commands derive the caller's marked personal organization, re-read current persisted owner and external-member relationships, and reauthorize around provider work and any returned provider URL. They never trust `activeOrganizationId`. `GET /api/account/billing` returns a minimized role-oriented projection; only a caller who is not covered by another family may use the `POST` checkout, portal, and reconcile commands under that prefix.
- `POST /api/account/family/leave` remains the sole self-leave command. It is authenticated core behavior rather than a Billing-module route, derives the caller's one persisted external membership, accepts no organization/member selector, and atomically removes only that membership while clearing the caller's affected active-organization session pointers. The app owns this narrow transaction because pinned Better Auth performs those writes separately while its async adapter transaction wrapper is disabled. ADR 0017 separately adds a narrow billing-current manager removal command using an opaque immutable member reference. Neither command cancels the manager's subscription, deletes either account or private data, transfers ownership, or exposes an unrestricted member directory. An owner cannot leave or transfer their own marked group. Checkout eligibility is recalculated only after the mutation commits and all remaining conflicts are absent.
- Invitation acceptance is the authoritative admission boundary. It fails closed when the recipient already belongs to another family, has accepted members or unresolved outgoing invitations in their own group, or has personal billing/Checkout/reconciliation state that could produce dual authority. Acceptance, Checkout, and reconciliation must not win conflicting races; ambiguous partial state requires explicit recovery instead of silently choosing a family or subscription.
- The webhook is exactly `POST /api/webhooks/stripe`. Verify its unmodified body with the official SDK, process only the reviewed Checkout/subscription event allowlist, fetch current provider state outside the SQLite transaction, and atomically apply only a newer unambiguous projection before recording the minimized receipt last.
- Multiple live subscriptions, equal provider ordering, unexpected Price/item/quantity shape, customer/organization conflicts, conflicting family relationships, or a local full-revision race set reconciliation-required state and deny entitlement/new checkout rather than choosing a winner. Manager reconciliation paginates provider subscriptions and may update only the exact local revision and authority relationship it inspected.
- Persist no raw webhook payload. Event receipts contain only provider event ID/type/time and processing time. The current snapshot retains only provider identifiers/status, plan/Price, current period, ordering, and reconciliation fields needed for authorization and recovery.
- Billing-owner account deletion first durably cancels and confirms the Stripe subscription as specified by ADR 0017. Only then may local deletion remove live organization billing and retain detached rows for justified subscription, unresolved Checkout-attempt, or known-customer continuity, containing identity-free provider/customer references, status/order timestamps, reconciliation purpose/policy, and optional purge time. It contains no user/organization identity, Price, raw payload, receipt, or private content.
- `/account/billing` renders the minimized role-oriented projection. An independent eligible person may start one of the five Personal/Family offerings defined by ADR 0017; a manager may use only server-authorized management/reconciliation commands for their own family; a covered member sees `Family membership` and may only leave their own membership. A Checkout success return is not proof of payment and does not grant access before the local projection changes. Stripe Product, Price, Portal, webhook endpoint, sandbox, ordering, retry, and lifecycle certification belong to #37; deterministic local SDK fixtures are not that evidence.
- Billing remains an optional module. A fork with no paid product keeps `NUXT_MODULES_BILLING_ENABLED=false`, needs no Stripe account or credentials, makes no Stripe provider call, and remains healthy. Its core identity, private-data, family-membership, and self-leave boundaries remain valid; enabling Billing later requires the reviewed configuration and sandbox evidence rather than a silent fallback.

## Consequences

- Forward migration `0002` converts the earlier user-oriented billing shape to organization-owned customer/attempt/current-snapshot/minimized-receipt tables, preserving recognized state and marking ambiguous predecessor state for reconciliation rather than guessing.
- Custom migration `0003` installs the accepted-member capacity trigger. Forward migration `0004` persists `cancel_at_period_end`, adds the one-external-membership index, and installs reciprocal invitation/member/Checkout/subscription authority guards. Fresh initialization applies all five entries; a recognized initialized prefix upgrades transactionally and supports corrected retry after failure.
- The account page links to the billing page only when Billing is ready. A disabled unpaid fork renders no billing UI and needs no Stripe account or credentials; module-owned page/API/webhook requests fail concealed before database or provider work. Disabling Billing is not a decommissioning path for an already-live provider subscription.
- Provider availability is not part of readiness. Configuration completeness fails before listen when Billing is enabled; sandbox/live behavior remains external evidence.
- The one-authority invariant makes billing UI role-oriented: an independent person may subscribe, a family manager may manage, a covered member may see inherited status and leave, and ambiguous state exposes neither billing path. Stopping entitlement alone does not turn a member into a personal billing manager.

## Rejected alternatives

### Better Auth Stripe plugin

Rejected for this baseline because it would not remove the application-owned entitlement, conflict, privacy, deletion, and lifecycle rules, while coupling provider state to a second plugin authority. The direct official SDK is the smaller boundary for the approved product.

### Per-member Stripe quantity

Rejected because the product sells one family plan rather than metered seats. Quantity remains `1`; the application separately enforces six accepted people.

### Parallel personal billing while covered

Rejected because a dormant personal subscription can remain chargeable or resumable after inherited entitlement changes. Allowing a covered member to manage it would create two commercial authorities for one person and make invitation acceptance, cancellation, and recovery ambiguous. The member must first leave the joined family through the narrow self-leave command.

### Cadence as separate plans or entitlements

Rejected because weekly, monthly, and yearly Prices buy the same capability. #169 lets cadence select one of the fixed provider billing frequencies in the current catalog, but it does not create separate plan keys, permissions, family memberships, or simultaneous subscriptions.

### Pending invitations do not reserve capacity

Rejected by the 2026-07-28 amendment. Pending, unexpired invitations reserve capacity so invitation delivery and acceptance cannot silently exceed the six-person Family limit.

### Store provider event bodies or subscription history

Rejected because current authorization and reconciliation require only the minimized receipt and current projection. Raw payload/history would increase privacy and lifecycle burden without an approved product guarantee.

## Evidence and official sources

- [Pinned Stripe Node SDK `v22.3.1`](https://github.com/stripe/stripe-node/tree/v22.3.1)
- [Stripe webhook signature verification](https://docs.stripe.com/webhooks/signature)
- [Stripe webhook event ordering and duplicate guidance](https://docs.stripe.com/webhooks#handle-duplicate-events)
- [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment)
- [Stripe Billing Portal integration](https://docs.stripe.com/customer-management/integrate-customer-portal)
- [Stripe subscription statuses](https://docs.stripe.com/api/subscriptions/object#subscription_object-status)
- [Stripe recurring Price cadence](https://docs.stripe.com/api/prices/object#price_object-recurring)
- [Pinned Better Auth Organization documentation](https://github.com/better-auth/better-auth/blob/v1.6.23/docs/content/docs/plugins/organization.mdx)
- [Pinned Better Auth member implementation](https://github.com/better-auth/better-auth/blob/v1.6.23/packages/better-auth/src/plugins/organization/routes/crud-members.ts)
- [Drizzle Kit migration generation](https://orm.drizzle.team/docs/drizzle-kit-generate)
- [Drizzle Kit custom migrations](https://orm.drizzle.team/docs/kit-custom-migrations)
- [SQLite transactions](https://www.sqlite.org/lang_transaction.html)
- [SQLite triggers](https://www.sqlite.org/lang_createtrigger.html)
