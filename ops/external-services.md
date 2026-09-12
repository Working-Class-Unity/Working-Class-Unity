# External services

| Service            | Current responsibility                                                           | Website integration                                                   |
| ------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Stripe             | Membership payments, customer verification, receipts, subscriptions, management  | Two public payment links and one portal link; no API key or webhook.  |
| Solidarity         | Events, hosted RSVP and organizing forms, people, attendance, follow-up          | Public links plus manually reviewed event-metadata collection/import. |
| Coolify / host     | Build, web runtime, persistent event database, maintenance and backup runner     | Selected image and explicit deployment configuration.                 |
| Cloudflare DNS/CDN | Public routing, TLS/CDN configuration                                            | Existing domain configuration; review origin/cache behavior.          |
| Cloudflare R2      | Private event-database backup storage required by the shipped Compose deployment | Separate private backup runner only.                                  |
| Sentry             | Optional error reporting and release diagnostics                                 | Paired runtime DSNs and separately scoped build upload configuration. |

## Hosted membership links

- Membership, $10/month: https://pay.workingclassunity.com/b/7sI4hF1hc9IIepq4gh
- Solidarity, $27/month: https://pay.workingclassunity.com/b/bIY4hF4tof325SUaEE
- Manage subscription: https://pay.workingclassunity.com/p/login/00g29l9RKespfsI7ss

The website does not verify a visitor's membership, create a user account, or send activation email.
Opening a link for review does not require completing checkout or making a subscription change.
Provider-side payment, subscription, or portal configuration changes require their own authorization.

The current application needs no Better Auth, Resend, Twilio, OpenAI, or user-file R2 configuration.
Retiring unused integration inputs is part of the approved deployment; it does not delete provider
records or cancel real subscriptions. External organization data and form automation remain in Solidarity.
