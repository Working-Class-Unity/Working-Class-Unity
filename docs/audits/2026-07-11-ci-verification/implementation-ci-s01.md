# CI-S01 maintained workflow analysis implementation

**Status:** implementation evidence complete on `branch/ci-s01-offline-analysis`; pull request pending

**Baseline:** `8ea9d570164a043da741b80d968df429341ed828` (`origin/master` after #21)

**Approval:** `APPROVE-CI-S01-OFFLINE`

**Guarantees:** `WF-01`, `WF-02`

## Decision

Use direct, checksum-verified release binaries for actionlint `1.7.12`, ShellCheck `0.11.0`, and zizmor `1.26.1`. Run actionlint with `/dev/null` as its immutable configuration, the exact ShellCheck path, and no ambient Pyflakes integration. Run zizmor with `--offline`, `--strict-collection`, `--collect=all`, `--persona=auditor`, `--no-config`, `--no-ignores`, plain non-SARIF output, and ordinary finding exit codes. Execute both analyzers even when one fails. Complete collection ensures nested `.gitignore` files cannot hide workflows.

Keep the existing parsed policy, but make its workflow section data-driven and limit it to repository intent: events, `master`, permissions, concurrency, public/internal names, approved Action identities and SHAs, exact commands/order, artifact scope/options/retention, formatter range, worker topology, timeouts, required-step conditions, aggregate inputs, and `continue-on-error`. Replace the aggregate's exact shell-body assertion with execution of the actual shell against draft, all-success, and each worker's `failure`, `cancelled`, and `skipped` result.

No workflow topology, public check context, application/provider code, dependency, lockfile, branch-protection setting, or supply-chain scanner behavior changes.

## Primary evidence

| Requirement                                                                                                                    | Primary evidence                                        | Distinct failure caught                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generic workflow syntax, schema, expressions, and Action inputs                                                                | actionlint over the actual workflows; malformed fixture | Invalid GitHub Actions syntax/schema/expression that remains valid generic YAML or bypasses repository-specific shape checks                                                                         |
| Embedded `run:` shell                                                                                                          | ShellCheck invoked through actionlint; `SC2086` fixture | Unsafe shell expansion; the wrapper independently verifies ShellCheck `0.11.0` because actionlint can otherwise disable a missing integration                                                        |
| Offline workflow security                                                                                                      | zizmor strict/auditor fixtures                          | `template-injection`, `excessive-permissions`, `unpinned-uses`, and `artipacked` findings without a token or online lookup; repo configs, inline ignores, and nested `.gitignore` remain ineffective |
| Event, `master`, context, permission, concurrency, Action identity/SHA, artifact, ordering, and required-step condition policy | `ci-contract.test.mjs` parsed mutations                 | Valid GitHub Actions configuration that violates this repository's intended CI contract or conditionally skips required evidence                                                                     |
| Full aggregate semantics                                                                                                       | Execution of the actual aggregate shell                 | Draft deferral remains successful; each worker's `failure`, `cancelled`, and `skipped` result is fatal outside a draft                                                                               |
| Public contexts                                                                                                                | Parsed current workflows and unchanged workflow files   | Rename, duplicate, or loss of `Fast PR gate` or `Full pre-merge gate`                                                                                                                                |

The maintained analyzer test owns two invocations rather than one process per mutation: one malformed document proves both parsers fail, and one directory of semantic YAML mutations proves all five stable security/shell diagnostic IDs. That directory also contains suppressing actionlint/zizmor configs and an inline zizmor ignore; the findings must still surface. The production `check:ci` invocation separately proves both real workflows pass.

## Old/new differential

The old contract from the baseline worktree and the new mechanisms ran over the same semantic mutations. `Reject` means a nonzero analyzer result or a nonempty parsed-policy error list.

| Fixture                                              | Old contract                                             | Maintained analyzers                                   | Retained parsed policy                    | Final primary owner                    |
| ---------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------- | -------------------------------------- |
| Current passing workflows                            | Accept                                                   | Accept                                                 | Accept                                    | All three boundaries                   |
| Malformed YAML                                       | Reject                                                   | Reject: actionlint syntax and zizmor strict collection | Reject at parser boundary                 | Maintained analyzers/parser            |
| `contents: write`                                    | Reject                                                   | Reject: `excessive-permissions`                        | Reject exact `contents: read`             | Parsed policy; zizmor defense in depth |
| `actions/checkout@v7`                                | Reject                                                   | Reject: `unpinned-uses`                                | Reject approved identity/SHA sequence     | Parsed policy; zizmor defense in depth |
| Pull-request title interpolated into aggregate shell | Reject only because the entire aggregate body was frozen | Reject: expression/template injection                  | Accept; no shell source assertion remains | Maintained analyzers                   |
| Unquoted aggregate-shell expansion                   | Reject only because the entire aggregate body was frozen | Reject: `SC2086`                                       | Accept; no shell source assertion remains | ShellCheck                             |
| Remove the `edited` pull-request event               | Reject                                                   | Accept as valid GitHub Actions                         | Reject exact event policy                 | Parsed policy                          |
| Filter `merge_group` or add push tags                | Accept                                                   | Accept as valid GitHub Actions                         | Reject exact unfiltered event keys        | Parsed policy                          |
| Rename `Fast PR gate`                                | Reject                                                   | Accept as valid GitHub Actions                         | Reject stable context policy              | Parsed policy                          |
| Broaden the supply-chain artifact path               | Reject                                                   | Accept as valid generic artifact use                   | Reject exact path/options/retention       | Parsed policy                          |
| Add `if` to a required worker or aggregate step      | Accept                                                   | Accept as valid GitHub Actions                         | Reject default-condition bypass           | Parsed policy                          |
| Persist checkout credentials plus repo suppressions  | Reject                                                   | Reject: `artipacked`; suppressions are disabled        | Accept; generic credential check removed  | zizmor                                 |

This split demonstrates why neither mechanism can replace the other. The old injection/shell failures were incidental exact-text failures; the new diagnostics identify the actual defect. Event, required-step condition, context, and artifact mutations remain valid generic workflows, so their small repository-specific checks remain. Conversely, persisted checkout credentials are now owned by zizmor, whose configuration, ignore, and collection bypasses are disabled and regression-tested.

## Tool and provenance record

| Tool       | Version/license   | Selection evidence                                                                                                                                                                                                                                                                                                                                                                         | Installation and execution                                                                                                                                 |
| ---------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| actionlint | `1.7.12`, MIT     | [Release](https://github.com/rhysd/actionlint/releases/tag/v1.7.12), [checks and ShellCheck integration](https://github.com/rhysd/actionlint/blob/v1.7.12/docs/checks.md), [configuration and path ignores](https://github.com/rhysd/actionlint/blob/v1.7.12/docs/config.md#configuration-file), [exit status](https://github.com/rhysd/actionlint/blob/v1.7.12/docs/usage.md#exit-status) | Exact macOS/Linux x64/arm64 release archive and SHA-256; version preflight; release assets have GitHub build attestations                                  |
| ShellCheck | `0.11.0`, GPL-3.0 | [Release](https://github.com/koalaman/shellcheck/releases/tag/v0.11.0), [return values](https://github.com/koalaman/shellcheck/blob/v0.11.0/shellcheck.1.md#return-values)                                                                                                                                                                                                                 | Executed only through actionlint; exact archive/API digest and version preflight; no signed tag or artifact attestation was found                          |
| zizmor     | `1.26.1`, MIT     | [Release](https://github.com/zizmorcore/zizmor/releases/tag/v1.26.1), [operating modes, ignores, strict collection, personas, and exit codes](https://github.com/zizmorcore/zizmor/blob/v1.26.1/docs/usage.md), [release workflow](https://github.com/zizmorcore/zizmor/blob/v1.26.1/.github/workflows/release-binaries.yml)                                                               | Exact macOS/Linux x64/arm64 release archive and SHA-256; version preflight; attested release assets; execution is offline with config and ignores disabled |

The dated audit snapshot recorded approximately 4,029/90 stars/contributors for actionlint, 39,687/177 for ShellCheck, and 5,828/103 for zizmor. All were active and unarchived, though development remains lead-maintainer concentrated and no dedicated repository security policy was identified. ShellCheck is executed as a separate GPL-3.0 program; no GPL code is incorporated into the application.

The official zizmor Action is not used: its defaults select `latest`, online/SARIF/token behavior and a Docker boundary that do not match this repository's approved offline, non-SARIF, fail-closed mode. Direct release binaries require no new package dependency or wrapper Action.

## Network, data, and privilege boundary

- On cache miss, the Node runner downloads only the selected official GitHub release archives over HTTPS and verifies committed SHA-256 values before extraction.
- GitHub invocations reuse the job's isolated `RUNNER_TEMP`. A local invocation without that variable creates and removes a process-isolated cache, preventing concurrent agents from racing over extracted binaries; two simultaneous local runs passed after this correction.
- Analyzer execution receives a narrow environment with no `GITHUB_TOKEN` or application/provider credential. zizmor's `--offline` forbids network operations; `--collect=all`, `--no-config`, and `--no-ignores` prevent repository files from hiding inputs or findings.
- actionlint reads workflow YAML and passes embedded shell text to the exact ShellCheck process through stdin; neither executes workflow commands.
- No sudo/elevated privilege, source upload, SARIF/Advanced Security feature, or repository write is required.
- The supported matrix matches the existing scanner runner: macOS/Linux on x64/arm64. Unsupported systems fail before analysis.

## Complexity and runtime

All counts are physical/nonblank handwritten lines and compare the live #68 baseline, not the earlier audit commit.

| Scope                           |        Before |         After |       Change |
| ------------------------------- | ------------: | ------------: | -----------: |
| `ci-contract.mjs` plus its test | 4,051 / 3,814 | 3,847 / 3,635 |  -204 / -179 |
| New analyzer runner and test    |         0 / 0 |     177 / 163 |  +177 / +163 |
| Checksum manifest               |         0 / 0 |       12 / 12 |    +12 / +12 |
| Touched verification total      | 4,051 / 3,814 | 4,036 / 3,810 | **-15 / -4** |

Aggregate new bootstrap/configuration additions are 102 lines: 89 runner lines, 12 checksum-manifest lines, and one changed package-script line. The focused behavioral test is 88 lines and is not bootstrap/configuration. No new file reaches 500 lines; the existing contract implementation is 230 lines smaller.

Single local measurements on Apple Silicon under Node `24.14.0`:

| Command                      | Baseline |    Head | Observation                                                            |
| ---------------------------- | -------: | ------: | ---------------------------------------------------------------------- |
| `check:ci` local wall time   |  21.08 s | 28.43 s | +7.35 s, including separate process-isolated local download caches     |
| Analyzer runner, empty cache |      n/a |  3.59 s | Includes three verified GitHub downloads                               |
| Analyzer runner, warm cache  |      n/a |  1.46 s | Includes archive rehash/extraction, version checks, and both analyzers |

The analyzer command runs once before the existing Node test process. Its two failure-fixture invocations then run alongside the other test files, so the measured `check:ci` wall-time change is the relevant local critical-path evidence. GitHub provides one isolated `RUNNER_TEMP` to the sequential production/test invocations, avoiding the second local cold cache; exact GitHub timing remains required before merge. No runtime reduction is claimed.

## Failure, rollback, and residual risk

Failure modes are closed: unsupported platform, release unavailability, checksum mismatch, extraction/version failure, analyzer crash/timeout, parse failure, or finding all produce a nonzero gate. A cache hit is rehashed and version-checked. Rollback is one pull-request revert; cached binaries live only under runner-temporary storage and no database/provider state or migration exists.

Residual risks:

- ShellCheck's official `0.11.0` release digest is not backed by a signed tag or artifact attestation; checksum verification proves equality to the committed official API digest, not independently signed provenance.
- Offline zizmor deliberately omits online-only impostor-commit, stale-reference, and known-vulnerable-Action audits. The retained exact reviewed Action identities/SHAs remain authoritative.
- A fresh runner depends on GitHub release availability. A cache miss fails rather than silently using an ambient or latest binary.
- This change validates workflow files but cannot enforce GitHub branch protection; #1 remains deferred and out of scope.
