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
- Remove product feature switches. Identity, Files, AI, Billing, email, jobs, and backups are part
  of the application; tests may still use deterministic provider substitutes.
- Allow open registration with email magic links only. New accounts begin as non-members.
- Limit the initial profile model to a required identity display name and an optional avatar. WCU
  has no public profile or member directory; the authenticated account holder is the only initial
  consumer of these fields.
- Keep a minimal operator-assigned administrator role separate from paid membership.
- Keep self-service account deletion in the first launch scope.
- Keep private, user-owned AI conversations using OpenAI Responses and make them available to all
  authenticated users. Final usage quotas are deferred.
- Keep OpenAI File Search backed by one deployment-owned, read-only WCU corpus. It may begin empty
  and must not automatically index users' private R2 files.
- Keep OpenAI Web Search behind a WCU-owned domain allowlist. Users cannot override it.
- Treat Web Search as not production-ready until WCU approves the domain list and the UI renders
  its citations visibly.
- Offer File Search and Web Search with automatic selection and at most one built-in tool call per
  response.
- Keep private user file storage in Cloudflare R2 and private SQLite backups in a separate R2
  bucket.
- Permit PDFs, ordinary images, Microsoft Office documents, and Apple iWork documents. Exact
  MIME/extension rules and low account quotas require documented implementation decisions.
- Use Stripe Billing owned by the purchaser user, not the removed Family model. Defer the final
  one-membership/two-price catalog until the foundation is otherwise complete.
- Defer paid-page authorization until after the initial platform foundation.
- Use Resend as the email provider and Coolify for deployment.
- Defer real provider credentials and hosted certification. Deterministic tests preserve the
  application contracts but do not certify OpenAI, R2, Resend, Stripe, Sentry, or Coolify accounts.
- Retain the existing WCU subdomains, but do not retain the old site's other integrations.
- Preserve behavioral verification for retained capabilities. Remove or rewrite tests only when an
  approved removed or changed contract makes the old assertion invalid.
- Add the WCU UI before launch; UI and design work are outside the initial platform import.

## Baseline port ledger

| Baseline source                                                    | Purpose                                                                                                               | Status                 | WCU evidence                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `b1f53237446a83c63b443e018be616d2cabbee52`                         | Exact integrated layout snapshot                                                                                      | Imported               | WCU commit `ce833c307793ee0fbca476b2b55e906d41bef15f`; matching tree `ec84436dba8003f81f3aff07439e59acc658246d`                                                                                                                                |
| `b1f53237446a83c63b443e018be616d2cabbee52`                         | Flatten the imported workspace-shaped layout into one root application package                                        | Ported                 | WCU commit `86e5c5a`; frozen install, build, built-runtime smoke, typecheck, lint, migration, tooling, framework-security, and 802 retained tests passed; the five failures remained the known date-expired Family tests scheduled for removal |
| WCU history through `86e5c5a`                                      | Re-scope imported Gitleaks fingerprints to the ancestry-free WCU history and review legacy WCU documentation findings | Reviewed               | Nine fully redacted false-positive fingerprints reviewed; exact-ignore repository scan reports zero remaining findings                                                                                                                         |
| After `b1f5323` through `6e4b350e1253333a39bf52d5211e37e3796e0ce1` | Relevant purchaser-owned Billing and post-snapshot security/resource-bound fixes                                      | Pending selective port | Not yet implemented                                                                                                                                                                                                                            |

For later Baseline changes, add a row recording the source commit or range, whether it was applied,
not applicable, or deferred, the reason, the WCU commit, and verification evidence.
