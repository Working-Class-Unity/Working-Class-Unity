# CI-S06: Playwright `webServer` browser lifecycle

- **Issue:** [#75](https://github.com/smallwiselabs/swl-step-by-step/issues/75)
- **Design approval:** owner comment on 2026-07-14
- **Base:** `origin/master` at `00959d1f5edd99f20ac05e80c154ee555b0d4d5f`

## Outcome

Pinned Playwright `1.61.1` now owns ordinary production-Nitro startup, availability waiting, occupied-target rejection, and POSIX process-group shutdown for the browser suite. The repository launcher still owns only the application-specific work that must happen outside that lifecycle:

- build the production app and require its server entry;
- run the real migration against a fresh temporary SQLite database;
- provide isolated runtime, email-capture, and Playwright-artifact paths;
- pass reviewed build/runtime canaries and module configuration;
- observe bounded Playwright output, paired raw Nitro stdout/stderr files, and retained artifacts for static and dynamically captured private values; and
- remove the entire disposable sandbox plus database sidecars on success or failure.

The browser journeys, completion reporter, shared managed-process helper, workflows, Sentry integration, schema, migrations, and product behavior are unchanged.

## Official capability basis

Playwright's exact pinned [`webServer` documentation](https://github.com/microsoft/playwright/blob/v1.61.1/docs/src/test-webserver-js.md) defines the selected behavior: an explicit command, working directory and environment; URL availability waiting; `reuseExistingServer: false` rejection; bounded startup; and process-group `SIGTERM` followed by `SIGKILL` after the configured grace period. The repository trusts that maintained lifecycle contract and adds no Playwright-internal conformance test.

The pinned [`webServer` implementation](https://github.com/microsoft/playwright/blob/v1.61.1/packages/playwright/src/plugins/webServerPlugin.ts) forwards stdout and stderr through reporter callbacks one raw chunk at a time and adds a prefix to each chunk. That diagnostic stream therefore cannot be the exact-byte privacy boundary: a private value split across raw Nitro chunks could become noncontiguous. The existing command now applies POSIX `umask 077` and redirects raw stdout and stderr to two sandbox files while Playwright continues to own start, wait, occupied-target rejection, and stop. The launcher scans those files only after Playwright has stopped the server and after dynamic capture values have been registered.

Nuxt `4.4.8` documents the production Node entry as `NODE_ENV=production node .output/server/index.mjs` and its `NITRO_HOST`/`NITRO_PORT` controls in the exact pinned [deployment guide](https://github.com/nuxt/nuxt/blob/v4.4.8/docs/1.getting-started/16.deployment.md). The launcher continues to build that entry and supplies the reviewed runtime environment before Playwright invokes it.

No dependency, license, privilege, network, data-disclosure, browser-installation, workflow-topology, or required-check change is introduced. Playwright was already an exact root dependency and the hosted browser worker remains unchanged.

## Ownership and removed concepts

| Concern                                | Primary owner after CI-S06                                      | Removed repository mechanism                                                               |
| -------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Production server start                | Playwright `webServer.command`                                  | Direct `spawnManaged` call and server child tracking                                       |
| Availability                           | Playwright `webServer.url` with a 45-second timeout             | Repository `waitForHttp` poll and liveness deadline                                        |
| Occupied target                        | Playwright with `reuseExistingServer: false`                    | Ephemeral socket reservation                                                               |
| Server shutdown                        | Playwright `gracefulShutdown` on POSIX                          | `stopBrowserServer`, explicit drain, and second server monitor                             |
| Build/migration                        | Existing launcher                                               | Retained; Playwright setup runs too late to replace it                                     |
| Dynamic-secret output/artifact privacy | Existing bounded launcher observers and paired raw server files | Direct live server-stream plumbing removed; Playwright does not know captured token values |
| Browser result completeness            | Existing fail-closed reporter                                   | Unchanged                                                                                  |
| Disposable state cleanup               | Existing launcher cleanup coordinator                           | Retained                                                                                   |

The CI contract's exact `test:browser:ci` command spelling and matching mutation were bookkeeping over the outcome already exercised by the real browser command and workflow. They are deleted without another source assertion.

## Diagnostic correction found during implementation

The first occupied-target injection exposed a retained-observer interaction: no passwordless capture exists when Playwright rejects the server before discovery, so unconditional capture registration masked the useful Playwright error with `Email capture registration failed closed`.

An initial correction permitted zero capture envelopes after any Playwright failure, which was too broad: a server could have launched, failed later, and produced raw output containing an unregistered token. The final boundary does not precreate the two raw files. Zero captures are allowed only when Playwright failed and both files are absent, proving the command never reached shell redirection. Once launch begins, both files must exist; a missing half, wrong mode, non-regular file, unreadable content, size mismatch, or combined output above 1 MiB fails closed. A successful run still requires captures. Every existing envelope must remain a bounded readable regular JSON file with the approved shape, URL, and token. This preserves the useful occupied-target diagnostic without exposing unregistered dynamic values.

## Complexity and runtime

| Measure                                        |    Before |     After |                Change |
| ---------------------------------------------- | --------: | --------: | --------------------: |
| Browser launcher, physical/nonblank lines      | 481 / 454 | 477 / 451 |               -4 / -3 |
| Playwright config, physical/nonblank lines     |   48 / 46 |   80 / 77 |             +32 / +31 |
| Combined launcher and config                   | 529 / 500 | 557 / 528 |             +28 / +28 |
| Repository-managed child roots per browser run |         4 |         3 | -1 direct server root |
| New dependencies or custom frameworks          |         0 |         0 |                     0 |

LOC increased because exact-byte privacy observation required a narrow paired-file boundary after Playwright's prefixed diagnostic forwarding proved insufficient. The launcher still removes five lifecycle concepts: port discovery/reservation, direct server spawn, HTTP readiness polling, and explicit server stop/drain, including direct ownership of the server child. The built server still exists as a Playwright-owned child; the reduction is in repository-owned lifecycle responsibility rather than physical lines.

Two initial local macOS lifecycle-refactor runs passed without retry in 95.42 and 132.68 seconds. After the raw-byte correction, a restored run passed in 91.85 seconds, including build, migration, all configured browser work, privacy scans, shutdown, and cleanup. The issue's earlier hosted timing came from a different commit and runner, so it is retained as reliability history rather than presented as a comparable speed baseline. CI-S06 changes lifecycle ownership, not the build count, browser projects, or journey inventory.

## Evidence

| Command or fault                                                 | Result                                                                                                                                         |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run bootstrap` under Node `24.14.0`                         | Frozen install passed                                                                                                                          |
| Focused contract/helper/reporter tests                           | 48/48 passed                                                                                                                                   |
| `npm run pnpm -- run check:ci`                                   | Workflow analysis passed; 94/94 script tests passed                                                                                            |
| `npm run verify:pinned` under Node `24.14.0`                     | Full frozen gate passed, including 312 coverage tests, native thresholds, migration/type/lint/security checks, and the production build        |
| `npm run pnpm -- run test:browser:ci`                            | Corrected raw-byte boundary passed all 12 production-built browser executions                                                                  |
| Hold `127.0.0.1:4173`, then run the browser command              | Failed before discovery with Playwright's exact occupied-URL diagnostic; no existing server was reused                                         |
| Write each issued magic-link token to Nitro stderr in two chunks | All browser cases completed, then the paired raw-file scan failed closed; diagnostics contained only redactions; disposable fault was reverted |
| Listener inspection after a passing run                          | No process remained on `127.0.0.1:4173`                                                                                                        |

The split-token fault replays the existing historical dynamic-secret differential fault against the revised observation boundary. It is evidence from the real runner, not a new Playwright conformance test. No new source-text, test-title, fixed-count, or Playwright-internal lifecycle assertion was added.

## Rollback and residual risk

A Git revert restores the repository-owned spawn/wait/stop path. It does not require a database rollback or state conversion because every browser run uses disposable migrated state.

Residual risks are explicit:

- the local and hosted POSIX browser workers now rely on Playwright's maintained lifecycle contract;
- port `4173` must be free, and an occupied port deliberately fails instead of reusing an unrelated process;
- raw server stdout and stderr temporarily contain potentially sensitive bytes inside the disposable sandbox; both files are created with mode `0600`, capped at 1 MiB combined, scanned only after shutdown, and removed with the sandbox;
- the retained privacy scan is bounded and recognizes dynamic values from capture envelopes; a future external-delivery test would need a separately reviewed value-registration boundary; and
- actual-runner signal interruption remains the previously retired `INT-01D` guarantee. Generic managed-process fixtures still own repository-helper cleanup behavior, but they do not claim to retest Playwright internals.
