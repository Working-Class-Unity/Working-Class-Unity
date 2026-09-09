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

## Browser failure diagnostics

`pnpm run test:browser` builds once and runs the browser suite with zero retries.
The gate is text-first: automatic traces, screenshots, and video are off because
the runner deletes its disposable artifacts rather than publishing them. Test
assertions and completion requirements are unchanged. Playwright failure context
and explicit test attachments can still be produced and are still inspected.

After private-value registration and inspection complete, failures include bounded,
redacted Playwright and server output. If inspection cannot finish, output remains
withheld and the command fails. Artifact refusals identify a controlled reason
without printing filenames, paths, contents, or underlying filesystem exceptions:

| Reason                                            | Next action                                                                                                                                                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aggregate-budget`                                | The aggregate 16 MiB limit was exceeded. Check test code for explicit attachments or capture overrides; do not raise the limit blindly. Counters describe files observed at refusal, not the complete tree. |
| `directory-read`, `stat`, `file-read`             | Check temporary-directory availability, permissions, and filesystem health. These are inspection failures, not proof of an assertion failure.                                                               |
| `size-changed`, `unsupported-entry`, `inspection` | Investigate artifact producers or scanner code; the artifact tree could not be inspected consistently.                                                                                                      |

A forbidden-private-value failure is not a budget refusal. Do not open or publish
withheld artifacts to investigate it; reproduce the relevant path with synthetic
data. The scanner matches registered values in raw bytes; it is not a general
sanitizer for compressed archives or images.

Use the redacted assertion output to choose a concrete repair. Do not repeatedly
run `verify` or rebuild an unchanged tree hoping to recover diagnostics. If output
is withheld, act on the refusal reason first; retry once only after addressing a
specific cause, then stop and report the remaining blocker if it persists. A
filtered, interrupted, or refused run is not a passing browser gate. The wrapper
does not forward arbitrary Playwright CLI flags.

The diagnostic boundary can be checked without rebuilding or launching browsers:

```bash
node --test scripts/ci-browser-diagnostics.test.mjs
```

Coverage is an optional diagnostic, not a merge criterion. Repository Markdown
is development material and has no correctness, link, heading, or completeness
checker. Secret scanning still includes Markdown because credential detection
is a separate security boundary.

Real provider and deployment certification remains a staging responsibility;
deterministic local doubles do not certify external accounts.
