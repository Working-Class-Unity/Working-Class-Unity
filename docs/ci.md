# Local Verification

This repository does not ship GitHub Actions workflows or promise hosted-CI
status checks. Verification is run locally or by whatever external system an
operator chooses.

## Standard commands

Use the pinned pnpm runner when pnpm is not already installed:

```bash
npm run verify:pinned
```

With pinned pnpm available:

```bash
pnpm run check
pnpm run verify
```

`check` runs formatting, repository/toolchain policy, local tooling tests,
supply-chain policy, the disposable framework-security fixture, lint,
Stylelint, fresh migration verification, typecheck, and ordinary Vitest.

`verify` adds the network-backed supply-chain scan, production build,
built-runtime smoke, Chromium journeys, isolated mutating API smoke, and
disposable Docker build/health checks.

The expensive boundaries can also run independently:

```bash
pnpm run test:runtime
pnpm run test:browser
pnpm run api:smoke
pnpm run test:container-build
pnpm run test:container-health
```

These commands create temporary databases, processes, browser state, or Docker
containers and remove the state they own. `api:smoke` is loopback-only and must
not be aimed at a deployment. Use `ops:smoke` for credential-free read-only
checks against a deployed target.

Coverage is an optional diagnostic, not a merge criterion. Repository Markdown
is development material and has no correctness, link, heading, or completeness
checker. Secret scanning still includes Markdown because credential detection
is a separate security boundary.

Real provider and deployment certification remains a staging responsibility;
deterministic local doubles do not certify external accounts.
