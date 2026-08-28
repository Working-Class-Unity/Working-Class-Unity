# Production Evidence Template

Copy this file for each staging or production launch and fill it with real values from the deployed environment. Do not paste secrets. Filled evidence copies are ignored by git by default; keep them in the deployment workspace or another private operations record.

## Release

- Environment:
- App URL:
- Git ref:
- Operator:
- Date:

## Cloudflare

Mark the database-backup fields not applicable when a fork omits off-host backup, and record its accepted or replacement recovery boundary.

- Zone/domain configured:
- DNS record proxied:
- SSL/TLS mode:
- Cache rules reviewed:
- WAF/rate-limit rules enabled for auth, uploads, and AI routes:
- R2 bucket name:
- R2 normalized account/jurisdiction endpoint:
- R2 credentials created with least privilege:
- When selected, dedicated database-backup bucket is separate/private/Standard with no public domain or CORS:
- When selected, backup runner Object Read & Write token is scoped only to the backup bucket; admin identity separate:
- When selected, `sqlite/v1/` 30-day Bucket Lock and 35-day lifecycle confirmed:
- When selected, six-hour schedule, 1800-second timeout, success/failure notifications, and 12-hour freshness alert confirmed:
- When selected, off-host dead-man scheduler/state detects silence or loss of the Coolify host:
- When selected, exact immutable backup key/SHA-256 full-read receipt retained in a private off-host record:
- When selected, full provider upload/read-back and isolated fetch/restore passed:
- When selected, observed data-loss window and restore duration recorded without an RPO/RTO promise:
- Turnstile site configured:
- Real deployed-hostname keys used; dummy test keys absent:
- Magic-link `auth_magic_link` action and hostname validated; Files and AI tokens absent:
- Evidence link or screenshot location:

## OpenAI

Keep this section marked not applicable while AI is disabled. Do not paste keys, prompt/response or corpus content, provider error envelopes, user identifiers, project/vector-store/File IDs, operator receipts, or screenshots containing them.

- AI enabled or not applicable:
- File Search enabled or not applicable:
- Environment-specific OpenAI project identifier recorded privately:
- Restricted runtime service-account key configured Runtime-only and Build-disabled:
- Separate corpus-operator credential absent from application runtime:
- Exact `gpt-5.6-luna` model access and alias behavior confirmed:
- API billing method, spend/rate limits, and alerts configured:
- ChatGPT subscription confirmed unrelated to API billing:
- Direct Responses request/provider ID and safe error behavior confirmed:
- Provider rate/quota/refusal and timeout/ambiguous outcome confirmed:
- `store: false`, explicit no-cache mode, and no provider conversation state confirmed:
- Disabled File and Web Search omit all tool policy and make no search call:
- Enabled File Search uses only the privately recorded deployment-owned store and one-call/ten-result bounds:
- Ordinary users cannot create, upload, enumerate, mutate, or delete corpus resources:
- File citations are title-only; provider IDs, queries, chunks, scores, attributes, and raw results are absent:
- Bounded operator prepare/verify plus blue/green replacement and receipt-confirmed store/File deletion completed:
- File Search call/storage costs and dashboard reconciliation recorded:
- File/vector-store retention, ZDR ineligibility, deletion delay/eventual consistency, and residual state recorded:
- Enabled Web Search uses only the privately recorded one-to-100-domain allowlist, medium context, and one total built-in call:
- Root/subdomain filtering, redirects, live-access default, and combined File/Web automatic selection confirmed:
- Web citations preserve safe title/HTTPS URL/source spans and Unicode/multipart behavior is recorded; if a UI exists, its visible clickable rendering is separately certified, otherwise presentation remains explicitly uncertified:
- Search queries/actions/full source lists/raw results are absent from application persistence, logs, Sentry, and evidence:
- Web Search call plus search-content token costs and dashboard reconciliation recorded:
- Third-party disclosure, ZDR/MAM, and live-search HIPAA/BAA posture recorded:
- OpenAI dashboard logging/data-sharing settings reviewed:
- Default or approved ZDR/MAM posture and limitations recorded:
- Prompt/response absent from application logs and Sentry:
- Clear, conversation deletion, and account deletion confirmed:
- Key rotation/provider outage/rollback evidence:
- Evidence link or screenshot location:

Issue #37 owns this real provider certification. Local fakes, readiness, and `store: false` alone do not prove model/store/tool/domain access, runtime/operator permissions, citations, billing, Zero Data Retention, third-party behavior, provider cleanup, or deployed privacy/deletion behavior. Readiness must make no OpenAI, File Search, or Web Search call.

## Stripe

Record the pre-production payment evidence below against a dedicated [Stripe sandbox](https://docs.stripe.com/sandboxes), never a live customer/payment environment. Production activation is a separate controlled action after sandbox evidence passes. This is a human-reviewed checklist: the evidence checker intentionally enforces only its existing coarse completion boundary. Do not paste API keys, endpoint secrets, payment details, raw webhook payloads, Checkout or Portal URLs, or bearer links. Store safe request IDs only in the private evidence record.

- Stripe environment/sandbox identifier:
- Exact deployed Git commit and local image ID:
- Account-scoped API v1 snapshot event destination:
- Webhook API version `2026-06-24.dahlia`:
- Restricted runtime-key permissions and denial of unnecessary access:
- One Stripe Product created:
- Five distinct Prices created (Personal weekly/monthly/annual; Family monthly/annual):
- Reviewed Portal configuration ID recorded privately:
- Webhook endpoint URL:
- Webhook events enabled:
- Exact 21-event allowlist confirmed: Checkout completed/expired/async success/async failure; subscription created/updated/deleted/pending update applied/expired; schedule created/updated/completed/canceled/released/aborted; invoice paid/payment failed/payment action required; `refund.created`; dispute created/closed:
- Largest observed webhook payload size and response latency:
- Checkout success tested for all five offerings without exposing Price IDs:
- Dashboard-managed recurring payment methods tested against the pending-update path:
- One subscription item with quantity `1` confirmed for every offering:
- Checkout cancel tested:
- Checkout expiry tested:
- Durable Checkout idempotency after an ambiguous result tested:
- Duplicate webhook tested:
- Failed payment tested:
- Transient webhook failure returned non-2xx and Stripe automatic redelivery later succeeded exactly once:
- Deliberately out-of-order delivery preserved the current Stripe projection:
- Current-state webhook projection and manager-triggered manual reconciliation tested:
- Personal-to-Family pending update and immediate paid activation tested:
- Cadence and Family-to-Personal period-end schedules tested:
- Portal cancellation/reactivation and immediate Family invitation gates tested:
- Smart Retries configured for eight attempts over no more than 14 days:
- Earliest authenticated failure-event timestamp anchors grace; recovery, suspension, and terminal dissolution tested:
- Pending invitations reserve seats; create/resend/accept billing gates and reservation expiry tested:
- Manager opaque-reference removal and member self-leave release seats and restore residual Personal when applicable:
- Fresh exact account-deletion confirmation was checked before Stripe work:
- Durable cancellation request committed before dispatch:
- Immediate cancellation used no automatic refund or proration:
- Subscription retrieval confirmed cancellation before local identity deletion:
- Ambiguous cancellation retained identity, credentials, sessions, organization, and private data:
- Worker retried cancellation/retrieval only and could not delete the user:
- After worker confirmation, a later fresh exact deletion command was required:
- Stripe Customer was not deleted:
- Selected Customer Portal configuration has hosted login, plan/Price switching, quantity changes, pauses, unapproved profile updates, promotion codes, retention offers, and cancellation-reason/free-text collection disabled:
- Selected Customer Portal configuration has payment-method update and invoice history enabled:
- Selected Customer Portal configuration makes cancellation effective at period end without proration:
- Selected Customer Portal configuration has the app return URL, Terms, Privacy, support, public business details, and branding configured:
- Personal/Family billing-owner Portal access succeeds and covered-member Portal access remains denied:
- Safe Stripe request IDs retained privately without payload, secret, payment, or bearer data:
- Evidence link or screenshot location:

The event destination must use Stripe API v1 snapshot events at the account scope and subscribe only to the 21-event target documented in [the deployment guide](../docs/deployment.md). Record measured payload/latency and real delivery/retry behavior rather than treating local signatures as provider evidence. The selected Portal combination above is this application's reviewed product/privacy policy, not a claim that Stripe prescribes those settings. Issue #37 owns the live sandbox review; this template does not claim it from local fakes.

## DigitalOcean And Coolify

- Droplet name:
- Monitoring and alerts enabled:
- Backup plan enabled or documented:
- Coolify app name:
- Coolify migration service name:
- Coolify worker name:
- Backup capability selected (`COMPOSE_PROFILES=backup`) or explicitly omitted:
- Coolify private backup-runner name when selected:
- Coolify private stripe-sync-runner name:
- Standalone Docker destination recorded; Connect to Predefined Network off; no custom network:
- Coolify version `v4.1.2`, host Compose version, and rendered configuration recorded:
- Raw Compose Deployment and Consistent Container Names off; custom container/internal names and Compose build/start commands blank:
- Application stop grace `360` seconds:
- Selected Git commit:
- Migration, web, worker, and every enabled optional-service local image ID recorded and matching:
- Persistent mount type:
- Persistent mount Docker identity/source:
- Persistent mount destination `/app/data`:
- Migration, web, worker, and every enabled backup runner use the same local same-host `/app/data` volume:
- Effective runtime UID/GID:
- Production environment variables configured, including the exact eight private `NUXT_STRIPE_*` values when Billing is enabled:
- Separate Stripe synchronization key/mode/exact legacy Price lists configured only on its runner; mode/key match and billing-key isolation proved:
- Runtime-only variables Build disabled; enabled Observability build/runtime controls and Docker Build Secret recorded:
- Preview Deployments disabled; approved-merge `master` auto-deploy enabled through Coolify; no-overlap maintenance ordering and temporary incident suspension confirmed:
- Staging pause probe proved old long-lived containers absent and dependents stopped while migration ran:
- Staging forced migration failure left every dependent stopped:
- Temporary pause/failure probes removed; clean deployment repeated:
- Worker command uses the Sentry preload when Jobs is enabled and skips it when Jobs is disabled:
- Worker uses complete runtime environment, init/process supervision, unexpected-exit restart, and `360s` stop grace:
- Worker graceful shutdown and unexpected-exit restart exercised:
- Worker restarts suppressed during manual stopped-writer maintenance/restore:
- Worker inherited web health check disabled:
- Enabled backup runner exposes no port/domain, has inherited health check disabled, validates its five values, and uses init-backed shutdown; disabled deployment has no runner/task:
- Private receipt sink and dead-man scheduler/state survive loss of the Coolify host:
- Enabled-runner `BACKUP_R2_*` values are Runtime-only/Build-disabled, migration/web/worker override them to empty, and only explicit operator execution consumes them; disabled deployment omits them:
- Stripe synchronization dry-run duration/snapshot growth, restricted-read/denied-write proof, first apply/repeat, daily task/timezone/timeout, private notifications, and 26-hour freshness alert recorded:
- Latest synchronization result and issue-code counts reviewed without provider IDs or member PII:
- Jobs state recorded; disabled worker stable/inert; Billing/Files-enabled dependencies satisfied:
- Oldest-due backlog, pending cancellation age, and scheduled-effect deadline monitoring configured:
- Files storage binding matches driver, bucket, and normalized R2 endpoint:
- Files ordinary expiry cleanup and pre-claim viable root 24-hour safety cadence observed:
- Staging deployed:
- Staging migrations run:
- Production deployed:
- Production migrations run:
- Selected-commit migration result:
- Web, worker, backup runner, and Stripe synchronization runner started only after migration:
- Migration ledger current:
- Exact current four-entry ledger and 30-trigger schema verified:
- Baseline commit and local image IDs recorded before persistent staging:
- SQLite integrity and foreign keys passed:
- Pre-migration backup identity/result:
- Evidence link or screenshot location:

## Sentry

- Project:
- Environment:
- Release:
- Source maps confirmed:
- Server test error captured:
- Client test error captured:
- Alert configured:
- Evidence link or screenshot location:

## Email

Record this section under the R-033 provider staging matrix. Do not paste SMTP credentials or bearer magic-link/invitation URLs.

- Provider/environment identifier:
- Sending identity/domain verified:
- Configured From identity:
- Real inbox delivery confirmed:
- Invitation send, failed-send retry, and same-ID resend confirmed:
- Provider rejection/failure confirmed:
- Expired and replayed link behavior confirmed:
- Evidence link or screenshot location:

## Mobile

- iOS browser responsive check:
- Android browser responsive check:
- Evidence link or screenshot location:

## Final Commands

```bash
pnpm run ops:readiness:strict -- --env-file=.env.production
pnpm run ops:smoke -- --base-url=https://your-app.example.com
```

The deployed `ops:smoke` result must pass its credential-free `GET` checks. The mutating `api:smoke` suite is intentionally excluded from production evidence: it accepts no deployment target and runs only against the fresh loopback database, runtime working directory, and local fixtures it creates and removes. Its locally signed Stripe webhook is deterministic repository evidence, not Stripe sandbox certification.

## Notes

-
