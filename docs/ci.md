# Verification

Use the Node and pnpm versions pinned by the repository. Install with the frozen lockfile through
`node scripts/run-pnpm.mjs install --frozen-lockfile`.

```bash
node scripts/run-pnpm.mjs run check
node scripts/run-pnpm.mjs run verify
```

`check` is the canonical source and local-behavior gate. `verify` also builds the deployable application
and runs supply-chain scanning plus packaged runtime, browser, API, and container checks. The runtime
check performs the verification build; the following browser and API checks reuse it with `--skip-build`.
Standalone runtime, browser, and API commands build by default. The current script definitions in
`package.json` are authoritative. Focused work can use `lint`, `stylelint`, `typecheck`, `db:migrate:check`,
and `test` separately.

Verification uses disposable databases and provider fixtures. Event tests cover stable identities,
rescheduling, hybrid pairs, canonical tags, public audience filtering, import atomicity, and explicit
retirement. Browser checks cover the public shell, localization, public content, calendar, navigation,
and hosted-link destinations. No test should send a payment, create a real RSVP, submit a hosted form,
or mutate production data.

Database conversion checks must prove that only allowlisted event metadata reaches a fresh destination
and that private legacy fields do not. A source database or captured export is never a committed fixture.

A passing local pipeline does not prove live DNS, hosted payment/portal configuration, dashboard access,
R2 retention, Sentry delivery, or Coolify cutover. Record any separately authorized operational checks
using the [evidence template](../ops/production-evidence-template.md). Do not present old Baseline audit
results as evidence for the current release.
