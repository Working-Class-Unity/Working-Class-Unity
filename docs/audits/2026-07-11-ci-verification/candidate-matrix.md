# Maintained-tool candidate matrix

**Post-audit decision:** the owner retired `DOC-01` completely on 2026-07-11. Lychee remains documented below as researched evidence but was rejected because no documentation-link CI guarantee remains.

## Evaluation contract

Candidates are evaluated against the exact repository lines Node `>=24 <25`, pnpm `11.1.2`, Vitest `4.1.6`, Playwright `1.61.1`, and pnpm lockfile format `9.0`.

For each candidate the audit considered:

- exact compatible version and release activity;
- license and ownership/governance;
- adoption and contributor breadth;
- security-reporting and release-provenance posture;
- supported platforms;
- installation/bootstrap trust;
- privileges, network access, and data disclosure;
- guarantees covered and lost;
- wrapper/configuration code required;
- net complexity rather than raw tool capability.

Adoption is a GitHub snapshot taken 2026-07-11. Contributor counts are approximate all-time API counts and may include bots. Stars are context, not an approval threshold.

## Summary

| Candidate                | Exact version      | License        |                                                             Adoption snapshot | Repository fit                                                | Classification                                                 |
| ------------------------ | ------------------ | -------------- | ----------------------------------------------------------------------------: | ------------------------------------------------------------- | -------------------------------------------------------------- |
| actionlint               | 1.7.12             | MIT            |                                                 4,029 stars; ~90 contributors | Standalone binary; Node-independent; exact macOS/Linux assets | Replace generic workflow parsing                               |
| ShellCheck               | 0.11.0             | GPL-3.0        |                                               39,687 stars; ~177 contributors | Use through actionlint for embedded shell only                | Add only with actionlint                                       |
| zizmor                   | 1.26.1             | MIT            |                                                5,828 stars; ~103 contributors | Offline/online GitHub Actions security analysis               | Replace security-oriented workflow assertions                  |
| Vitest coverage          | 4.1.6              | MIT            |                                               16,829 stars; ~775 contributors | Already installed and Node 24 compatible                      | Primary coverage gate; simplify custom framework               |
| Playwright `webServer`   | 1.61.1             | Apache-2.0     |                                               92,627 stars; ~775 contributors | Already installed; browser process lifecycle only             | Focused parity replacement candidate                           |
| OSV-Scanner CLI          | 2.4.0              | Apache-2.0     |                                               10,637 stars; ~115 contributors | Already pinned; supports `pnpm-lock.yaml`                     | Keep CLI; simplify wrapper late                                |
| Gitleaks CLI             | 8.30.1             | MIT            |                                               28,085 stars; ~234 contributors | Already pinned; direct local/history scan                     | Keep CLI; simplify wrapper late                                |
| Lychee CLI               | 0.24.2             | MIT/Apache-2.0 |                                                3,754 stars; ~116 contributors | Ordinary offline local links/headings; source-line gap        | Rejected after owner retired `DOC-01`; no replacement required |
| pnpm signature audit     | 11.1.2             | MIT            |                                               Existing pinned package manager | Official command already used                                 | Keep command; simplify count/report wrapper only               |
| GitHub native SHA policy | Repository setting | Platform       | Available and currently disabled; branch/ruleset enforcement APIs unavailable | Defense in depth only                                         | Cannot replace checked-in evidence                             |

## actionlint 1.7.12

Official sources:

- [release and assets](https://github.com/rhysd/actionlint/releases/tag/v1.7.12)
- [exact check catalog](https://github.com/rhysd/actionlint/blob/v1.7.12/docs/checks.md)
- [installation and attestations](https://github.com/rhysd/actionlint/blob/v1.7.12/docs/install.md)
- [license](https://github.com/rhysd/actionlint/blob/v1.7.12/LICENSE.txt)

Exact tag commit: `914e7df21a07ef503a81201c76d2b11c789d3fca`.

The project is active but maintainer-concentrated around `rhysd`. Version 1.7.12 was released 2026-03-30 after six stable releases since January 2025. Release assets cover the repository's macOS/Linux x64/arm64 targets, include SHA-256 checksums, and have GitHub artifact attestations from 1.7.11 onward.

The exact macOS arm64 release was downloaded, checksum-verified, and run against the audited workflows with no findings. With exact ShellCheck 0.11.0 supplied, embedded workflow shell also passed.

It covers generic workflow YAML structure, expression types, events/globs/cron, matrices, dependencies, runner labels, known Action inputs/outputs, reusable workflows, permission syntax, untrusted expression interpolation, hard-coded credentials, and optional embedded ShellCheck/Pyflakes.

It does not know repository intent: stable context names, the required event set, job topology, exact gate commands/order, artifact retention, canonical `master`, repository concurrency, or approved Action identities/versions.

**Decision:** use actionlint for generic workflow correctness. Retain a small parsed validator for repository intent. Do not copy the official example's mutable download-from-`main` pattern; pin the release and verify checksum/attestation.

Estimated new bootstrap/configuration burden is 20–80 handwritten lines if the existing verified-release mechanism is reused or narrowed.

## ShellCheck 0.11.0

Official sources:

- [release](https://github.com/koalaman/shellcheck/releases/tag/v0.11.0)
- [README and integration](https://github.com/koalaman/shellcheck/blob/v0.11.0/README.md)
- [license](https://github.com/koalaman/shellcheck/blob/v0.11.0/LICENSE)

The project remains active, though stable releases are less frequent and maintenance is concentrated around `koalaman`. Exact release binaries and GitHub asset SHA-256 digests exist for supported platforms. The exact Darwin arm64 digest and actionlint integration passed against the workflows.

There are no standalone shell files. A separate ShellCheck gate would add little.

**Decision:** if actionlint's embedded `run:` analysis is approved, pin ShellCheck and invoke it only through actionlint. Do not depend on the GitHub runner's unspecified preinstalled version. Owner approval should explicitly acknowledge execution of a GPL-3.0 tool; it does not add GPL code to this repository.

## zizmor 1.26.1

Official sources:

- [release](https://github.com/zizmorcore/zizmor/releases/tag/v1.26.1)
- [audit catalog](https://github.com/zizmorcore/zizmor/blob/v1.26.1/docs/audits.md)
- [online/offline behavior](https://github.com/zizmorcore/zizmor/blob/v1.26.1/docs/usage.md)
- [installation](https://github.com/zizmorcore/zizmor/blob/v1.26.1/docs/installation.md)
- [official Action implementation](https://github.com/zizmorcore/zizmor-action/blob/v0.5.7/action.sh)

Exact release commit: `597db4d7dc5730bdc1370197bf5678a5ca028abb`.

The project releases frequently and has named industry sponsorship, but core work remains maintainer-concentrated and the Action describes itself as pre-1.0. Exact Darwin arm64 assets were checksum-verified. Offline strict and auditor modes and online auditor mode all passed against the audited workflows.

It covers unpinned Actions/images, SHA/version-comment mismatch, excessive permissions, template injection, persisted credentials, artifact exposure, dangerous triggers, known-vulnerable Actions, impostor commits, stale references, and secret propagation.

Online audits query GitHub for Action/ref data; they do not upload repository source. Offline mode skips impostor/stale/known-vulnerable checks. The official Action's default SARIF/Advanced Security behavior does not fail appropriately for this private repository; `advanced-security: false`, a strict collection, and an approved persona would be required.

**Decision:** use with actionlint to replace maintained-tool-compatible workflow security assertions. Retain repository-specific semantics. Estimated integration burden is 10–30 workflow/configuration lines with the digest-pinned official Action or a small verified-binary bootstrap.

## Native Vitest 4.1.6 coverage

Official sources:

- [pinned coverage configuration and thresholds](https://github.com/vitest-dev/vitest/blob/v4.1.6/docs/config/coverage.md)
- [pinned V8 provider inclusion behavior](https://github.com/vitest-dev/vitest/blob/v4.1.6/packages/coverage-v8/src/provider.ts)
- [pinned reporter API](https://github.com/vitest-dev/vitest/blob/v4.1.6/docs/api/advanced/reporters.md)
- [pinned converter ignore-hint source](https://github.com/AriPerkkio/ast-v8-to-istanbul/blob/v1.0.4/src/ignore-hints.ts)
- [exact package engines](https://github.com/vitest-dev/vitest/blob/v4.1.6/packages/vitest/package.json)
- [exact coverage provider package](https://github.com/vitest-dev/vitest/blob/v4.1.6/packages/coverage-v8/package.json)
- [security policy](https://github.com/vitest-dev/vitest/blob/v4.1.6/SECURITY.md)

Vitest and `@vitest/coverage-v8` are already installed at 4.1.6. Node 24 is explicitly supported. The project is multi-maintainer, active, and has private vulnerability reporting.

Native negative thresholds enforce maximum uncovered counts. Global, per-file, and glob thresholds and explicit source inclusion are supported. Existing Vitest configuration also owns `allowOnly`, `passWithNoTests`, assertion requirements, timeouts, and reporting.

Native coverage does not justify a separate debt tuple for every production file, exact test-file inventory, exact passed-test count, a custom report schema, or multiple complete-suite mutation runs. Native Vitest does allow an all-skipped suite to pass, so the stricter required-suite policy still needs a small reporter. Its supported ignore directives can bypass thresholds, and native inclusion does not define this repository's symlink policy.

**Decision:** CI-S03/#72 makes native thresholds and inclusion primary, with no debt ledger, retained coverage artifact, normalization wrapper, or permanent whole-suite mutation harness. A narrow raw-source policy matches only the pinned converter's tool prefixes and six directive terms with flexible whitespace; raw scanning is necessary because `start`/`stop` hints are not comment-token limited. The retained custom script/test surface is a 26-line strict terminal-state reporter, a 23-line source policy, and 39 focused test lines—88 aggregate lines. Eight structured entrypoint-policy/test lines keep all new/replacement coverage-specific logic at 96 lines. Zero wrapper lines enforce thresholds.

## Playwright 1.61.1 `webServer`

Official sources:

- [exact `webServer` documentation](https://github.com/microsoft/playwright/blob/v1.61.1/docs/src/test-webserver-js.md)
- [exact package](https://github.com/microsoft/playwright/blob/v1.61.1/packages/playwright-test/package.json)
- [CI installation](https://github.com/microsoft/playwright/blob/v1.61.1/docs/src/ci.md)
- [security policy](https://github.com/microsoft/playwright/blob/v1.61.1/SECURITY.md)

Playwright is already pinned, Node 24 compatible, Microsoft-governed, multi-maintainer, and actively released.

The exact version supports command/cwd/env, readiness by URL or output, named output captures, timeouts, multiple servers, `reuseExistingServer: false`, log piping, and graceful shutdown followed by forced termination.

It can replace browser server spawn, basic wait/poll, fixed-port collision handling, startup timeout, and shutdown plumbing. It cannot replace production builds, migrations, disposable SQLite creation, build poison canaries, log/redaction assertions, post-run state checks, or runtime behavior not exercised by browser tests.

**Decision:** run one bounded old/new parity PR for browser lifecycle only. Expect 80–180 lines of app-specific setup/cleanup to remain. Stop if the wrapper approaches the current implementation's complexity. Do not present `webServer` as a replacement for built-runtime smoke.

## OSV-Scanner CLI 2.4.0

Official sources:

- [release](https://github.com/google/osv-scanner/releases/tag/v2.4.0)
- [supported lockfiles](https://google.github.io/osv-scanner/supported-languages-and-lockfiles/)
- [installation and SLSA verification](https://google.github.io/osv-scanner/installation/)
- [OSV API](https://google.github.io/osv.dev/api/)
- [official Action documentation](https://google.github.io/osv-scanner/github-action/)
- [Action 2.3.8 workflow](https://github.com/google/osv-scanner-action/blob/v2.3.8/.github/workflows/osv-scanner-reusable.yml)

The CLI is already pinned to commit `b56b5191101d5f27d4787d5583d8d01e9518a7af`. It is Google-governed, actively released, supports `pnpm-lock.yaml`, and publishes checksums/SLSA provenance. Online scanning sends package/version/ecosystem or commit coordinates to OSV; the query schema does not include repository source.

It does not provide registry signatures, secret detection, SHA-512 lock integrity, exact dependency pinning, or this repository's owner/follow-up/expiry/package-version exception policy.

The separate official Action is only at 2.3.8, contains a mutable `actions/download-artifact@v8` reference internally, and would downgrade the scanner/pinning posture.

**Decision:** keep the current direct 2.4.0 CLI. Simplify its wrapper only after preserving package-count completeness and exception lifecycle. Reject the present official Action.

## Gitleaks CLI 8.30.1

Official sources:

- [release](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1)
- [CLI documentation](https://github.com/gitleaks/gitleaks/blob/v8.30.1/README.md)
- [security policy](https://github.com/gitleaks/gitleaks/blob/master/SECURITY.md)
- [official Action README](https://github.com/gitleaks/gitleaks-action/blob/v3.0.0/README.md)
- [official Action metadata](https://github.com/gitleaks/gitleaks-action/blob/v3.0.0/action.yml)

The CLI is already pinned to commit `83d9cd684c87d95d656c1458ef04895a7f1cbd8e`. It remains active and publishes release archives/checksums for supported platforms. The CLI scans history/directories/files/stdin and supports complete redaction.

The official Action v3 uses a non-open-source EULA, requires an organization license key, and documents sending license/repository/owner data to Keygen.

**Decision:** keep the open-source CLI and reject the Action. Preserve a canary proving detection/redaction. The report/subprocess lifecycle may be reducible to roughly 50–120 lines after parity proof.

## Lychee CLI 0.24.2

Official sources:

- [release](https://github.com/lycheeverse/lychee/releases/tag/lychee-v0.24.2)
- [features](https://github.com/lycheeverse/lychee/blob/lychee-v0.24.2/README.md)
- [package and license metadata](https://github.com/lycheeverse/lychee/blob/lychee-v0.24.2/lychee-bin/Cargo.toml)
- [Action 2.9.0](https://github.com/lycheeverse/lychee-action/blob/v2.9.0/action.yml)

Lychee is organization-owned, actively released, supports Markdown/HTML, relative links, fragments, local files, schemes, retries/exclusions, and explicit offline mode. Exact release binaries have SHA-256 sidecars and GitHub asset digests.

The exact CLI passed ordinary repository local-link checks but reported two valid GitHub source-line anchors (`#L26` and `#L7`) as invalid in offline anchor mode. It does not directly preserve the current exact `#Lx-Ly` range, Roam shape, raw-HTML, tracked/untracked, symlink, and custom root-escape policies.

Online mode would add network flakiness while the current checker deliberately does not fetch external URLs. The Action downloads/extracts without verifying the published checksum.

**Audit-time candidate decision:** the direct pinned CLI could replace ordinary links only if that guarantee remained. The owner later retired `DOC-01` in full, so CI-S05/#74 rejects both the CLI and Action and deletes the 1,226-line checker/test framework without replacement.

## pnpm 11.1.2 registry signatures

Official sources:

- [exact command source](https://github.com/pnpm/pnpm/blob/v11.1.2/deps/compliance/commands/src/audit/signatures.ts)
- [exact signature library documentation](https://github.com/pnpm/pnpm/blob/v11.1.2/deps/security/signatures/README.md)

The official command enumerates lockfile packages, fetches registry keys/metadata, and verifies ECDSA signatures over package/version/integrity. Missing or invalid signatures fail. Registries without keys may be skipped, and Sigstore provenance is not verified.

**Decision:** retain the command plus the repository's stricter expected-package count parity. Simplify the surrounding JSON/count validation only if parity remains fail-closed.

## GitHub native policy and unavailable services

Official sources:

- [Actions repository settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)
- [secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)

GitHub supports repository/organization full-SHA requirements. This is useful defense in depth but cannot replace checked-in evidence because the setting is currently off and ruleset/branch-protection access is unavailable. It also does not know version comments, approved identities, event topology, or commands.

Dependabot alerts and secret scanning are disabled and code scanning requires unavailable Advanced Security. GitHub Dependency Review/SARIF features must therefore remain candidates, not assumed capabilities.

## Recommended tool tranche

The strongest maintained-tool tranche is:

1. actionlint 1.7.12 with exact ShellCheck 0.11.0 for embedded shell;
2. zizmor 1.26.1 in explicitly configured non-SARIF fail-closed mode;
3. a narrowed parsed repository-policy validator;
4. native Vitest 4.1.6 thresholds/inclusion as primary coverage enforcement;
5. a separate focused parity PR for Playwright `webServer`; delete documentation-link CI without Lychee under CI-S05/#74;
6. continued direct OSV/Gitleaks/pnpm use while wrapper reduction remains later and high-risk.

No candidate should be installed until the owner records its exact approval token and the replacement PR proves lower aggregate complexity.
