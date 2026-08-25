# WCU rebuild provenance

This document records the source boundary and approved direction for the standalone Working Class
Unity rebuild. Update the port ledger whenever behavior is reviewed or carried forward from
Baseline.

## History boundary

- WCU history base: `fa509ee7cedb9f40987b0aa17986a09df2b49d07` from WCU `master`.
- Rebuild branch: `rebuild/baseline-snapshot`.
- Baseline source repository: `https://github.com/smallwiselabs/baseline`.
- Baseline source tag: `baseline-pre-platform-conversion`.
- Baseline source commit: `b1f53237446a83c63b443e018be616d2cabbee52`.
- Baseline source tree: `ec84436dba8003f81f3aff07439e59acc658246d`.
- WCU snapshot import commit: `ce833c307793ee0fbca476b2b55e906d41bef15f`.
- The snapshot was imported as an exact tree. Baseline Git ancestry was not imported.
- Legacy WCU `master` remains the pre-rebuild site until a separately approved cutover.

Do not merge, subtree, or blindly cherry-pick Baseline history into WCU. Port relevant behavior and
its verification deliberately, then record the result below.

## Approved rebuild direction

- Keep WCU as a standalone repository and application rather than a Baseline monorepo app.
- Start with a fresh, disposable pre-launch SQLite database and create a clean initial migration
  before launch.
- Do not transfer legacy WCU content, data, UI, or design in the platform-foundation phase.
- Remove Family and generic Projects completely.
- Remove product feature switches. Identity, Billing, email, Billing jobs, and database backups are
  application infrastructure; AI and user Files remain source-disabled dormant code.
- Allow open registration with email magic links only. New accounts begin as non-members.
- Limit the initial profile model to a required identity display name and an optional avatar. WCU
  has no public profile or member directory; the authenticated account holder is the only initial
  consumer of these fields.
- Keep a minimal operator-assigned administrator role separate from paid membership.
- Keep self-service account deletion in the first launch scope.
- Exclude AI chat, Files, File Search, Web Search, OpenAI resources, and user-file R2 from the basic
  release for every audience. Preserve only dormant implementation where that keeps the diff small.
- Later AI access requires a separately approved, content-grounded release: public users receive no
  access, authenticated nonmembers receive a limited quota, and dues-paying members receive one
  somewhat larger quota regardless of dues amount.
- Keep private SQLite backups in their own R2 boundary; do not provision a user-file bucket.
- Use Stripe Billing owned by the purchaser user, not the removed Family model. Defer the final
  one-membership/two-price catalog until the foundation is otherwise complete.
- Defer paid-page authorization until after the initial platform foundation.
- Use Resend as the email provider and Coolify for deployment.
- Defer real enabled-provider credentials and hosted certification. Deterministic tests do not
  certify database-backup R2, Resend, Stripe, Sentry, or Coolify accounts; no OpenAI or user-file R2
  account is part of this release.
- Retain the existing WCU subdomains, but do not retain the old site's other integrations.
- Preserve behavioral verification for retained capabilities. Remove or rewrite tests only when an
  approved removed or changed contract makes the old assertion invalid.
- Add the WCU UI before launch; UI and design work are outside the initial platform import.

## Baseline port ledger

| Baseline source                                                    | Purpose                                                                                                               | Status             | WCU evidence                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `b1f53237446a83c63b443e018be616d2cabbee52`                         | Exact integrated layout snapshot                                                                                      | Imported           | WCU commit `ce833c307793ee0fbca476b2b55e906d41bef15f`; matching tree `ec84436dba8003f81f3aff07439e59acc658246d`                                                                                                                                                                                                                                                                             |
| `b1f53237446a83c63b443e018be616d2cabbee52`                         | Flatten the imported workspace-shaped layout into one root application package                                        | Ported             | WCU commit `86e5c5a`; frozen install, build, built-runtime smoke, typecheck, lint, migration, tooling, framework-security, and 802 retained tests passed; the five failures remained the known date-expired Family tests scheduled for removal                                                                                                                                              |
| WCU history through `86e5c5a`                                      | Re-scope imported Gitleaks fingerprints to the ancestry-free WCU history and review legacy WCU documentation findings | Reviewed           | Nine fully redacted false-positive fingerprints reviewed; exact-ignore repository scan reports zero remaining findings                                                                                                                                                                                                                                                                      |
| After `b1f5323` through `6e4b350e1253333a39bf52d5211e37e3796e0ce1` | Relevant purchaser-owned Billing and post-snapshot security/resource-bound fixes                                      | Selectively ported | WCU commit `c010ede07f73b405fd522ae3f97c8057a51867f9`; purchaser-owned Stripe, account-deletion fences, request/resource bounds, and retained capability tests ported; Family, Organization, Projects, invitations, and platform scaffolding were not applicable; full `pnpm run verify` passed with 699 Vitest tests plus build, browser, isolated API, supply-chain, and container checks |

For later Baseline changes, add a row recording the source commit or range, whether it was applied,
not applicable, or deferred, the reason, the WCU commit, and verification evidence.
