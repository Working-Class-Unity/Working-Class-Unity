# ADR 0017: Stripe Personal and Family subscriptions

- Status: accepted
- Date: 2026-07-28
- Decision owner: baseline application
- Issue: [#169](https://github.com/smallwiselabs/baseline/issues/169)
- Amends: [ADR 0009](0009-direct-stripe-family-plan-authority.md)

## Context

The web application needs a small, explicit subscription catalog without introducing another billing provider or a generic product framework. The approved work is limited to Stripe subscription updates. Apple App Store and Google Play billing, native iOS or Android store builds, and provider-neutral abstractions are outside this decision.

Stripe Price IDs are deployment-specific provider identifiers. They must remain private server runtime configuration and must not become client input or public catalog metadata. Application code still needs stable identifiers for the five approved choices and must be able to map those identifiers to Stripe Prices in both directions without guessing.

Billing also performs durable asynchronous work. A deployment that enables Billing without Jobs cannot safely complete that lifecycle.

## Decision

- Stripe is the only subscription provider. The application keeps its existing single `Billing` module flag and does not add provider flags or an Apple/Google abstraction.
- The complete application catalog has exactly five stable offering keys: `personal.weekly`, `personal.monthly`, `personal.annual`, `family.monthly`, and `family.annual`.
- Each key derives one plan (`personal` or `family`) and one cadence (`weekly`, `monthly`, or `annual`). Cadence selects billing frequency; it does not create an entitlement or authorization class.
- Public shared metadata contains only stable application identifiers and their derived plan and cadence. It contains no Stripe Product or Price ID, secret, amount, currency, Portal configuration, or environment-variable name.
- One Stripe Product has five recurring Prices. Server runtime configuration supplies one distinct Price ID for each application offering plus one explicit Billing Portal configuration ID. The server owns the bidirectional offering-key/Price-ID map and rejects incomplete, duplicate, and unrecognized values rather than selecting a fallback.
- `NUXT_STRIPE_SECRET_KEY` accepts only a Stripe restricted key (`rk_test_*` or `rk_live_*`). An unrestricted `sk_*` key is a readiness error even when its permissions would otherwise permit the calls.
- Enabling Billing requires Jobs to be enabled. Billing readiness fails before the server listens when either its Stripe configuration is incomplete or Jobs is disabled.
- With Billing disabled, Stripe configuration is ignored even when stale values remain. Disabled Billing must not construct a Stripe client or make provider calls.
- Runtime Price IDs use `NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID`, `NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID`, `NUXT_STRIPE_PERSONAL_ANNUAL_PRICE_ID`, `NUXT_STRIPE_FAMILY_MONTHLY_PRICE_ID`, and `NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID`. Portal sessions use the configured `NUXT_STRIPE_PORTAL_CONFIGURATION_ID`. The former single `NUXT_STRIPE_FAMILY_PRICE_ID` contract is removed.
- Detached Stripe continuity remains identity-free and exists only for late-event and cancellation reconciliation. Its `purge_after` stays unset until the fork owner records a reviewed retention interval using Stripe sandbox evidence and applicable release policy; code does not guess that interval. Issue #38 must block production enablement until the interval, the procedure that assigns `purge_after`, and a bounded due-row purge drill are recorded. A due row may be removed only after no unresolved cancellation or reconciliation work refers to it.
- A Family manager's member list renders only each member's display name and email address. The private response may carry one opaque immutable member reference solely as the selector for the narrow removal command; the UI must not render that reference or expose roles, organization metadata, billing state, provider identifiers, or other private fields.
- Schema, migration, Checkout, Portal, webhook, reconciliation, worker, lifecycle, and UI changes are implemented and deterministically verified locally. Stripe sandbox and deployed persistent-staging certification remain external work under issue #37, and detached-record retention/readiness remains external work under issue #38.

## Consequences

- Clients can choose only a recognized application offering key. They never choose or receive a Stripe Price ID.
- Webhook and reconciliation code can fail closed when Stripe returns a Price that is not in the deployment's configured catalog.
- Duplicate Price configuration is a startup error because it would make the reverse mapping ambiguous.
- The existing family membership, commercial-authority, privacy, and deletion rules in ADR 0009 remain in force. Personal plans do not add family membership, while Family plans retain the six-person family boundary.
- Self-leave and manager removal are the only narrow direct-SQLite membership exceptions. Pinned Better Auth `1.6.23` does not atomically combine membership deletion with affected `activeOrganizationId` clearing while this app's async adapter transaction wrapper is disabled. The application therefore uses one `BEGIN IMMEDIATE` transaction for the caller's exact external membership, or for the exact non-manager membership after re-reading persisted manager authority, and clears only the affected person's stale session pointers. Identity, personal organization, private records, other memberships, and residual Personal state are untouched; native Better Auth Organization HTTP routes and every broader member/role mutation remain disabled.
- Deployments enabling Billing must operate the same-image Jobs worker. Deployments with Billing disabled need no usable Stripe configuration.

## Rejected alternatives

### Apple App Store or Google Play billing

Rejected from this scope. Issue #169 implements only the web application's Stripe subscription updates and does not build or integrate native store products.

### Provider-neutral billing framework

Rejected because only Stripe is approved. An abstraction without a second provider would add indirection and weaken the explicit server-owned mapping.

### Public Stripe Price IDs

Rejected because Price IDs are deployment configuration rather than stable application identifiers. Accepting them from clients would couple the public contract to provider resources and allow unreviewed values.

### One Family Price or cadence-only input

Rejected because the approved catalog includes Personal and Family offerings with explicit cadences. The server maps each exact application offering to exactly one configured Price.

## Evidence and official sources

- [Stripe Prices](https://docs.stripe.com/products-prices/how-products-and-prices-work)
- [Stripe Checkout subscriptions](https://docs.stripe.com/payments/checkout/build-subscriptions)
- [Stripe Customer Portal configuration](https://docs.stripe.com/customer-management/configure-portal)
- [Stripe pending subscription updates](https://docs.stripe.com/billing/subscriptions/pending-updates)
- [Stripe subscription schedules](https://docs.stripe.com/billing/subscriptions/subscription-schedules)
- [Stripe dynamically displayed payment methods](https://docs.stripe.com/payments/payment-methods/dynamic-payment-methods)
